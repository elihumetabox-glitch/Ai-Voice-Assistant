"""
Google OAuth API Router
Handles OAuth redirects, callback handling, connection status checking, and account disconnection.
"""

from datetime import datetime, timezone
import json
import logging
from typing import Optional
import urllib.parse

from fastapi import APIRouter, Header, HTTPException, Query, status
from fastapi.responses import HTMLResponse, RedirectResponse

from ..config import settings
from ..services.google_oauth import (
    get_authorization_url,
    verify_authorization_state,
)
from ..services.credential_broker_client import broker_post
from ..auth_context import verify_session_context
from db.companies import ensure_company
from db.tokens import get_oauth_connection_metadata

logger = logging.getLogger("voice_bot.api.auth")
router = APIRouter(prefix="/auth/google", tags=["auth"])

def _resolve_redirect_uri(requested_uri: str | None) -> str:
    if not requested_uri:
        return settings.google_redirect_uri
    approved_origins = [o.strip().rstrip("/") for o in settings.cors_origins.split(",") if o.strip()]
    for origin in approved_origins:
        if requested_uri.startswith(origin) and requested_uri.rstrip("/").endswith("/auth/google/callback"):
            return requested_uri
    return settings.google_redirect_uri


@router.get("/login", summary="Initiate Google OAuth Consent Flow")
async def google_login(
    redirect_uri: str | None = Query(default=None),
    verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context"),
):
    """
    Redirect the user to Google's OAuth 2.0 consent screen with offline access.
    """
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth credentials are not configured in backend settings.",
        )

    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    await ensure_company(context.company_id, context.auth_subject)
    chosen_redirect = _resolve_redirect_uri(redirect_uri)
    auth_url = await get_authorization_url(
        company_id=context.company_id,
        session_id=context.session_id,
        redirect_uri=chosen_redirect,
    )
    logger.info("Initiating Google OAuth login redirect for company context")
    return RedirectResponse(url=auth_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.get("/url", summary="Get Google Authorization URL as JSON")
async def google_auth_url(
    redirect_uri: str | None = Query(default=None),
    verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context"),
):
    """
    Return the Google OAuth authorization URL as JSON for frontend popups or links.
    """
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth credentials are not configured in backend settings.",
        )

    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    await ensure_company(context.company_id, context.auth_subject)
    chosen_redirect = _resolve_redirect_uri(redirect_uri)
    auth_url = await get_authorization_url(
        company_id=context.company_id,
        session_id=context.session_id,
        redirect_uri=chosen_redirect,
    )
    return {"auth_url": auth_url}



