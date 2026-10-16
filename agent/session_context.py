"""Session context verification and dispatch identity definitions.

Extracted from agent.py to provide a zero-dependency (stdlib-only) module
for HMAC session verification, unblocking tests and decoupled callers.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    from dotenv import load_dotenv
    _agent_env = Path(__file__).parent / ".env"
    if _agent_env.exists():
        load_dotenv(dotenv_path=_agent_env)
    else:
        load_dotenv()
except ImportError:
    pass

logger = logging.getLogger("voice_bot.session_context")

SESSION_CONTEXT_SIGNING_SECRET = os.getenv("LIVEKIT_SESSION_CONTEXT_SECRET", "")
try:
    _configured_context_age = int(os.getenv("LIVEKIT_SESSION_CONTEXT_MAX_AGE_SECONDS", "300"))
except (TypeError, ValueError):
    _configured_context_age = 0
SESSION_CONTEXT_MAX_AGE_SECONDS = (
    _configured_context_age
    if 0 < _configured_context_age <= 15 * 60
    else 0
)


def load_sip_pilot_context(
    metadata: str | Mapping[str, Any] | None,
    *,
    room_name: str,
    agent_name: str,
    now: Optional[float] = None,
) -> Optional[VerifiedSessionContext]:
    """Issue a fixed, explicitly enabled context for the isolated SIP pilot.

    This is deliberately not a general fallback for missing dispatch metadata.
    It requires a deployment opt-in, an exact room prefix, an exact agent name,
    and a configured tenant/profile. The caller identity is a service identity;
    SIP ANI is never used for authorization. Invalid non-empty metadata is not
    bypassed by this helper.
    """
    pilot_enabled = os.getenv("SIP_PILOT_MODE", "false").strip().lower() in {
        "1", "true", "yes", "on"
    }
    if not pilot_enabled or metadata not in (None, ""):
        return None

    expected_agent = os.getenv("SIP_PILOT_AGENT_NAME", "").strip()
    room_prefix = os.getenv("SIP_PILOT_ROOM_PREFIX", "").strip()
    company_id = os.getenv("SIP_PILOT_COMPANY_ID", "").strip()
    auth_subject = os.getenv("SIP_PILOT_AUTH_SUBJECT", "").strip()
    timezone_name = os.getenv("SIP_PILOT_TIMEZONE", "").strip() or None
    try:
        profile_version = int(os.getenv("SIP_PILOT_PROFILE_VERSION", "0"))
    except (TypeError, ValueError):
        profile_version = 0

    signing_secret = os.getenv("LIVEKIT_SESSION_CONTEXT_SECRET", SESSION_CONTEXT_SIGNING_SECRET)
    if (
        not expected_agent
        or agent_name != expected_agent
        or not room_prefix
        or not room_name.startswith(room_prefix)
        or not company_id
        or not auth_subject
        or profile_version <= 0
        or not signing_secret
    ):
        return None

    if timezone_name is not None:
        try:
            ZoneInfo(timezone_name)
        except (ZoneInfoNotFoundError, ValueError):
            return None

    issued_at = int(time.time() if now is None else now)
    session_id = f"sip-pilot-{uuid.uuid5(uuid.NAMESPACE_URL, room_name).hex}"
    signature = hmac.new(
        signing_secret.encode("utf-8"),
        _signed_context_message(
            session_id,
            company_id,
            auth_subject,
            issued_at,
            profile_version,
            timezone_name,
        ),
        hashlib.sha256,
    ).hexdigest()
    logger.warning(
        "SIP pilot context issued for gated room prefix (company_id=%s, profile_version=%s)",
        company_id,
        profile_version,
    )
    return VerifiedSessionContext(
        session_id=session_id,
        company_id=company_id,
        auth_subject=auth_subject,
        issued_at=issued_at,
        signature=signature,
        profile_version=profile_version,
        timezone=timezone_name,
    )


def build_sip_resolution_request(
    metadata: str | Mapping[str, Any] | None,
    *,
    room_name: str,
    agent_name: str,
    signing_secret: Optional[str] = None,
    now: Optional[float] = None,
) -> Optional[tuple[Dict[str, Any], str]]:
    """Build a signed payload and HMAC header for dynamic backend SIP tenant resolution."""
    if metadata not in (None, ""):
        return None
    room_prefix = os.getenv("SIP_PILOT_ROOM_PREFIX", "call-").strip() or "call-"
    if not room_name or not room_name.startswith(room_prefix):
        return None
    effective_secret = (
        os.getenv("LIVEKIT_SESSION_CONTEXT_SECRET", SESSION_CONTEXT_SIGNING_SECRET)
        if signing_secret is None
        else signing_secret
    )
    if not effective_secret or not agent_name:
        return None
    issued_at = int(time.time() if now is None else now)
    message = f"sip-resolve:{room_name}:{agent_name}:{issued_at}".encode("utf-8")
    signature = hmac.new(
        effective_secret.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()
    return (
        {
            "room_name": room_name,
            "agent_name": agent_name,
            "issued_at": issued_at,
        },
        signature,
    )


@dataclass(frozen=True)
class VerifiedSessionContext:
    """Identity asserted by the authenticated LiveKit dispatch service.

    This object is intentionally kept off every Gemini function signature. The
    worker obtains it from signed job metadata and injects it into backend
    requests. A missing or invalid context is never replaced with a default
    account.
    """

    session_id: str
    company_id: str
    auth_subject: str
    issued_at: int = 0
    signature: str = ""
    profile_version: Optional[int] = None
    verification: str = "livekit-dispatch"
    timezone: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.session_id.strip() or not self.company_id.strip() or not self.auth_subject.strip():
            raise ValueError("session_id, company_id, and auth_subject are required")
        if self.verification != "livekit-dispatch":
            raise ValueError("unsupported session context verification")
        if self.timezone is not None:
            try:
                ZoneInfo(self.timezone)
            except (ZoneInfoNotFoundError, ValueError) as exc:
                raise ValueError("session context timezone must be a valid IANA timezone") from exc

    def as_backend_payload(self) -> Dict[str, str | bool | int]:
        payload: Dict[str, str | bool | int] = {
            "session_id": self.session_id,
            "company_id": self.company_id,
            "auth_subject": self.auth_subject,
            "verified": True,
            "source": self.verification,
        }
        if self.profile_version is not None:
            payload["profile_version"] = self.profile_version
        if self.timezone is not None:
            payload["timezone"] = self.timezone
        return payload

    def signed_metadata(self) -> str:
        return json.dumps(
            {
                "session_id": self.session_id,
                "company_id": self.company_id,
                "auth_subject": self.auth_subject,
                "issued_at": self.issued_at,
                "signature": self.signature,
                **({"profile_version": self.profile_version} if self.profile_version is not None else {}),
                **({"timezone": self.timezone} if self.timezone is not None else {}),
            },
            separators=(",", ":"),
        )


def _signed_context_message(
    session_id: str,
    company_id: str,
    auth_subject: str,
    issued_at: int,
    profile_version: Optional[int] = None,
    timezone_name: Optional[str] = None,
) -> bytes:
    payload = {"auth_subject": auth_subject, "company_id": company_id, "issued_at": issued_at, "session_id": session_id}
    if profile_version is not None:
        payload["profile_version"] = profile_version
    if timezone_name is not None:
        payload["timezone"] = timezone_name
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def load_verified_session_context(
    metadata: str | Mapping[str, Any] | None,
    signing_secret: Optional[str] = None,
    now: Optional[float] = None,
    max_age_seconds: Optional[int] = None,
) -> Optional[VerifiedSessionContext]:
    """Validate signed LiveKit job metadata and return tenant context.

    The dispatch service must provide JSON containing ``session_id``,
    ``company_id``, ``auth_subject``, ``issued_at`` and an HMAC-SHA256
    ``signature`` minted by the trusted dispatch service. The signature binds
    the company and session (and, when present, the immutable profile version).
    Invalid, stale, unsigned, or incomplete metadata returns ``None`` so
    callers can fail closed.
    """
    effective_secret = (
        os.getenv("LIVEKIT_SESSION_CONTEXT_SECRET", SESSION_CONTEXT_SIGNING_SECRET)
        if signing_secret is None
        else signing_secret
    )
    if max_age_seconds is None:
        try:
            cfg_age = int(os.getenv("LIVEKIT_SESSION_CONTEXT_MAX_AGE_SECONDS", "300"))
        except (TypeError, ValueError):
            cfg_age = 0
        effective_max_age = cfg_age if 0 < cfg_age <= 15 * 60 else 0
    else:
        effective_max_age = max_age_seconds

    if not effective_secret:
        logger.error("Session context verification failed: LIVEKIT_SESSION_CONTEXT_SECRET is missing or empty")
        return None
    if metadata is None:
        logger.error("Session context verification failed: job metadata is None")
        return None
    if effective_max_age <= 0 or effective_max_age > 15 * 60:
        logger.error("Session context verification failed: invalid max_age_seconds (%s)", effective_max_age)
        return None
    try:
        payload = json.loads(metadata) if isinstance(metadata, str) else dict(metadata)
        session_id = str(payload.get("session_id", ""))
        company_id = str(payload.get("company_id", ""))
        auth_subject = str(payload.get("auth_subject", ""))
        issued_at = int(payload.get("issued_at", 0))
        signature = str(payload.get("signature", ""))
        profile_version = payload.get("profile_version")
        if profile_version is not None:
            profile_version = int(profile_version)
        timezone_name = payload.get("timezone")
        if timezone_name is not None:
            timezone_name = str(timezone_name)
            ZoneInfo(timezone_name)
        if not session_id.strip() or not company_id.strip() or not auth_subject.strip() or not signature:
            logger.error("Session context verification failed: missing mandatory fields in payload: %s", list(payload.keys()))
            return None
        current_time = time.time() if now is None else now
        if abs(current_time - issued_at) > effective_max_age:
            logger.error("Session context verification failed: timestamp expired (now=%s, issued_at=%s, max_age=%s)", current_time, issued_at, effective_max_age)
            return None
        expected = hmac.new(
            effective_secret.encode("utf-8"),
            _signed_context_message(
                session_id, company_id, auth_subject, issued_at, profile_version, timezone_name
            ),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            logger.error("Session context verification failed: HMAC signature mismatch")
            return None
        return VerifiedSessionContext(
            session_id=session_id,
            company_id=company_id,
            auth_subject=auth_subject,
            issued_at=issued_at,
            signature=signature,
            profile_version=profile_version,
            timezone=timezone_name,
        )
    except Exception as exc:
        logger.error("Session context verification error: %s: %s", type(exc).__name__, exc)
        return None


def require_bound_profile_snapshot(
    session_context: VerifiedSessionContext,
    status_code: int,
    runtime_data: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Reject missing or mismatched immutable profile snapshots for published sessions."""
    if session_context.profile_version is None:
        return runtime_data
    if status_code != 200 or not isinstance(runtime_data, dict):
        raise PermissionError("Published assistant profile snapshot is unavailable")
    try:
        actual_version = int(runtime_data.get("version", -1))
    except (TypeError, ValueError):
        actual_version = -1
    if actual_version != session_context.profile_version:
        raise PermissionError("Published assistant profile snapshot version mismatch")
    return runtime_data
