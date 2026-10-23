"""The BFF signs the Neon Auth subject as part of the internal tenant claim."""

import json
import time

from backend.app.auth_context import InternalSessionContext, issue_session_context, verify_session_context
from agent.session_context import load_verified_session_context


def test_signed_context_binds_auth_subject_company_and_profile(monkeypatch):
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_SECRET", "context-test-secret")
    context = InternalSessionContext(
        session_id="session-auth-binding",
        company_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        auth_subject="neon-user-42",
        timezone="Indian/Mauritius",
    )
    raw = issue_session_context(context, profile_version=4)
    verified = verify_session_context(raw)

    assert verified == InternalSessionContext(
        session_id=context.session_id,
        company_id=context.company_id,
        auth_subject=context.auth_subject,
        profile_version=4,
        timezone="Indian/Mauritius",
    )
    agent_context = load_verified_session_context(
        raw,
        signing_secret="context-test-secret",
    )
    assert agent_context is not None
    assert agent_context.timezone == "Indian/Mauritius"
    assert agent_context.profile_version == 4

    payload = json.loads(raw)
    payload["auth_subject"] = "different-neon-user"
    assert verify_session_context(payload) is None


def test_unsigned_or_legacy_context_without_auth_subject_fails_closed(monkeypatch):
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_SECRET", "context-test-secret")
    assert verify_session_context({
        "session_id": "session-without-subject",
        "company_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "issued_at": int(time.time()),
        "signature": "not-a-valid-signature",
    }) is None


def test_signed_context_rejects_tenant_session_and_profile_tampering(monkeypatch):
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_SECRET", "context-test-secret")
    raw = issue_session_context(
        InternalSessionContext(
            session_id="session-auth-binding",
            company_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            auth_subject="neon-user-42",
        ),
        profile_version=4,
    )

    for field, value in (
        ("session_id", "another-session"),
        ("company_id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
        ("profile_version", 5),
        ("timezone", "Europe/London"),
    ):
        payload = json.loads(raw)
        payload[field] = value
        assert verify_session_context(payload) is None, field


def test_signed_context_expiry_and_missing_secret_fail_closed(monkeypatch):
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_SECRET", "context-test-secret")
    raw = issue_session_context(
        InternalSessionContext(
            session_id="session-expiry-check",
            company_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            auth_subject="neon-user-42",
        )
    )
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_MAX_AGE_SECONDS", "30")
    payload = json.loads(raw)
    payload["issued_at"] = int(time.time()) - 31
    # The timestamp is signed, so sign a genuinely old claim using the same
    # canonical claim format rather than merely corrupting the existing one.
    from backend.app.auth_context import _message
    import hashlib
    import hmac

    payload["signature"] = hmac.new(
        b"context-test-secret",
        _message(payload["session_id"], payload["company_id"], payload["auth_subject"], payload["issued_at"]),
        hashlib.sha256,
    ).hexdigest()
    assert verify_session_context(payload) is None

    monkeypatch.delenv("LIVEKIT_SESSION_CONTEXT_SECRET")
    assert verify_session_context(raw) is None


def test_context_acceptance_window_has_a_hard_short_lived_ceiling(monkeypatch):
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_SECRET", "context-test-secret")
    raw = issue_session_context(
        InternalSessionContext(
            session_id="session-window-cap",
            company_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            auth_subject="neon-user-42",
        )
    )
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_MAX_AGE_SECONDS", "901")
    assert load_verified_session_context(
        raw, signing_secret="context-test-secret", max_age_seconds=901
    ) is None


def test_issue_session_context_allows_custom_session_id(monkeypatch):
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_SECRET", "context-test-secret")
    context = InternalSessionContext(
        session_id="browser-auth-session-id",
        company_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        auth_subject="neon-user-42",
        timezone="Indian/Mauritius",
    )
    raw = issue_session_context(context, profile_version=1, session_id="resolved-room-session-id")
    verified = verify_session_context(raw)
    assert verified is not None
    assert verified.session_id == "resolved-room-session-id"
    assert verified.company_id == context.company_id
    assert verified.auth_subject == context.auth_subject

