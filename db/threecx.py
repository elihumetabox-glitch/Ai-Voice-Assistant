"""Tenant-scoped 3CX integration repository."""

from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any, Optional
import json
import uuid

from .connection import get_db_pool


THREECX_CALL_TRANSITIONS = {
    "claimed": {"connecting", "failed", "ended"},
    "connecting": {"active", "failed", "ending"},
    "active": {"transferring", "ending", "failed"},
    "transferring": {"transferred", "active", "failed"},
    "transferred": {"ending", "ended"},
    "ending": {"ended", "failed"},
    "ended": set(),
    "failed": set(),
}


def threecx_room_name(company_id: str, pbx_call_id: str) -> str:
    """Return an opaque, deterministic room name without exposing PBX call IDs."""
    digest = hashlib.sha256(f"3cx-room:{company_id}:{pbx_call_id}".encode()).hexdigest()[:32]
    return f"threecx-{digest}"


def _json_list(value: Any) -> list[Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    return value if isinstance(value, list) else []


async def claim_threecx_call(
    *,
    company_id: str,
    pbx_call_id: str,
    event_id: str,
    event_type: str,
    did: str,
    direction: str,
    lease_seconds: int = 45,
) -> dict[str, Any]:
    """Atomically deduplicate a PBX event and claim its call for one adapter.

    This only establishes a durable, tenant-bound claim. It does not dispatch a
    LiveKit agent; the adapter must advance the call through the guarded state
    transition API and preserve the returned token for recovery/cleanup.
    """
    pbx_call_id = pbx_call_id.strip()
    event_id = event_id.strip()
    did = did.strip()
    event_type = event_type.strip()
    if not company_id or not pbx_call_id or not event_id or not event_type or not did:
        raise ValueError("company_id, PBX call ID, and event ID are required")
    if len(pbx_call_id) > 255 or len(event_id) > 255 or len(event_type) > 96 or len(did) > 64:
        raise ValueError("3CX call or event identifier exceeds its storage limit")
    if direction not in {"inbound", "outbound"}:
        raise ValueError("unsupported 3CX call direction")
    if not 5 <= lease_seconds <= 300:
        raise ValueError("3CX call claim lease must be between 5 and 300 seconds")
    company_uuid = uuid.UUID(company_id)
    room_name = threecx_room_name(company_id, pbx_call_id)
    claim_token = uuid.uuid4()
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            integration = await conn.fetchrow(
                "SELECT dids, state FROM threecx_integrations WHERE company_id = $1 FOR SHARE",
                company_uuid,
            )
            configured_dids = {str(value).strip() for value in _json_list(integration["dids"])} if integration else set()
            if not integration or integration["state"] != "active" or did not in configured_dids:
                raise PermissionError("No active 3CX integration is configured for this DID")

            inserted_event = await conn.fetchrow(
                """INSERT INTO threecx_event_inbox
                   (company_id, event_id, pbx_call_id, event_type)
                   VALUES ($1, $2, $3, $4)
                   ON CONFLICT (company_id, event_id) DO NOTHING
                   RETURNING event_id""",
                company_uuid, event_id, pbx_call_id, event_type,
            )
            if not inserted_event:
                return {"claimed": False, "reason": "duplicate_event"}

            inserted_call = await conn.fetchrow(
                """INSERT INTO threecx_call_sessions
                   (company_id, pbx_call_id, did, direction, claim_token,
                    lease_expires_at, livekit_room)
                   VALUES ($1, $2, $3, $4, $5, NOW() + $6::interval, $7)
                   ON CONFLICT (company_id, pbx_call_id) DO NOTHING
                   RETURNING company_id, pbx_call_id, did, direction, state,
                             claim_token, lease_expires_at, livekit_room, livekit_dispatch_id""",
                company_uuid, pbx_call_id, did, direction, claim_token,
                timedelta(seconds=lease_seconds), room_name,
            )
            if inserted_call:
                outcome = "processed"
                call_data = dict(inserted_call)
                claimed = True
            else:
                existing = await conn.fetchrow(
                    """SELECT company_id, pbx_call_id, did, direction, state,
                              claim_token, lease_expires_at, livekit_room, livekit_dispatch_id
                       FROM threecx_call_sessions WHERE company_id = $1 AND pbx_call_id = $2""",
                    company_uuid, pbx_call_id,
                )
                if not existing:
                    raise RuntimeError("3CX call conflict was not visible in the tenant scope")
                if existing["did"] != did or existing["direction"] != direction:
                    outcome = "rejected"
                    claimed = False
                    call_data = dict(existing)
                else:
                    outcome = "duplicate"
                    claimed = False
                    call_data = dict(existing)

            await conn.execute(
                """UPDATE threecx_event_inbox SET outcome = $3, processed_at = NOW()
                   WHERE company_id = $1 AND event_id = $2""",
                company_uuid, event_id, outcome,
            )
            return {"claimed": claimed, "reason": outcome, "call": call_data}


async def transition_threecx_call(
    *, company_id: str, pbx_call_id: str, claim_token: uuid.UUID,
    expected_state: str, new_state: str, livekit_dispatch_id: str | None = None,
) -> bool:
    """Apply a compare-and-set transition; terminal calls cannot be resurrected."""
    if new_state not in THREECX_CALL_TRANSITIONS.get(expected_state, set()):
        raise ValueError(f"illegal 3CX call transition: {expected_state} -> {new_state}")
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            result = await conn.execute(
                """UPDATE threecx_call_sessions
                   SET state = $5,
                       livekit_dispatch_id = COALESCE($6, livekit_dispatch_id),
                       updated_at = NOW(),
                       ended_at = CASE WHEN $5 IN ('ended', 'failed') THEN NOW() ELSE ended_at END
                   WHERE company_id = $1 AND pbx_call_id = $2 AND claim_token = $3
                     AND state = $4""",
                uuid.UUID(company_id), pbx_call_id, claim_token, expected_state,
                new_state, livekit_dispatch_id,
            )
            return result.endswith("1")


async def renew_threecx_call_lease(
    *, company_id: str, pbx_call_id: str, claim_token: uuid.UUID,
    lease_seconds: int = 45,
) -> bool:
    """Renew only the matching adapter's non-terminal call claim."""
    if not 5 <= lease_seconds <= 300:
        raise ValueError("3CX call claim lease must be between 5 and 300 seconds")
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            result = await conn.execute(
                """UPDATE threecx_call_sessions
                   SET lease_expires_at = NOW() + $4::interval, updated_at = NOW()
                   WHERE company_id = $1 AND pbx_call_id = $2 AND claim_token = $3
                     AND state NOT IN ('ended', 'failed')
                     AND lease_expires_at > NOW()""",
                uuid.UUID(company_id), pbx_call_id, claim_token,
                timedelta(seconds=lease_seconds),
            )
            return result.endswith("1")


async def get_threecx_integration(company_id: str) -> Optional[dict[str, Any]]:
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            row = await conn.fetchrow(
                """SELECT company_id, connection_name, pbx_hostname, app_id, route_point_dn,
                      dids, transfer_destinations, failure_action, failure_destination,
                      state, credential_updated_at,
                      last_checked_at, created_at, updated_at
                 FROM threecx_integrations WHERE company_id = $1""",
                uuid.UUID(company_id),
            )
        return dict(row) if row else None


async def list_threecx_call_sessions(
    *, company_id: str, limit: int = 50,
) -> list[dict[str, Any]]:
    """List safe display metadata for one tenant's recent call-session claims.

    PBX call IDs, claim tokens, LiveKit rooms/dispatch IDs, event payloads,
    phone numbers, and transcripts are deliberately excluded.
    """
    if not 1 <= limit <= 100:
        raise ValueError("call history limit must be between 1 and 100")
    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_uuid))
            rows = await conn.fetch(
                """SELECT did, direction, state, created_at, updated_at, ended_at
                   FROM threecx_call_sessions
                   WHERE company_id = $1
                   ORDER BY created_at DESC, pbx_call_id DESC
                   LIMIT $2""",
                company_uuid,
                limit,
            )
    return [dict(row) for row in rows]


