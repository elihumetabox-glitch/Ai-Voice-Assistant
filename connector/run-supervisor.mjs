/**
 * Multi-Tenant 3CX Connector Supervisor Daemon Entrypoint.
 *
 * Runs the dynamic multi-tenant supervisor service, periodically polling
 * the credential broker for active tenant configurations, orchestrating
 * isolated PBX runtimes per company, and tearing down removed accounts.
 */

import crypto from "node:crypto";
import { CallControlClient } from "@3cx/call-control-sdk";
import { Room } from "@livekit/rtc-node";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import { MultiTenantSupervisor } from "./multi-tenant-supervisor.mjs";
import { createBrokerBoundTenantRuntime } from "./broker-bound-tenant-runtime.mjs";
import { createThreeCxTenantRuntime } from "./threecx-tenant-runtime.mjs";
import { startVerifiedThreeCxLiveKitMediaBridge } from "./verified-threecx-livekit-media.mjs";

const BROKER_URL = process.env.CREDENTIAL_BROKER_URL || "http://127.0.0.1:8001";
const BROKER_SECRET = process.env.CREDENTIAL_BROKER_SHARED_SECRET || "";
const RECONCILE_INTERVAL_MS = parseInt(process.env.RECONCILE_INTERVAL_MS || "15000", 10);

const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const LIVEKIT_SESSION_CONTEXT_SECRET = process.env.LIVEKIT_SESSION_CONTEXT_SECRET || "";
const LIVEKIT_AGENT_NAME = process.env.LIVEKIT_AGENT_NAME || "calendar-assistant";

let agentDispatchClient = null;

