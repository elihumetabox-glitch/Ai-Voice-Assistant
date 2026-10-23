"""
FastAPI Router for Company Setup, Assistant Configuration, and LiveKit Session Tokens
Handles persistent client configuration in Neon PostgreSQL and mints WebRTC tokens.
"""

from datetime import timedelta
import hashlib
import logging
import os
from typing import Any, Dict, Literal, Optional
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator, model_validator

from ..config import settings
from db.settings import (
    get_assistant_config,
    get_company_profile,
    save_company_profile,
)
from db.assistant_configuration import save_assistant_configuration
from db.livekit_sessions import SessionProfileConflict, get_or_create_session
from db.companies import ensure_company
from db.agent_profiles import (
    get_latest_agent_profile,
    get_agent_profile_version,
    get_published_agent_profile,
    list_agent_profile_versions,
    transition_agent_profile,
)
from ..capabilities import CapabilityValidationError, compile_company_policy
from ..auth_context import issue_session_context, verify_session_context

logger = logging.getLogger("voice_bot.api.settings")
router = APIRouter(tags=["settings"])


def stable_participant_identity(company_id: str, session_id: str) -> str:
    """Keep token retries on the same browser participant in one LiveKit room."""
    digest = hashlib.sha256(f"{company_id}:{session_id}".encode("utf-8")).hexdigest()[:16]
    return f"user-{digest}"



# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class CompanyProfileRequest(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    website_url: Optional[str] = Field(default="")
    company_phone: Optional[str] = Field(default="")
    support_email: Optional[str] = Field(default="")
    timezone: str = Field(default="Indian/Mauritius")

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value


class AssistantConfigRequest(BaseModel):
    assistant_name: str = Field(..., min_length=1, max_length=255)
    voice_engine: str = Field(default="Aoede")
    inbound_greeting: str = Field(default="", max_length=500)
    system_prompt: str = Field(default="", max_length=8000)
    knowledge_base_notes: Optional[str] = Field(default="", max_length=16000)
    tone: Literal["professional", "friendly", "warm", "concise"] = "friendly"
    business_hours: dict[str, str] = Field(default_factory=dict)
    escalation_rules: list[str] = Field(default_factory=list, max_length=10)
    faq_entries: list[dict[str, str]] = Field(default_factory=list, max_length=20)
    default_language: Literal["fr-FR", "fr-BE", "en"] = "en"
    allowed_languages: list[Literal["fr-FR", "fr-BE", "en"]] = Field(
        default_factory=lambda: ["fr-FR", "fr-BE", "en"], min_length=1, max_length=3
    )
    capabilities: dict[str, Any] = Field(default_factory=lambda: {"google_calendar": {"enabled": True}})
    is_deployed: bool = Field(default=False)

    @model_validator(mode="after")
    def validate_language_policy(self):
        if len(set(self.allowed_languages)) != len(self.allowed_languages):
            raise ValueError("allowed_languages must not contain duplicates")
        if self.default_language not in self.allowed_languages:
            raise ValueError("allowed_languages must include default_language")
        return self


class ProfileVersionRequest(BaseModel):
    version: int = Field(..., ge=1)


async def resolve_livekit_profile(company_id: str, preview_version: int | None):
    """Resolve a published profile or an explicitly requested own-tenant draft preview."""
    if preview_version is None:
        return await get_published_agent_profile(company_id=company_id)
    profile = await get_agent_profile_version(company_id=company_id, version=preview_version)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assistant profile version not found")
    if profile.get("lifecycle_state") not in {"draft", "validated", "tested"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an unpublished draft can be previewed")
    if not isinstance(profile.get("profile"), dict) or not isinstance(profile.get("compiled_policy"), dict):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Assistant profile version is not ready for preview")
    return profile


def require_livekit_profile(profile: dict[str, Any] | None) -> dict[str, Any]:
    """Prevent a voice session from starting without an approved profile snapshot."""
    if not isinstance(profile, dict) or not profile.get("version"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Publish an assistant profile before starting a voice session.",
        )
    return profile


# ─── Company Profile Endpoints ───────────────────────────────────────────────

@router.get("/company-profile", summary="Retrieve Company Profile")
async def fetch_company_profile(
    verified_context_header: Optional[str] = Header(default=None, alias="X-Verified-Session-Context"),
):
    """Fetch company profile and operational parameters from Neon PostgreSQL."""
    try:
        context = verify_session_context(verified_context_header)
        if context is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
        profile = await get_company_profile(user_id=context.company_id)
        return {"status": "success", "data": profile}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to fetch company profile (error_type=%s)", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Company profile service is unavailable.",
        )