async def save_threecx_integration(
    *, company_id: str, connection_name: str, pbx_hostname: str, app_id: str,
    route_point_dn: str, client_secret_ciphertext: str, encryption_envelope: dict[str, Any],
    dids: list[str], transfer_destinations: list[str], failure_action: str,
    failure_destination: str | None, state: str = "active",
) -> dict[str, Any]:
    transfer_destinations = [
        str(value).strip() for value in transfer_destinations if str(value).strip()
    ]
    approved_destinations = set(transfer_destinations)
    if failure_action == "disconnect":
        if failure_destination is not None:
            raise ValueError("disconnect failure policy cannot include a transfer destination")
    elif failure_action == "transfer":
        if not failure_destination or failure_destination.strip() not in approved_destinations:
            raise ValueError("failure transfer destination must be explicitly allowlisted")
        failure_destination = failure_destination.strip()
    else:
        raise ValueError("a supported 3CX call failure policy is required")

    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            row = await conn.fetchrow(
                """INSERT INTO threecx_integrations
                   (company_id, connection_name, pbx_hostname, app_id, route_point_dn,
                    api_key_ciphertext, encryption_envelope, dids,
                    transfer_destinations, state, failure_action,
                    failure_destination, credential_updated_at,
                    last_checked_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,NOW(),NOW(),NOW())
                 ON CONFLICT (company_id) DO UPDATE SET
                   connection_name=EXCLUDED.connection_name,
                   pbx_hostname=EXCLUDED.pbx_hostname,
                   app_id=EXCLUDED.app_id,
                   route_point_dn=EXCLUDED.route_point_dn,
                   api_key_ciphertext=EXCLUDED.api_key_ciphertext,
                   encryption_envelope=EXCLUDED.encryption_envelope,
                   dids=EXCLUDED.dids,
                   transfer_destinations=EXCLUDED.transfer_destinations,
                   failure_action=EXCLUDED.failure_action,
                   failure_destination=EXCLUDED.failure_destination,
                   state=EXCLUDED.state,
                   credential_updated_at=NOW(), last_checked_at=NOW(), updated_at=NOW()
                 RETURNING company_id, connection_name, pbx_hostname, app_id, route_point_dn,
                   dids, transfer_destinations, failure_action, failure_destination,
                   state, credential_updated_at,
                   last_checked_at, created_at, updated_at""",
            uuid.UUID(company_id), connection_name, pbx_hostname, app_id, route_point_dn,
            client_secret_ciphertext, json.dumps(encryption_envelope), json.dumps(dids),
            json.dumps(transfer_destinations), state, failure_action,
            failure_destination,
            )
        return dict(row)