function getAgentDispatchClient() {
  if (!agentDispatchClient && LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET) {
    agentDispatchClient = new AgentDispatchClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return agentDispatchClient;
}

function getBrokerHeaders() {
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  if (BROKER_SECRET) {
    headers["Authorization"] = `Bearer ${BROKER_SECRET}`;
    headers["X-Broker-Secret"] = BROKER_SECRET;
  }
  return headers;
}

function createSignedSessionContext({ sessionId, companyId, authSubject, profileVersion, timezone, secret }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const msgObj = {
    auth_subject: authSubject,
    company_id: companyId,
    issued_at: issuedAt,
    session_id: sessionId,
  };
  if (profileVersion != null) msgObj.profile_version = profileVersion;
  if (timezone != null) msgObj.timezone = timezone;

  const sortedKeys = Object.keys(msgObj).sort();
  const sortedObj = {};
  for (const k of sortedKeys) sortedObj[k] = msgObj[k];
  const msgStr = JSON.stringify(sortedObj);

  const signature = crypto.createHmac("sha256", secret).update(msgStr).digest("hex");
  const meta = {
    session_id: sessionId,
    company_id: companyId,
    auth_subject: authSubject,
    issued_at: issuedAt,
    signature,
    ...(profileVersion != null ? { profile_version: profileVersion } : {}),
    ...(timezone != null ? { timezone } : {}),
  };
  return JSON.stringify(meta);
}

async function fetchActiveTenants() {
  const url = `${BROKER_URL.replace(/\/+$/, "")}/internal/v1/threecx/active-tenants`;
  const res = await fetch(url, { headers: getBrokerHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to fetch active tenants: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.tenants || [];
}

async function acquireTenantLease(tenantRef) {
  const companyId = typeof tenantRef === "string" ? tenantRef : tenantRef.companyId;
  const url = `${BROKER_URL.replace(/\/+$/, "")}/internal/v1/threecx/tenant-lease`;

  const res = await fetch(url, {
    method: "POST",
    headers: getBrokerHeaders(),
    body: JSON.stringify({ companyId }),
  });

  if (!res.ok) {
    throw new Error(`Failed to acquire lease for ${companyId}: HTTP ${res.status}`);
  }
  const leaseData = await res.json();
  const client = new CallControlClient({
    pbxBase: leaseData.pbxBase,
    appId: leaseData.appId,
    appSecret: leaseData.appSecret,
  });

  return {
    leaseId: leaseData.leaseId,
    tenantRef: companyId,
    expiresAt: leaseData.expiresAt,
    client,
    tenantBinding: leaseData.tenantBinding,
  };
}

async function releaseTenantLease(lease) {
  const url = `${BROKER_URL.replace(/\/+$/, "")}/internal/v1/threecx/tenant-lease/${encodeURIComponent(lease.leaseId)}`;
  await fetch(url, { method: "DELETE", headers: getBrokerHeaders() }).catch(() => {});
}

function createTenantRuntime(tenantConfig) {
  return createBrokerBoundTenantRuntime({
    tenantRef: tenantConfig.companyId,
    acquireTenantLease,
    releaseTenantLease,
    createThreeCxRuntime: ({ client, tenantBinding, ...runtimeOptions }) => {
      const claimCall = async ({ pbxCallId, eventId, eventType, did, direction }) => {
        const res = await fetch(`${BROKER_URL.replace(/\/+$/, "")}/internal/v1/threecx/claim-call`, {
          method: "POST",
          headers: getBrokerHeaders(),
          body: JSON.stringify({
            companyId: tenantConfig.companyId,
            pbxCallId: String(pbxCallId),
            eventId: String(eventId),
            eventType: String(eventType),
            did: String(did),
            direction: String(direction),
          }),
        });
        if (!res.ok) throw new Error(`Broker claim-call failed: HTTP ${res.status}`);
        return await res.json();
      };

      const transitionCall = async ({ pbxCallId, claimToken, expectedState, newState, livekitDispatchId }) => {
        const res = await fetch(`${BROKER_URL.replace(/\/+$/, "")}/internal/v1/threecx/transition-call`, {
          method: "POST",
          headers: getBrokerHeaders(),
          body: JSON.stringify({
            companyId: tenantConfig.companyId,
            pbxCallId: String(pbxCallId),
            claimToken: String(claimToken),
            expectedState: String(expectedState),
            newState: String(newState),
            ...(livekitDispatchId ? { livekitDispatchId: String(livekitDispatchId) } : {}),
          }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        return !!data.success;
      };

      const renewCallLease = async ({ pbxCallId, claimToken }) => {
        const res = await fetch(`${BROKER_URL.replace(/\/+$/, "")}/internal/v1/threecx/renew-call-lease`, {
          method: "POST",
          headers: getBrokerHeaders(),
          body: JSON.stringify({
            companyId: tenantConfig.companyId,
            pbxCallId: String(pbxCallId),
            claimToken: String(claimToken),
          }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        return !!data.renewed;
      };

      const dispatchAgent = async (request) => {
        const dispatchClient = getAgentDispatchClient();
        if (!dispatchClient) {
          console.warn("[3CX Connector] LiveKit dispatchClient not available (credentials missing), mock dispatch returned");
          return { dispatchId: `mock-dispatch-${Date.now()}` };
        }
        let metadata = "";
        if (LIVEKIT_SESSION_CONTEXT_SECRET) {
          metadata = createSignedSessionContext({
            sessionId: request.sessionId || `3cx-${Date.now()}`,
            companyId: request.companyId,
            authSubject: request.authSubject || "3cx-connector-service",
            profileVersion: request.profileVersion || 1,
            timezone: request.timezone || "Indian/Mauritius",
            secret: LIVEKIT_SESSION_CONTEXT_SECRET,
          });
        }
        const dispatch = await dispatchClient.createDispatch(request.roomName, LIVEKIT_AGENT_NAME, {
          metadata,
        });
        return { dispatchId: dispatch.id };
      };

      const stopAgent = async ({ dispatchId, roomName }) => {
        const dispatchClient = getAgentDispatchClient();
        if (!dispatchClient || !dispatchId) return;
        try {
          await dispatchClient.deleteDispatch(dispatchId, roomName);
        } catch {
          // Best-effort cleanup
        }
      };

      const createMediaBridge = async ({ controller, getParticipantHandle, pbxParticipantId, roomName, dispatchId, sessionId }) => {
        const participant = getParticipantHandle(pbxParticipantId);
        if (!participant) throw new Error(`Participant handle ${pbxParticipantId} not found on PBX`);

        if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
          console.warn("[3CX Connector] LiveKit credentials not configured, media bridge running in mock mode");
          return { close: async () => {} };
        }

        const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
          identity: `3cx-bridge-${tenantConfig.companyId.substring(0, 8)}`,
        });
        at.addGrant({ roomJoin: true, room: roomName });
        const jwt = await at.toJwt();

        const room = new Room();
        await room.connect(LIVEKIT_URL, jwt);

        return await startVerifiedThreeCxLiveKitMediaBridge({
          room,
          participant,
          dispatchClient: getAgentDispatchClient(),
          dispatchId,
          roomName,
          expectedAgentName: LIVEKIT_AGENT_NAME,
          controller,
          sessionId,
        });
      };

      const handlePbxFallback = async ({ pbxParticipantId, action, destination, reason }) => {
        const handle = client?.getParticipantHandle?.(pbxParticipantId);
        if (!handle) return false;
        try {
          if (action === "transfer" && destination) {
            await handle.transfer(destination, reason);
            return true;
          }
          if (action === "disconnect") {
            await handle.drop();
            return true;
          }
        } catch (err) {
          console.error(`[3CX Fallback] Failed to execute ${action} for participant ${pbxParticipantId}:`, err);
          return false;
        }
        return false;
      };

      const resolveInboundCall = async ({ partyDid }) => {
        return {
          direction: "inbound",
          did: partyDid || (Array.isArray(tenantBinding.dids) ? tenantBinding.dids[0] : "") || "",
        };
      };

      return createThreeCxTenantRuntime({
        tenantBinding,
        client,
        resolveInboundCall,
        claimCall,
        transitionCall,
        renewCallLease,
        dispatchAgent,
        createMediaBridge,
        stopAgent,
        handlePbxFallback,
        onSignal: (event, payload) => {
          console.log(`[3CX Tenant Runtime ${tenantConfig.companyId}] ${event}`, payload ? JSON.stringify(payload) : "");
        },
      });
    },
    runtimeOptions: {
      routePointDn: tenantConfig.routePointDn,
      dids: tenantConfig.dids,
      transferDestinations: tenantConfig.transferDestinations,
      failureAction: tenantConfig.failureAction,
      failureDestination: tenantConfig.failureDestination,
    },
  });
}

const supervisor = new MultiTenantSupervisor({
  fetchActiveTenants,
  createTenantRuntime,
  reconcileIntervalMs: RECONCILE_INTERVAL_MS,
  onSignal: (event, payload) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [3CX Supervisor] ${event}`, payload ? JSON.stringify(payload) : "");
  },
});

async function main() {
  console.log(`[3CX Supervisor] Starting multi-tenant connector supervisor (reconcile interval: ${RECONCILE_INTERVAL_MS}ms)...`);

  const shutdown = async (signal) => {
    console.log(`\n[3CX Supervisor] Received ${signal}, shutting down all tenant runtimes...`);
    await supervisor.stop();
    console.log("[3CX Supervisor] Clean shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await supervisor.start();
    console.log(`[3CX Supervisor] Running with ${supervisor.runningTenantCount} active tenants.`);
  } catch (err) {
    console.error("[3CX Supervisor] Startup error:", err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main();
}

export { supervisor, main, fetchActiveTenants, createTenantRuntime };
