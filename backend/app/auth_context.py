"""Verification of internal LiveKit-to-backend tenant context."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_SESSION_CONTEXT_AGE_SECONDS = 15 * 60


@dataclass(frozen=True)
class InternalSessionContext:
    session_id: str
    company_id: str
    auth_subject: str
    profile_version: int | None = None
    timezone: str | None = None


def _message(
    session_id: str,
    company_id: str,
    auth_subject: str,
    issued_at: int,
    profile_version: int | None = None,
    timezone_name: str | None = None,
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


def verify_session_context(raw: str | Mapping[str, Any] | None) -> InternalSessionContext | None:
    """Verify signed worker metadata; missing secrets fail closed."""
    secret = os.getenv("LIVEKIT_SESSION_CONTEXT_SECRET", "")
    if not secret or raw is None:
        return None
    try:
        payload = json.loads(raw) if isinstance(raw, str) else dict(raw)
        session_id = str(payload["session_id"])
        company_id = str(payload["company_id"])
        auth_subject = str(payload["auth_subject"])
        issued_at = int(payload["issued_at"])
        signature = str(payload["signature"])
        profile_version = payload.get("profile_version")
        if profile_version is not None:
            profile_version = int(profile_version)
        timezone_name = payload.get("timezone")
        if timezone_name is not None:
            timezone_name = str(timezone_name)
            ZoneInfo(timezone_name)
        max_age = int(os.getenv("LIVEKIT_SESSION_CONTEXT_MAX_AGE_SECONDS", "300"))
        if (
            max_age <= 0
            or max_age > MAX_SESSION_CONTEXT_AGE_SECONDS
            or not session_id
            or not company_id
            or not auth_subject
            or abs(time.time() - issued_at) > max_age
        ):
            return None
        expected = hmac.new(
            secret.encode("utf-8"),
            _message(session_id, company_id, auth_subject, issued_at, profile_version, timezone_name),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        return InternalSessionContext(
            session_id=session_id,
            company_id=company_id,
            auth_subject=auth_subject,
            profile_version=profile_version,
            timezone=timezone_name,
        )
    except (KeyError, TypeError, ValueError, ZoneInfoNotFoundError, json.JSONDecodeError):
        return None


def issue_session_context(
    context: InternalSessionContext,
    profile_version: int | None = None,
    timezone_name: str | None = None,
    session_id: str | None = None,
) -> str:
    """Re-sign verified tenant context for a LiveKit dispatch snapshot."""
    secret = os.getenv("LIVEKIT_SESSION_CONTEXT_SECRET", "")
    if not secret:
        raise ValueError("LIVEKIT_SESSION_CONTEXT_SECRET is not configured")
    resolved_timezone = timezone_name if timezone_name is not None else context.timezone
    if resolved_timezone is not None:
        try:
            ZoneInfo(resolved_timezone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("A valid IANA timezone is required for session context") from exc
    issued_at = int(time.time())
    effective_session_id = session_id if session_id is not None else context.session_id
    signature = hmac.new(
        secret.encode("utf-8"),
        _message(
            effective_session_id,
            context.company_id,
            context.auth_subject,
            issued_at,
            profile_version,
            resolved_timezone,
        ),
        hashlib.sha256,
    ).hexdigest()
    payload: dict[str, Any] = {
        "session_id": effective_session_id,
        "company_id": context.company_id,
        "auth_subject": context.auth_subject,
        "issued_at": issued_at,
        "signature": signature,
    }
    if profile_version is not None:
        payload["profile_version"] = profile_version
    if resolved_timezone is not None:
        payload["timezone"] = resolved_timezone
    return json.dumps(payload, separators=(",", ":"))