async def delete_threecx_integration(company_id: str) -> bool:
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            result = await conn.execute("DELETE FROM threecx_integrations WHERE company_id=$1", uuid.UUID(company_id))
        return result.endswith("1")


async def list_active_threecx_integrations() -> list[dict[str, Any]]:
    """Query all active 3CX integrations across companies for connector supervision."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT company_id, connection_name, pbx_hostname, app_id,
                      route_point_dn, api_key_ciphertext, encryption_envelope,
                      dids, transfer_destinations,
                      failure_action, failure_destination, state,
                      credential_updated_at, last_checked_at, updated_at
               FROM threecx_integrations
               WHERE state = 'active'
               ORDER BY updated_at DESC, company_id"""
        )
        results: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["dids"] = [str(v).strip() for v in _json_list(item.get("dids")) if str(v).strip()]
            item["transfer_destinations"] = [
                str(v).strip() for v in _json_list(item.get("transfer_destinations")) if str(v).strip()
            ]
            results.append(item)
        return results


def _normalize_phone_digits(value: str | None) -> str:
    if not value:
        return ""
    return "".join(ch for ch in str(value) if ch.isdigit())


async def resolve_active_sip_tenant(
    *,
    dialed_number: str | None = None,
    room_name: str | None = None,
) -> Optional[dict[str, Any]]:
    """Resolve the active 3CX tenant and its published profile for an inbound SIP trunk call."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT t.company_id,
                      t.route_point_dn,
                      t.dids,
                      t.updated_at,
                      p.version AS profile_version,
                      COALESCE(cp.timezone, 'Indian/Mauritius') AS timezone
               FROM threecx_integrations t
               JOIN agent_profile_versions p
                 ON p.company_id = t.company_id
                AND p.lifecycle_state = 'published'
               LEFT JOIN company_profiles cp
                 ON cp.user_id = t.company_id
               WHERE t.state = 'active'
               ORDER BY t.updated_at DESC"""
        )
        if not rows:
            return None

        selected = None
        target_raw = (dialed_number or "").strip()
        target_digits = _normalize_phone_digits(target_raw)
        if target_raw or target_digits:
            for row in rows:
                route_dn = str(row["route_point_dn"] or "").strip()
                dids = [str(v).strip() for v in _json_list(row["dids"]) if str(v).strip()]
                candidates = [route_dn, *dids]
                candidate_digits = {_normalize_phone_digits(c) for c in candidates if _normalize_phone_digits(c)}
                if target_raw in candidates or (target_digits and target_digits in candidate_digits):
                    selected = dict(row)
                    break

        if selected is None:
            selected = dict(rows[0])

        company_id = str(selected["company_id"])
        dids_list = [str(v).strip() for v in _json_list(selected["dids"]) if str(v).strip()]
        matched_did = (
            target_raw
            if target_raw and target_raw in dids_list
            else (dids_list[0] if dids_list else str(selected["route_point_dn"] or "4001"))
        )

        if room_name and room_name.strip():
            clean_room = room_name.strip()[:255]
            try:
                async with conn.transaction():
                    await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
                    await conn.execute(
                        """INSERT INTO threecx_call_sessions
                           (company_id, pbx_call_id, did, direction, state,
                            claim_token, lease_expires_at, livekit_room)
                           VALUES ($1, $2, $3, 'inbound', 'active', $4, NOW() + interval '1 hour', $5)
                           ON CONFLICT (company_id, pbx_call_id) DO UPDATE SET
                             state = 'active',
                             updated_at = NOW()""",
                        uuid.UUID(company_id),
                        clean_room,
                        matched_did[:64],
                        uuid.uuid4(),
                        clean_room,
                    )
            except Exception:
                pass

        return {
            "company_id": company_id,
            "profile_version": int(selected["profile_version"]),
            "timezone": str(selected["timezone"] or "Indian/Mauritius"),
            "route_point_dn": str(selected["route_point_dn"] or ""),
            "did": matched_did,
        }


async def complete_sip_call_session(
    *,
    company_id: str,
    room_name: str,
    final_state: str = "ended",
) -> bool:
    """Mark an inbound SIP call session as ended or failed."""
    if final_state not in {"ended", "failed"}:
        final_state = "ended"
    company_uuid = uuid.UUID(company_id)
    clean_room = room_name.strip()[:255]
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            result = await conn.execute(
                """UPDATE threecx_call_sessions
                   SET state = $3,
                       updated_at = NOW(),
                       ended_at = COALESCE(ended_at, NOW())
                   WHERE company_id = $1 AND pbx_call_id = $2""",
                company_uuid,
                clean_room,
                final_state,
            )
            return result.endswith("1")


