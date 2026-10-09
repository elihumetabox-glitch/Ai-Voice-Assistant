"""Private integration broker. Exposes provider results, never credentials."""

from contextlib import asynccontextmanager
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
import logging
import time
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .environment import load_broker_environment

load_broker_environment()

from backend.app.services.credential_broker_protocol import require_broker_secret, verify_broker_request
from backend.app.services.google_calendar import (
    book_google_calendar_event,
    check_google_calendar_interval_free,
    get_google_calendar_booking_by_request_key,
    cancel_google_calendar_event,
    get_google_calendar_availability,
    list_google_calendar_events,
    reconcile_active_calendar_mirrors_once,
    sync_google_calendar_mirror,
)
from backend.app.services.google_oauth import (
    cache_access_token,
    exchange_code_for_tokens,
    fetch_google_identity,
    revoke_and_disconnect,
)
from backend.app.services.credential_envelope import decrypt_secret, encrypt_secret
from backend.app.services.latency import bind_trace_id, log_latency, measured, reset_trace_id
from backend.app.services.threecx_probe import probe_pbx
from backend.app.config import settings
from db.connection import close_db_pool, get_db_pool
from db.tokens import save_oauth_tokens
from db.threecx import save_threecx_integration

logger = logging.getLogger("voice_bot.credential_broker")
_THREECX_PROBE_CONCURRENCY = 4
_THREECX_PROBE_QUEUE_TIMEOUT_SECONDS = 0.25
_threecx_probe_slots = asyncio.Semaphore(_THREECX_PROBE_CONCURRENCY)


async def _probe_threecx(pbx_url: str, app_id: str, client_secret: str):
    try:
        await asyncio.wait_for(
            _threecx_probe_slots.acquire(), timeout=_THREECX_PROBE_QUEUE_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=503, detail="3CX probe capacity is temporarily unavailable") from exc
    try:
        return await probe_pbx(pbx_url, app_id, client_secret)
    finally:
        _threecx_probe_slots.release()


class BrokerPayload(BaseModel):
    company_id: uuid.UUID


class CalendarListPayload(BrokerPayload):
    start_date: str | None = Field(default=None, max_length=10)
    end_date: str | None = Field(default=None, max_length=10)
    timezone: str = Field(default="Indian/Mauritius", max_length=64)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value


class CalendarAvailabilityPayload(CalendarListPayload):
    duration_minutes: int = Field(default=30, ge=5, le=1440)
    business_hours: dict[str, str] | None = Field(default=None)
    fresh: bool = False

    @field_validator("business_hours")
    @classmethod
    def validate_business_hours(cls, value: dict[str, str] | None):
        if value is None:
            return None
        valid_days = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
        if len(value) > 7 or any(
            day.lower() not in valid_days or not isinstance(hours, str) or len(hours) > 100
            for day, hours in value.items()
        ):
            raise ValueError("business_hours must contain at most seven bounded weekday entries")
        return value


class CalendarSyncPayload(BrokerPayload):
    timezone: str = Field(default="Indian/Mauritius", max_length=64)
    force_full: bool = False

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value


class CalendarBookPayload(BrokerPayload):
    request_key: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=255)
    start_time: str = Field(min_length=10, max_length=64)
    duration_minutes: int = Field(default=30, ge=5, le=1440)
    attendees: list[str] = Field(default_factory=list, max_length=100)
    description: str | None = Field(default=None, max_length=8000)
    location: str | None = Field(default="Google Meet", max_length=255)


class CalendarCancelPayload(BrokerPayload):
    event_id: str = Field(min_length=1, max_length=255)


class CalendarBookingStatusPayload(BrokerPayload):
    request_key: str = Field(min_length=1, max_length=128)


class OAuthCompletePayload(BrokerPayload):
    code: str = Field(min_length=1, max_length=4096)
    code_verifier: str = Field(min_length=43, max_length=128)


class OAuthDisconnectPayload(BrokerPayload):
    pass