@router.post("/company-profile", summary="Save Company Profile")
async def update_company_profile(
    payload: CompanyProfileRequest,
    verified_context_header: Optional[str] = Header(default=None, alias="X-Verified-Session-Context"),
):
    """Save or update company profile and operational parameters into Neon PostgreSQL."""
    try:
        context = verify_session_context(verified_context_header)
        if context is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
        await ensure_company(context.company_id, context.auth_subject, payload.company_name)
        updated = await save_company_profile(
            user_id=context.company_id,
            company_name=payload.company_name,
            website_url=payload.website_url,
            company_phone=payload.company_phone,
            support_email=payload.support_email,
            timezone=payload.timezone,
        )
        return {"status": "success", "message": "Company profile saved successfully", "data": updated}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to save company profile (error_type=%s)", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Company profile service is unavailable.",
        )


# ─── Assistant Configuration Endpoints ───────────────────────────────────────

@router.get("/assistant-config", summary="Retrieve Assistant Configuration")
async def fetch_assistant_config(
    verified_context_header: Optional[str] = Header(default=None, alias="X-Verified-Session-Context"),
):
    """Fetch assistant prompt, voice engine, and greeting parameters from Neon PostgreSQL."""
    try:
        context = verify_session_context(verified_context_header)
        if context is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
        await ensure_company(context.company_id, context.auth_subject)
        config = await get_assistant_config(user_id=context.company_id)
        latest_profile = await get_latest_agent_profile(company_id=context.company_id)
        if latest_profile and isinstance(latest_profile.get("profile"), dict):
            config = {**(config or {}), **latest_profile["profile"]}
        return {"status": "success", "data": config}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to fetch assistant config (error_type=%s)", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Assistant configuration service is unavailable.",
        )


@router.post("/assistant-config", summary="Save Assistant Configuration")
async def update_assistant_config(
    payload: AssistantConfigRequest,
    verified_context_header: Optional[str] = Header(default=None, alias="X-Verified-Session-Context"),
):
    """Save or update assistant configuration into Neon PostgreSQL."""
    try:
        context = verify_session_context(verified_context_header)
        if context is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
        await ensure_company(context.company_id, context.auth_subject)
        try:
            compiled_policy = compile_company_policy({
                "instructions": payload.system_prompt,
                "capabilities": payload.capabilities,
                "assistant": {"name": payload.assistant_name, "voice": payload.voice_engine},
                "businessRules": {
                    "tone": payload.tone,
                    "business_hours": payload.business_hours,
                    "escalation_rules": payload.escalation_rules,
                },
                "faqEntries": payload.faq_entries,
                "referenceNotes": payload.knowledge_base_notes or "",
                "languagePolicy": {
                    "default_language": payload.default_language,
                    "allowed_languages": payload.allowed_languages,
                },
            })
        except CapabilityValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Assistant configuration contains unsupported or invalid settings.",
            ) from exc
        updated, saved_profile = await save_assistant_configuration(
            company_id=context.company_id,
            created_by=context.company_id,
            assistant_name=payload.assistant_name,
            voice_engine=payload.voice_engine,
            inbound_greeting=payload.inbound_greeting,
            system_prompt=payload.system_prompt,
            knowledge_base_notes=payload.knowledge_base_notes,
            is_deployed=payload.is_deployed,
            profile={
                "assistant_name": payload.assistant_name,
                "voice_engine": payload.voice_engine,
                "inbound_greeting": payload.inbound_greeting,
                "system_prompt": payload.system_prompt,
                "knowledge_base_notes": payload.knowledge_base_notes or "",
                "tone": payload.tone,
                "business_hours": payload.business_hours,
                "escalation_rules": payload.escalation_rules,
                "faq_entries": payload.faq_entries,
                "default_language": payload.default_language,
                "allowed_languages": payload.allowed_languages,
                "capabilities": payload.capabilities,
            },
            compiled_policy=compiled_policy,
        )
        return {
            "status": "success",
            "message": "Assistant configuration saved successfully",
            "data": {**updated, "profile_version": int(saved_profile["version"])},
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to save assistant config (error_type=%s)", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Assistant configuration service is unavailable.",
        )