@router.get("/callback", summary="Handle Google OAuth Callback", response_class=HTMLResponse)
async def google_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    """
    Handle authorization code redirect from Google OAuth server.
    Exchanges code for access/refresh tokens and persists them into Neon PostgreSQL.
    """
    if error:
        safe_error = {
            "access_denied": "Google authorization was cancelled.",
            "invalid_request": "Google rejected the authorization request.",
            "server_error": "Google could not complete authorization.",
            "temporarily_unavailable": "Google authorization is temporarily unavailable.",
        }.get(error, "Google authorization could not be completed.")
        logger.warning("Google OAuth callback returned an error")
        return HTMLResponse(
            content=f"""
            <html>
                <head><title>Google Connection Failed</title></head>
                <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f87171;">
                    <div style="background: #1e293b; padding: 2rem 3rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.5); text-align: center; max-width: 480px;">
                        <h2 style="margin-top: 0;">Connection Failed</h2>
                    <p style="color: #cbd5e1;"><strong>{safe_error}</strong></p>
                        <a href="/auth/google/login" style="display: inline-block; margin-top: 1rem; padding: 0.6rem 1.2rem; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px;">Try Again</a>
                    </div>
                </body>
            </html>
            """,
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing 'code' query parameter in OAuth callback.",
        )

    state_data = await verify_authorization_state(state or "")
    if state_data is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OAuth state")
    try:
        connection = await broker_post(
            "/internal/v1/google/oauth/complete",
            {
                "company_id": state_data["company_id"],
                "code": code,
                "code_verifier": state_data["code_verifier"],
            },
        )
        if not connection.get("connected"):
            raise RuntimeError("Credential broker did not confirm Google account storage")
    except Exception as exc:
        logger.error("Failed to exchange OAuth code for tokens (error_type=%s)", type(exc).__name__)
        return HTMLResponse(
            content=f"""
            <html>
                <head><title>Token Exchange Failed</title></head>
                <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f87171;">
                    <div style="background: #1e293b; padding: 2rem 3rem; border-radius: 12px; text-align: center;">
                        <h2>Authentication Failed</h2>
                        <p style="color: #cbd5e1;">Could not exchange authorization code with Google.</p>
                        <p style="font-size: 0.85rem; color: #94a3b8;">Please try connecting Google Calendar again.</p>
                    </div>
                </body>
            </html>
            """,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    logger.info("Google OAuth credentials stored by broker for authenticated company")
    try:
        from db.booking_requests import resume_needs_reconnect_bookings
        resumed = await resume_needs_reconnect_bookings(user_id=state_data["company_id"])
        if resumed:
            logger.info("Resumed paused calendar booking requests after account reconnection (count=%d)", resumed)
    except Exception as exc:
        logger.error("Could not resume paused booking requests after reconnection (error_type=%s)", type(exc).__name__)

    # Return polished success UI
    return HTMLResponse(
        content="""
        <!DOCTYPE html>
        <html>
            <head>
                <meta charset="utf-8">
                <title>Google Calendar Connected</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                        background: #090d16;
                        color: #f8fafc;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                    }
                    .card {
                        background: #111827;
                        border: 1px solid #1f2937;
                        border-radius: 16px;
                        padding: 2.5rem 3rem;
                        text-align: center;
                        max-width: 440px;
                        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
                    }
                    .icon {
                        width: 56px;
                        height: 56px;
                        background: #059669;
                        border-radius: 50%;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        margin-bottom: 1.25rem;
                        font-size: 28px;
                    }
                    h1 {
                        font-size: 1.4rem;
                        margin: 0 0 0.5rem 0;
                        color: #ffffff;
                    }
                    p {
                        font-size: 0.95rem;
                        color: #94a3b8;
                        line-height: 1.5;
                        margin: 0 0 1.5rem 0;
                    }
                    .badge {
                        display: inline-block;
                        background: #1e293b;
                        color: #38bdf8;
                        padding: 0.35rem 0.75rem;
                        border-radius: 9999px;
                        font-size: 0.8rem;
                        font-weight: 500;
                    }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✓</div>
                    <h1>Google Calendar Connected</h1>
                    <p>Your AI Voice Assistant is now authenticated to read calendar availability and schedule meetings with Google Meet links.</p>
                    <span class="badge">Connection established — closing window...</span>
                </div>
                <script>
                    try {
                        if (window.opener) {
                            window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*');
                            setTimeout(function() { window.close(); }, 1500);
                        }
                    } catch (e) {
                        console.error("OAuth completion notification failed", e);
                    }
                </script>
            </body>
        </html>
        """
    )


@router.get("/status", summary="Check Google Calendar Connection Status")
async def google_auth_status(verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context")):
    """
    Check if the user has an active Google Calendar integration.
    """
    try:
        context = verify_session_context(verified_context_header)
        if context is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
        tokens = await get_oauth_connection_metadata(user_id=context.company_id, provider="google")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Google connection status lookup failed (error_type=%s)", type(exc).__name__)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google integration status unavailable")

    if not tokens:
        return {
            "connected": False,
            "provider": "google",
        }

    now = datetime.now(timezone.utc)
    is_expired = tokens["expires_at"] < now
    has_refresh = bool(tokens.get("has_refresh_token"))

    connection_state = (
        "connected"
        if not is_expired
        else "refreshable"
        if has_refresh
        else "reconnect_required"
    )
    return {
        # Keep the legacy boolean compatible with existing clients, while
        # exposing whether the stored access token needs a broker refresh.
        "connected": connection_state != "reconnect_required",
        "connection_state": connection_state,
        "usable": connection_state in {"connected", "refreshable"},
        "provider": "google",
        "expires_at": tokens["expires_at"].isoformat(),
        "is_expired": is_expired,
        "can_refresh": has_refresh,
        "scope": tokens.get("scope"),
        "google_email": tokens.get("google_email"),
    }


@router.post("/disconnect", summary="Disconnect Google Calendar Integration")
async def google_disconnect(verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context")):
    """
    Revoke Google tokens and remove from PostgreSQL database.
    """
    try:
        context = verify_session_context(verified_context_header)
        if context is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
        result = await broker_post(
            "/internal/v1/google/oauth/disconnect", {"company_id": context.company_id}
        )
        success = bool(result.get("disconnected"))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Google disconnect failed (error_type=%s)", type(exc).__name__)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google integration disconnect unavailable")
    return {
        "status": "disconnected" if success else "not_found",
        "provider": "google",
    }