class ThreeCXPayload(BrokerPayload):
    connection_name: str = Field(default="3CX PBX Connection", max_length=255)
    pbx_url: str = Field(min_length=3, max_length=255)
    app_id: str = Field(min_length=1, max_length=255)
    route_point_dn: str = Field(default="", max_length=128)
    client_secret: str = Field(min_length=4, max_length=4096)
    dids: list[str] = Field(default_factory=list, max_length=100)
    transfer_destinations: list[str] = Field(default_factory=list, max_length=100)
    failure_action: str = Field(default="disconnect", pattern="^(disconnect|transfer)$")
    failure_destination: str | None = Field(default=None, max_length=128)

    @model_validator(mode="before")
    @classmethod
    def normalize_input(cls, data: object) -> object:
        if isinstance(data, dict):
            url = str(data.get("pbx_url", "")).strip()
            if url and not (url.startswith("http://") or url.startswith("https://")):
                data["pbx_url"] = f"https://{url}"
            if not data.get("connection_name") or not str(data.get("connection_name")).strip():
                data["connection_name"] = "3CX PBX Connection"
            if not data.get("failure_action"):
                data["failure_action"] = "disconnect"
        return data

    @model_validator(mode="after")
    def validate_failure_policy(self):
        if not self.route_point_dn or not self.route_point_dn.strip():
            self.route_point_dn = self.app_id.strip()
        self.transfer_destinations = [
            value.strip() for value in self.transfer_destinations if value.strip()
        ]
        allowed = set(self.transfer_destinations)
        destination = self.failure_destination.strip() if self.failure_destination else None
        if self.failure_action == "transfer" and (not destination or destination not in allowed):
            raise ValueError("failure destination must be allowlisted")
        if self.failure_action == "disconnect" and destination is not None:
            raise ValueError("disconnect failure policy cannot include a destination")
        self.failure_destination = destination
        return self


async def _validated(payload: dict[str, Any], model: type[BaseModel]):
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="Invalid broker operation payload") from exc


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Starting isolated credential broker")
    require_broker_secret()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required by the credential broker")
    await get_db_pool(dsn=settings.database_url)
    stop_reconciliation = asyncio.Event()
    reconciliation_task: asyncio.Task[None] | None = None

    async def reconcile_loop() -> None:
        while True:
            try:
                await asyncio.wait_for(
                    stop_reconciliation.wait(),
                    timeout=settings.calendar_mirror_reconcile_interval_seconds,
                )
                return
            except asyncio.TimeoutError:
                pass
            result = await measured(
                logger,
                "calendar_mirror_periodic_reconciliation",
                reconcile_active_calendar_mirrors_once(),
            )
            logger.info(
                "calendar_mirror_reconciliation active=%d succeeded=%d failed=%d",
                result["active"],
                result["succeeded"],
                result["failed"],
            )

    if settings.calendar_mirror_enabled:
        reconciliation_task = asyncio.create_task(reconcile_loop())
    try:
        yield
    finally:
        stop_reconciliation.set()
        if reconciliation_task is not None:
            await reconciliation_task
        await close_db_pool()


app = FastAPI(
    title="Private Credential Broker",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.middleware("http")
async def correlate_request_latency(request: Request, call_next):
    trace_id, token = bind_trace_id(request.headers.get("x-request-id"))
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = trace_id
        log_latency(logger, "broker_request_total", started_at)
        return response
    except Exception:
        log_latency(logger, "broker_request_total", started_at, outcome="error")
        raise
    finally:
        reset_trace_id(token)


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "credential-broker"}


