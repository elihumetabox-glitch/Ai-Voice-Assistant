/**
 * Multi-Tenant 3CX Connector Supervisor Daemon Entrypoint.
 *
 * Runs the dynamic multi-tenant supervisor service, periodically polling
 * the credential broker for active tenant configurations, orchestrating
 * isolated PBX runtimes per company, and tearing down removed accounts.
 */

import { CallControlClient } from "@3cx/call-control-sdk";
import { MultiTenantSupervisor } from "./multi-tenant-supervisor.mjs";
import { createBrokerBoundTenantRuntime } from "./broker-bound-tenant-runtime.mjs";

const BROKER_URL = process.env.CREDENTIAL_BROKER_URL || "http://127.0.0.1:8001";
const BROKER_SECRET = process.env.CREDENTIAL_BROKER_SHARED_SECRET || "";
const RECONCILE_INTERVAL_MS = parseInt(process.env.RECONCILE_INTERVAL_MS || "15000", 10);

async function fetchActiveTenants() {
  const url = `${BROKER_URL.replace(/\/+$/, "")}/internal/v1/threecx/active-tenants`;
  const headers = {
    "Accept": "application/json",
  };
  if (BROKER_SECRET) {
    headers["Authorization"] = `Bearer ${BROKER_SECRET}`;
    headers["X-Broker-Secret"] = BROKER_SECRET;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch active tenants: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.tenants || [];
}

async function acquireTenantLease(tenantRef) {
  const companyId = typeof tenantRef === "string" ? tenantRef : tenantRef.companyId;
  const url = `${BROKER_URL.replace(/\/+$/, "")}/internal/v1/threecx/tenant-lease`;
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (BROKER_SECRET) {
    headers["Authorization"] = `Bearer ${BROKER_SECRET}`;
    headers["X-Broker-Secret"] = BROKER_SECRET;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
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
  const headers = {
    "Accept": "application/json",
  };
  if (BROKER_SECRET) {
    headers["Authorization"] = `Bearer ${BROKER_SECRET}`;
  }

  await fetch(url, { method: "DELETE", headers }).catch(() => {});
}

function createTenantRuntime(tenantConfig) {
  return createBrokerBoundTenantRuntime({
    tenantRef: tenantConfig.companyId,
    acquireTenantLease,
    releaseTenantLease,
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

