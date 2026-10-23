import { JobStatus } from "@livekit/protocol";
import { ParticipantKind } from "@livekit/rtc-node";

const DEFAULT_AGENT_NAME = "calendar-assistant";

/**
 * Resolve the participant identity of the one running job attached to the
 * requested LiveKit dispatch. Never infer it from an agent name or room alone.
 */
export async function resolveDispatchedAgentIdentity({
  dispatchClient,
  dispatchId,
  roomName,
  expectedAgentName = DEFAULT_AGENT_NAME,
  timeoutMs = 25000,
  pollIntervalMs = 250,
  now = Date.now,
  sleep = delay,
}) {
  if (!dispatchClient || typeof dispatchClient.getDispatch !== "function") {
    throw new TypeError("A LiveKit agent-dispatch client is required");
  }
  if (!nonEmpty(dispatchId, 255) || !nonEmpty(roomName, 255) || !nonEmpty(expectedAgentName, 128)) {
    throw new TypeError("A dispatch ID, room, and expected agent name are required");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new RangeError("timeoutMs must be between 1 and 60000");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > timeoutMs) {
    throw new RangeError("pollIntervalMs must be positive and no greater than timeoutMs");
  }

  const deadline = now() + timeoutMs;
  do {
    let dispatch;
    try {
      dispatch = await dispatchClient.getDispatch(dispatchId, roomName);
    } catch {
      throw new Error("livekit_dispatch_verification_unavailable");
    }
    if (dispatch) {
      if (dispatch.id !== dispatchId || dispatch.room !== roomName || dispatch.agentName !== expectedAgentName) {
        throw new Error("livekit_dispatch_binding_mismatch");
      }
      const jobs = dispatch.state?.jobs;
      if (Array.isArray(jobs) && jobs.length > 1) throw new Error("livekit_dispatch_job_ambiguous");
      const job = Array.isArray(jobs) ? jobs[0] : undefined;
      if (job) {
        if (job.dispatchId && job.dispatchId !== dispatchId) throw new Error("livekit_dispatch_job_mismatch");
        if (job.agentName && job.agentName !== expectedAgentName) throw new Error("livekit_dispatch_agent_mismatch");
        if ([JobStatus.JS_FAILED, JobStatus.JS_SUCCESS].includes(job.state?.status)) {
          throw new Error("livekit_dispatch_job_not_running");
        }
        const identity = job.state?.participantIdentity;
        if (job.state?.status === JobStatus.JS_RUNNING && nonEmpty(identity, 255)) return identity;
      }
    }
    if (now() >= deadline) break;
    await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - now())));
  } while (now() <= deadline);

  throw new Error("livekit_dispatch_agent_not_ready");
}

/** Bind bridge authorization to both the server-reported identity and AGENT kind. */
export function createDispatchAgentVerifier({ dispatchId, participantIdentity, agentKind = ParticipantKind.AGENT }) {
  if (!nonEmpty(dispatchId, 255) || !nonEmpty(participantIdentity, 255)) {
    throw new TypeError("A verified dispatch ID and participant identity are required");
  }
  return (participant, candidateDispatchId) => candidateDispatchId === dispatchId
    && participant?.identity === participantIdentity
    && participant?.kind === agentKind;
}

function nonEmpty(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