# ─── LiveKit Room Token Minting Endpoint ─────────────────────────────────────

@router.get("/livekit/token", summary="Generate LiveKit Room Access Token")
async def generate_livekit_token(
    session_id: Optional[str] = Query(default=None, min_length=8, max_length=128),
    profile_version: Optional[int] = Query(default=None, ge=1),
    participant_name: Optional[str] = Query(default="Tester"),
    verified_context_header: Optional[str] = Header(default=None, alias="X-Verified-Session-Context"),
):
    """
    Generate an authenticated WebRTC access token to join the LiveKit Cloud room
    for the interactive Gemini Live Testing Sandbox.
    """
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")
    ws_url = os.getenv("LIVEKIT_URL", "wss://ai-voice-assistant-vu6rr406.livekit.cloud")

    if not api_key or not api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be configured in environment.",
        )


    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")

    resolved_session_id = session_id or uuid.uuid4().hex
    requested_room = f"sandbox-{resolved_session_id}"
    identity = stable_participant_identity(context.company_id, resolved_session_id)
    selected_profile = require_livekit_profile(
        await resolve_livekit_profile(context.company_id, profile_version)
    )
    resolved_profile_version = int(selected_profile["version"]) if selected_profile else None
    try:
        company_profile = await get_company_profile(context.company_id)
        session_timezone = str(company_profile.get("timezone") or "Indian/Mauritius")
        ZoneInfo(session_timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        logger.error("LiveKit session timezone is invalid (error_type=%s)", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The company's timezone is unavailable for this voice session.",
        ) from exc
    except Exception as exc:
        logger.error("LiveKit session timezone lookup failed (error_type=%s)", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The company's timezone is unavailable for this voice session.",
        ) from exc
    dispatch_metadata = issue_session_context(
        context,
        resolved_profile_version,
        timezone_name=session_timezone,
        session_id=resolved_session_id,
    )

    try:
        from livekit.api import AccessToken, VideoGrants

        from livekit.api import LiveKitAPI, CreateRoomRequest, CreateAgentDispatchRequest

        async def create_dispatch(room_name: str) -> str:
            lk_api = LiveKitAPI(ws_url, api_key, api_secret)
            try:
                try:
                    await lk_api.room.create_room(
                        CreateRoomRequest(name=room_name, empty_timeout=300)
                    )
                except Exception as room_exc:
                    logger.debug("LiveKit room create was idempotently skipped (error_type=%s)", type(room_exc).__name__)
                dispatch = await lk_api.agent_dispatch.create_dispatch(
                    CreateAgentDispatchRequest(
                        room=room_name,
                        agent_name=os.getenv("LIVEKIT_AGENT_NAME", "calendar-assistant"),
                        metadata=dispatch_metadata,
                    )
                )
                dispatch_id = getattr(dispatch, "id", None) or getattr(dispatch, "dispatch_id", None)
                if not dispatch_id:
                    raise RuntimeError("LiveKit did not return a dispatch identifier")
                return str(dispatch_id)
            finally:
                await lk_api.aclose()

        session = await get_or_create_session(
            user_id=context.company_id,
            session_id=resolved_session_id,
            room_name=requested_room,
            create_dispatch=create_dispatch,
            profile_version=resolved_profile_version,
        )
        resolved_room = str(session["room_name"])
        logger.info(
            "LiveKit session ready: session_id=%s room=%s dispatch_id=%s reused=%s",
            resolved_session_id,
            resolved_room,
            session["dispatch_id"],
            session["reused"],
        )

        token = (
            AccessToken(api_key, api_secret)
            .with_identity(identity)
            .with_name(participant_name)
            .with_grants(
                VideoGrants(
                    room_join=True,
                    room=resolved_room,
                    can_publish=True,
                    can_subscribe=True,
                    can_publish_data=True,
                )
            )
            .with_ttl(timedelta(hours=2))
        )

        jwt_token = token.to_jwt()

        return {
            "token": jwt_token,
            "ws_url": ws_url,
            "room": resolved_room,
            "identity": identity,
            "session_id": resolved_session_id,
        }
    except SessionProfileConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This session is already bound to a different assistant profile.",
        ) from exc
    except Exception as exc:
        logger.error("Failed to generate LiveKit room token (error_type=%s)", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not generate a LiveKit access token. Please try again.",
        )