@app.post("/internal/v1/calendar/list")
async def calendar_list(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, CalendarListPayload)
    result = await measured(
        logger,
        "google_calendar_list",
        list_google_calendar_events(
            str(request.company_id), request.start_date, request.end_date, request.timezone
        ),
    )
    return result or {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED"}


@app.post("/internal/v1/calendar/availability")
async def calendar_availability(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, CalendarAvailabilityPayload)
    result = await measured(
        logger,
        "google_calendar_availability",
        get_google_calendar_availability(
            str(request.company_id), request.start_date, request.end_date,
            request.duration_minutes, request.timezone, request.business_hours,
            force_live=request.fresh,
        ),
    )
    if result:
        result["timezone"] = request.timezone
        return result
    return {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED"}


@app.post("/internal/v1/calendar/sync")
async def calendar_sync(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, CalendarSyncPayload)
    synced = await measured(
        logger,
        "google_calendar_sync",
        sync_google_calendar_mirror(
            str(request.company_id),
            timezone_name=request.timezone,
            force_full=request.force_full,
        ),
    )
    return {"status": "ready" if synced else "unavailable"}


@app.post("/internal/v1/calendar/book")
async def calendar_book(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, CalendarBookPayload)
    availability = await measured(
        logger,
        "google_calendar_prewrite_validation",
        check_google_calendar_interval_free(
            str(request.company_id), request.start_time, request.duration_minutes
        ),
    )
    if availability.get("status") != "available":
        return availability
    result = await book_google_calendar_event(
        str(request.company_id), request.title, request.start_time,
        request.duration_minutes, request.attendees, request.description, request.location,
        request.request_key,
    )
    return result or {"status": "temporarily_unavailable", "retryable": True}


@app.post("/internal/v1/calendar/book-status")
async def calendar_booking_status(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, CalendarBookingStatusPayload)
    return await get_google_calendar_booking_by_request_key(
        str(request.company_id), request.request_key
    )


@app.post("/internal/v1/calendar/cancel")
async def calendar_cancel(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, CalendarCancelPayload)
    success = await cancel_google_calendar_event(str(request.company_id), request.event_id)
    return {"status": "cancelled" if success else "integration_required", "event_id": request.event_id}


@app.post("/internal/v1/google/oauth/complete")
async def google_oauth_complete(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, OAuthCompletePayload)
    try:
        token_data = await exchange_code_for_tokens(
            code=request.code, code_verifier=request.code_verifier
        )
        access_token = str(token_data.get("access_token") or "")
        if not access_token:
            raise HTTPException(status_code=502, detail="Google did not return an access token")
        identity = await fetch_google_identity(access_token)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(token_data.get("expires_in", 3600)))
        await save_oauth_tokens(
            user_id=str(request.company_id), provider="google",
            access_token=access_token, refresh_token=token_data.get("refresh_token"),
            token_type=str(token_data.get("token_type") or "Bearer"),
            scope=token_data.get("scope"), expires_at=expires_at,
            google_subject=identity["subject"], google_email=identity["email"],
        )
        await cache_access_token(str(request.company_id), access_token, expires_at)
        # Do not log or serialize token_data/access_token from this process.
        return {
            "connected": True,
            "google_email": identity["email"],
            "scope": token_data.get("scope"),
            "expires_at": expires_at.isoformat(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("OAuth completion failed in credential broker (%s: %s)", type(exc).__name__, exc)
        raise HTTPException(status_code=502, detail="Google account connection failed") from exc


@app.post("/internal/v1/google/oauth/disconnect")
async def google_oauth_disconnect(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, OAuthDisconnectPayload)
    try:
        disconnected = await revoke_and_disconnect(str(request.company_id))
    except Exception as exc:
        logger.error("OAuth disconnect failed in credential broker (%s)", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Google account disconnect failed") from exc
    return {"disconnected": disconnected}


@app.post("/internal/v1/threecx/test")
async def threecx_test(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, ThreeCXPayload)
    host, _addresses = await _probe_threecx(request.pbx_url, request.app_id, request.client_secret)
    return {"status": "healthy", "pbxHost": host}


@app.post("/internal/v1/threecx/save")
async def threecx_save(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, ThreeCXPayload)
    host, _addresses = await _probe_threecx(request.pbx_url, request.app_id, request.client_secret)
    ciphertext, envelope = await asyncio.to_thread(
        encrypt_secret, request.client_secret,
        company_id=str(request.company_id), provider="threecx", field="client_secret",
    )
    saved = await save_threecx_integration(
        company_id=str(request.company_id), connection_name=request.connection_name,
        pbx_hostname=host, app_id=request.app_id, route_point_dn=request.route_point_dn,
        client_secret_ciphertext=ciphertext, encryption_envelope=envelope,
        dids=request.dids, transfer_destinations=request.transfer_destinations,
        failure_action=request.failure_action, failure_destination=request.failure_destination,
    )
    return {
        "configured": True,
        "connectionName": saved["connection_name"],
        "pbxHost": saved["pbx_hostname"],
        "state": saved["state"],
    }


@app.get("/internal/v1/threecx/active-tenants")
async def threecx_active_tenants(_authorized: bool = Depends(require_broker_secret)):
    from db.threecx import list_active_threecx_integrations
    integrations = await list_active_threecx_integrations()
    return {
        "tenants": [
            {
                "companyId": str(row["company_id"]),
                "connectionName": row["connection_name"],
                "pbxHostname": row["pbx_hostname"],
                "appId": row["app_id"],
                "routePointDn": row["route_point_dn"],
                "dids": row["dids"],
                "transferDestinations": row["transfer_destinations"],
                "failureAction": row["failure_action"],
                "failureDestination": row["failure_destination"],
                "credentialUpdatedAt": row["credential_updated_at"].isoformat() if row.get("credential_updated_at") else None,
            }
            for row in integrations
        ]
    }


class TenantLeaseRequest(BaseModel):
    companyId: str


@app.post("/internal/v1/threecx/tenant-lease")
async def threecx_acquire_tenant_lease(request: TenantLeaseRequest, _authorized: bool = Depends(require_broker_secret)):
    pool = await get_db_pool()
    company_uuid = uuid.UUID(request.companyId)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT company_id, connection_name, pbx_hostname, app_id, route_point_dn,
                      client_secret_ciphertext, encryption_envelope, dids, transfer_destinations,
                      failure_action, failure_destination, state
               FROM threecx_integrations
               WHERE company_id = $1 AND state = 'active'""",
            company_uuid,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Active 3CX integration not found for company")

    envelope = json.loads(row["encryption_envelope"]) if isinstance(row["encryption_envelope"], str) else row["encryption_envelope"]
    client_secret = await asyncio.to_thread(
        decrypt_secret,
        row["client_secret_ciphertext"],
        envelope,
        company_id=str(row["company_id"]),
        provider="threecx",
        field="client_secret",
    )

    expires_at_ms = int((datetime.now(timezone.utc) + timedelta(hours=1)).timestamp() * 1000)
    lease_id = f"lease-{uuid.uuid4().hex}"

    return {
        "leaseId": lease_id,
        "companyId": str(row["company_id"]),
        "expiresAt": expires_at_ms,
        "pbxBase": f"https://{row['pbx_hostname'].rstrip('/')}",
        "appId": row["app_id"],
        "appSecret": client_secret,
        "routePointDn": row["route_point_dn"],
        "dids": json.loads(row["dids"]) if isinstance(row["dids"], str) else (row["dids"] or []),
        "transferDestinations": json.loads(row["transfer_destinations"]) if isinstance(row["transfer_destinations"], str) else (row["transfer_destinations"] or []),
        "failureAction": row["failure_action"],
        "failureDestination": row["failure_destination"],
        "tenantBinding": {
            "companyId": str(row["company_id"]),
            "authSubject": "3cx-connector-service",
            "routePointDn": row["route_point_dn"],
            "profileVersion": 1,
            "timezone": "Indian/Mauritius",
        },
    }


@app.delete("/internal/v1/threecx/tenant-lease/{lease_id}")
async def threecx_release_tenant_lease(lease_id: str, _authorized: bool = Depends(require_broker_secret)):
    return {"released": True, "leaseId": lease_id}


class ClaimCallRequest(BaseModel):
    companyId: str
    pbxCallId: str
    eventId: str
    eventType: str
    did: str
    direction: str
    leaseSeconds: int = 45


@app.post("/internal/v1/threecx/claim-call")
async def threecx_claim_call(request: ClaimCallRequest, _authorized: bool = Depends(require_broker_secret)):
    from db.threecx import claim_threecx_call
    res = await claim_threecx_call(
        company_id=request.companyId,
        pbx_call_id=request.pbxCallId,
        event_id=request.eventId,
        event_type=request.eventType,
        did=request.did,
        direction=request.direction,
        lease_seconds=request.leaseSeconds,
    )
    if res.get("call"):
        serialized_call = {}
        for k, v in res["call"].items():
            if isinstance(v, uuid.UUID):
                serialized_call[k] = str(v)
            elif isinstance(v, datetime):
                serialized_call[k] = v.isoformat()
            else:
                serialized_call[k] = v
        res["call"] = serialized_call
    return res


class TransitionCallRequest(BaseModel):
    companyId: str
    pbxCallId: str
    claimToken: str
    expectedState: str
    newState: str
    livekitDispatchId: str | None = None


@app.post("/internal/v1/threecx/transition-call")
async def threecx_transition_call(request: TransitionCallRequest, _authorized: bool = Depends(require_broker_secret)):
    from db.threecx import transition_threecx_call
    success = await transition_threecx_call(
        company_id=request.companyId,
        pbx_call_id=request.pbxCallId,
        claim_token=uuid.UUID(request.claimToken),
        expected_state=request.expectedState,
        new_state=request.newState,
        livekit_dispatch_id=request.livekitDispatchId,
    )
    return {"success": success}


class RenewCallLeaseRequest(BaseModel):
    companyId: str
    pbxCallId: str
    claimToken: str
    leaseSeconds: int = 45


@app.post("/internal/v1/threecx/renew-call-lease")
async def threecx_renew_call_lease(request: RenewCallLeaseRequest, _authorized: bool = Depends(require_broker_secret)):
    from db.threecx import renew_threecx_call_lease
    renewed = await renew_threecx_call_lease(
        company_id=request.companyId,
        pbx_call_id=request.pbxCallId,
        claim_token=uuid.UUID(request.claimToken),
        lease_seconds=request.leaseSeconds,
    )
    return {"renewed": renewed}


