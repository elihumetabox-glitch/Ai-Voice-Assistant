"""OAuth initiation must establish the company row before storing PKCE state."""

from types import SimpleNamespace

import pytest

from backend.app.api import auth
from backend.app.auth_context import InternalSessionContext


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint_name", ["google_login", "google_auth_url"])
async def test_google_oauth_initiation_ensures_authenticated_company(
    endpoint_name, monkeypatch: pytest.MonkeyPatch
):
    company_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    calls = []

    async def ensure_company(received_company_id, received_auth_subject):
        calls.append(("company", received_company_id, received_auth_subject))

    async def get_authorization_url(*, company_id, session_id, **kwargs):
        calls.append(("url", company_id, session_id))
        return "https://accounts.google.com/test"

    monkeypatch.setattr(
        auth,
        "settings",
        SimpleNamespace(
            google_client_id="client",
            google_client_secret="secret",
            google_redirect_uri="https://ai-voice-assistants.vercel.app/auth/google/callback",
            cors_origins="http://localhost:3000",
        ),
    )
    monkeypatch.setattr(
        auth,
        "verify_session_context",
        lambda _raw: InternalSessionContext(session_id="session-a", company_id=company_id, auth_subject="auth-user-a"),
    )
    monkeypatch.setattr(auth, "ensure_company", ensure_company)
    monkeypatch.setattr(auth, "get_authorization_url", get_authorization_url)

    result = await getattr(auth, endpoint_name)(verified_context_header="signed-context")

    assert calls == [
        ("company", company_id, "auth-user-a"),
        ("url", company_id, "session-a"),
    ]
    if endpoint_name == "google_login":
        assert result.headers["location"] == "https://accounts.google.com/test"
    else:
        assert result == {"auth_url": "https://accounts.google.com/test"}