@router.get("/assistant-config/runtime", summary="Retrieve the published assistant snapshot")
async def fetch_runtime_assistant_config(
    verified_context_header: Optional[str] = Header(default=None, alias="X-Verified-Session-Context"),
):
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    profile = await get_published_agent_profile(
        company_id=context.company_id,
        version=context.profile_version,
    )
    if profile is None:
        return {"status": "not_configured", "data": None}
    return {"status": "success", "data": profile}


@router.get("/assistant-config/versions", summary="List assistant profile versions")
async def get_assistant_profile_versions(
    verified_context_header: Optional[str] = Header(default=None, alias="X-Verified-Session-Context"),
):
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    return {"status": "success", "data": await list_agent_profile_versions(company_id=context.company_id)}


@router.post("/assistant-config/validate", summary="Validate assistant profile")
async def validate_assistant_profile(
    payload: AssistantConfigRequest,
    verified_context_header: Optional[str] = Header(default=None, alias="X-Verified-Session-Context"),
):
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    try:
        compiled = compile_company_policy({
            "instructions": payload.system_prompt,
            "capabilities": payload.capabilities,
            "assistant": {"name": payload.assistant_name, "voice": payload.voice_engine},
            "businessRules": {
                "tone": payload.tone,
                "business_hours": payload.business_hours,
                "escalation_rules": payload.escalation_rules,
            },
            "faqEntries": payload.faq_entries,
            "referenceNotes": payload.knowledge_base_notes or "",
            "languagePolicy": {
                "default_language": payload.default_language,
                "allowed_languages": payload.allowed_languages,
            },
        })
    except CapabilityValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Assistant configuration contains unsupported or invalid settings.",
        ) from exc
    return {"status": "valid", "data": {
        "policy_version": compiled["platformPolicyVersion"],
        "allowed_tools": compiled["allowedTools"],
        "enabled_capabilities": list(compiled["capabilities"]),
        "redirect_response": compiled["redirectResponse"],
    }}


@router.post("/assistant-config/publish", summary="Publish assistant profile version")
async def publish_assistant_profile(
    payload: ProfileVersionRequest,
    verified_context_header: Optional[str] = Header(default=None, alias="X-Verified-Session-Context"),
):
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    try:
        profile = await transition_agent_profile(
            company_id=context.company_id,
            version=payload.version,
            lifecycle_state="published",
            allowed_source_states={"validated", "tested"},
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail="Only validated or tested profiles can be published") from exc
    return {"status": "success", "data": profile}


@router.post("/assistant-config/rollback", summary="Roll back to an assistant profile version")
async def rollback_assistant_profile(
    payload: ProfileVersionRequest,
    verified_context_header: Optional[str] = Header(default=None, alias="X-Verified-Session-Context"),
):
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    try:
        profile = await transition_agent_profile(
            company_id=context.company_id,
            version=payload.version,
            lifecycle_state="published",
            allowed_source_states={"superseded"},
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail="Only a superseded profile can be restored") from exc
    return {"status": "success", "data": profile}
