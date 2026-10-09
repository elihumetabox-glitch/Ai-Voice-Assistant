# Railway Development Backend Deployment Guide

This guide is for an AI coding agent preparing a **shared development** deployment of the backend processes in Railway. The Next.js frontend stays in its own deployment or runs locally. Production deployment and production database migration are out of scope; follow [`docs/PRODUCTION_ROLLOUT_CHECKLIST.md`](docs/PRODUCTION_ROLLOUT_CHECKLIST.md) for that work.

## Current repository facts

The repository now has a root `Dockerfile` and `.dockerignore`. The Dockerfile uses the repository root as its build context, installs both backend and worker requirements, and includes the shared `backend/`, `agent/`, and `db/` Python packages so each Railway service can run its own process from the same image. It runs as a non-root user and defaults to the API command; Railway must override the start command for the broker and worker. The `.dockerignore` excludes local credentials/configuration, Git and developer state, and frontend assets. Review and build these files before deploying; do not add credentials to them.

The process entrypoints are:

| Railway service | Start command from repository root | Public network |
| --- | --- | --- |
| General API | `python -m uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT` | HTTPS ingress enabled for the frontend and OAuth callback. Protect application routes with the existing signed-session checks. |
| Credential broker | `python -m uvicorn backend.credential_broker.main:app --host 0.0.0.0 --port $PORT` | No public domain or public ingress. The API reaches it using Railway private networking and request HMAC authentication. |
| LiveKit worker | `python agent/agent.py start` | No public domain. It connects outbound to LiveKit and the API. |
| Calendar booking worker | `python -m backend.booking_worker` | No public domain. It polls the dedicated Neon booking queue and calls the private credential broker. |
| 3CX Connector Supervisor | `node run-supervisor.mjs` (Root Directory `/connector`) | No public domain. Connects outbound to 3CX PBXs, LiveKit Cloud, and private Credential Broker. |

Railway should build each service from the same GitHub repository, branch, and root Dockerfile, with the root as the build context. Configure the service-specific start command in Railway. The API and broker listen on Railway's injected `$PORT`; do not hard-code a container port. The worker services are long-running processes, not public HTTP APIs. The LiveKit worker health/metrics listener uses port `8081` in the current code; do not create public ingress for it.

### Communication paths

```text
Browser -> Next.js frontend -> HTTPS General API -> Neon (tenant RLS)
                                      |
                                      +-- Railway private network + HMAC --> Credential broker
                                                                              |-> Neon
                                                                              +-> Google APIs
LiveKit Cloud <---- outbound worker connection (LiveKit worker) <---- General API
```

The browser uses the Next.js same-origin API routes. The frontend's server-side `BACKEND_URL` points to the API's HTTPS Railway domain for a separately hosted/local frontend, or its private Railway hostname if Next.js later joins the same Railway private network. The existing `/auth/google/*` frontend route proxies to the API; configure Google's OAuth redirect URI to the frontend origin plus `/auth/google/callback`, so the callback passes through that proxy. The broker must only be reachable on Railway private networking. The worker makes outbound connections; it does not need a public domain.

## Ordered implementation and deployment workflow

1. **Inspect and validate the container.** Confirm the checked-out commit and current Python requirements. Review the root Dockerfile and `.dockerignore`; preserve the repository-root build context and required `backend/`, `agent/`, and `db/` source packages. Do not copy `.env`, local virtual environments, logs, `.runtime/`, frontend build output, or Neon CLI state into the image. Do not add secrets as `ARG`, `ENV`, build arguments, or copied files. Build the image and verify it contains no credentials before configuring Railway.
2. **Create/select a Railway development environment.** Use four services named for the API, credential broker, LiveKit worker, and Calendar booking worker. Select the same development branch/commit, root directory, root Dockerfile, and build context for all four. Set the process-specific start command from the table above. Configure health checks for the API and broker; only the API receives a public HTTPS domain. Both workers are persistent services, not web services.
3. **Provision an isolated Neon development target.** Use a dedicated non-production Neon branch and a dedicated `LOGIN NOSUPERUSER NOBYPASSRLS` application role for API/broker traffic. Set `DATABASE_URL` only on the API and broker. After migration `023`, provision a separate booking worker role using `db/provision_booking_worker_role.py`; it has `BYPASSRLS` only to claim cross-tenant requests and table grants only on `calendar_booking_requests`. Set its URL only as `BOOKING_WORKER_DATABASE_URL` on the booking worker. Never reuse this identity on another service. Do not set unpooled or migration-owner credentials on runtime services.
4. **Set Railway variables by service.** Use the matrices below. Generate independent secrets for `LIVEKIT_SESSION_CONTEXT_SECRET`, `GOOGLE_OAUTH_STATE_SECRET`, `CREDENTIAL_BROKER_SHARED_SECRET`, and the development `CREDENTIAL_ENCRYPTION_KEY`. Share the session-context secret only between API, LiveKit worker, and Next.js server. Share the broker HMAC secret with API, broker, and booking worker. Never reuse production secrets.
5. **Configure Google OAuth for development.** Set the Google client ID on the API and broker, and the client secret only on the broker. Use a development OAuth client and test Google account/calendar with minimal test data. Set `GOOGLE_REDIRECT_URI` to `https://<frontend-host>/auth/google/callback` (or the local frontend origin when testing locally). Add that exact URI to the Google OAuth client and add the exact frontend origin to OAuth authorized JavaScript origins where required. OAuth consent-screen test users and Calendar API enablement must be configured in Google Cloud.
6. **Deploy from GitHub.** Apply migration `023`, provision the booking worker role, then deploy API and broker. Deploy both worker services after their variables are set. Confirm root Dockerfile/build context and inspect sanitized startup logs.
7. **Configure the frontend separately.** Set the Next.js server-side `BACKEND_URL` to the API's HTTPS Railway URL (or private Railway URL when the frontend is on Railway). Set `LIVEKIT_SESSION_CONTEXT_SECRET` to the same development value used by the API and worker. Set `NEON_AUTH_URL` (or supported alias `NEON_AUTH_BASE_URL`) to the Neon Auth endpoint for the isolated development branch. Do not put database, Google client secret, broker HMAC, encryption, or LiveKit API secrets in browser-visible `NEXT_PUBLIC_*` variables.
8. **Check service health and acceptance.** Confirm API `GET /health` and broker `GET /health` report healthy over their intended network paths. Verify the API reports its database connected. Confirm the worker registers with LiveKit and receives a test dispatch. From the frontend, verify sign-in, a same-origin backend request, Google OAuth consent/callback, connected-account email display, and a Calendar read. Use two separate development companies to verify cross-tenant access is denied before using this shared environment for collaborator testing.

## Environment variables

Values below are names only. Put secret values in Railway's runtime variable store. Do not commit values, paste them into source control, build logs, Docker layers, Docker build arguments, or images. Limit each value to the service that needs it.

### General API service

| Variable | Type | Notes |
| --- | --- | --- |
| `APP_ENV` | Ordinary setting | Set to `development` for this shared development deployment. |
| `DATABASE_URL` | Secret | Development Neon branch URL using the dedicated non-bypass-RLS runtime role. |
| `LIVEKIT_URL` | Service credential/configuration | LiveKit Cloud WebSocket URL; needed for token issuance. |
| `LIVEKIT_API_KEY` | Secret | LiveKit server credential. |
| `LIVEKIT_API_SECRET` | Secret | LiveKit server credential. |
| `LIVEKIT_SESSION_CONTEXT_SECRET` | Secret | Same value as Next.js server and worker. |
| `LIVEKIT_SESSION_CONTEXT_MAX_AGE_SECONDS` | Ordinary setting | Keep at the current short default, `300`, unless a reviewed need requires another value within the code's 900-second maximum. |
| `GOOGLE_CLIENT_ID` | Configuration | OAuth client ID, not secret. |
| `GOOGLE_REDIRECT_URI` | Configuration | Exact frontend callback URL ending in `/auth/google/callback`. |
| `GOOGLE_OAUTH_STATE_SECRET` | Secret | Signs and validates one-time OAuth state in the API. |
| `CREDENTIAL_BROKER_URL` | Internal URL | Broker's Railway private hostname and listening port, with `http://` scheme and no path/query. |
| `CREDENTIAL_BROKER_SHARED_SECRET` | Secret | HMAC key shared only with the credential broker. |
| `CORS_ORIGINS` | Configuration | Comma-separated exact approved frontend origins, including scheme; no wildcard. This is consumed by the API but is not currently listed in the root `.env.example`. |

The API must not receive `GOOGLE_CLIENT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_KMS_KEY_ID`, AWS credentials, `DATABASE_URL_UNPOOLED`, or `RUNTIME_DB_PASSWORD`.

### Credential broker service

| Variable | Type | Notes |
| --- | --- | --- |
| `APP_ENV` | Ordinary setting | `development`. |
| `NEON_BRANCH` | Ordinary setting | Exact isolated development branch name; must not be `production`, `main`, or `primary`. |
| `DATABASE_URL` | Secret | Same development branch, dedicated non-bypass-RLS runtime role. |
| `CREDENTIAL_BROKER_SHARED_SECRET` | Secret | Must exactly match the API's HMAC key. |
| `GOOGLE_CLIENT_ID` | Configuration | OAuth client ID used for code exchange. |
| `GOOGLE_CLIENT_SECRET` | Secret | Broker only. |
| `GOOGLE_REDIRECT_URI` | Configuration | Must match the API's redirect URI and Google's registered URI. |
| `CREDENTIAL_KEY_PROVIDER` | Ordinary setting | Set to `env` for this development-only deployment. |
| `CREDENTIAL_ENCRYPTION_KEY` | Secret | Development-only URL-safe base64 key decoding to exactly 32 bytes. Broker only. |
| `CREDENTIAL_ENCRYPTION_KEY_VERSION` | Ordinary setting | Keep consistent with the key version used for development credentials. |

Do not set LiveKit or Gemini credentials on the broker. Railway private networking plus the broker's timestamped, nonce-protected HMAC request verification are both required; a private hostname does not replace request authentication.

### LiveKit worker service

| Variable | Type | Notes |
| --- | --- | --- |
| `LIVEKIT_URL` | Service credential/configuration | LiveKit Cloud WebSocket URL. |
| `LIVEKIT_API_KEY` | Secret | LiveKit server credential. |
| `LIVEKIT_API_SECRET` | Secret | LiveKit server credential. |
| `GOOGLE_API_KEY` | Secret | Gemini API key used by the LiveKit Google realtime plugin. |
| `BACKEND_URL` | Internal URL | API's Railway private hostname and listening port. |
| `LIVEKIT_SESSION_CONTEXT_SECRET` | Secret | Same value as API and Next.js server. |
| `LIVEKIT_SESSION_CONTEXT_MAX_AGE_SECONDS` | Ordinary setting | Same short lifetime policy as the API. |
| `LIVEKIT_AGENT_NAME` | Ordinary setting | Optional; defaults to `calendar-assistant`. |
| `GEMINI_MODEL`, `GEMINI_API_VERSION`, `GEMINI_VOICE`, `BACKEND_TIMEOUT_SECONDS` | Ordinary settings | Optional code-supported tuning; retain repository defaults initially. |

The LiveKit worker must not receive `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, Google OAuth client secrets, broker HMAC/encryption secrets, or AWS credentials.

### Calendar booking worker service

| Variable | Type | Notes |
| --- | --- | --- |
| `APP_ENV`, `NEON_BRANCH` | Ordinary setting | Must identify the isolated branch used by the application. |
| `BOOKING_WORKER_DB_ROLE` | Ordinary setting | Must match the PostgreSQL login used by `BOOKING_WORKER_DATABASE_URL`; defaults to `calendar_booking_worker`. |
| `BOOKING_WORKER_DATABASE_URL` | Secret | Dedicated booking worker role URL; never use API runtime or migration-owner credentials. |
| `CREDENTIAL_BROKER_URL` | Internal URL | Private Railway hostname for the credential broker. |
| `CREDENTIAL_BROKER_SHARED_SECRET` | Secret | Same broker HMAC key used by the API and broker. |

The booking worker must not receive the general `DATABASE_URL`, Google OAuth client credentials, credential encryption key, LiveKit credentials, or Gemini key.

### 3CX Connector Supervisor service

| Variable | Type | Notes |
| --- | --- | --- |
| `CREDENTIAL_BROKER_URL` | Internal URL | Private Railway hostname for the credential broker, e.g. `http://credential-broker.railway.internal:8001`. |
| `CREDENTIAL_BROKER_SHARED_SECRET` | Secret | Same broker HMAC key shared with API, broker, and booking worker. |
| `LIVEKIT_URL` | Service credential/configuration | LiveKit Cloud WebSocket URL, e.g. `wss://ai-voice-assistant-vu6rr406.livekit.cloud`. |
| `LIVEKIT_API_KEY` | Secret | LiveKit server credential. |
| `LIVEKIT_API_SECRET` | Secret | LiveKit server credential. |
| `LIVEKIT_SESSION_CONTEXT_SECRET` | Secret | Same value as API and worker. |
| `LIVEKIT_AGENT_NAME` | Ordinary setting | Defaults to `calendar-assistant`. |
| `RECONCILE_INTERVAL_MS` | Ordinary setting | Tenant reconciliation polling frequency; defaults to `15000` (15s). |

The 3CX Connector Supervisor discovers all active companies dynamically via `GET /internal/v1/threecx/active-tenants` and runs isolated call runtimes for each account configured in the web app's Integrations page.

### Separately hosted or local Next.js frontend

| Variable | Type | Notes |
| --- | --- | --- |
| `BACKEND_URL` | URL | Public HTTPS API URL for a separately hosted/local frontend; use Railway private networking if Next.js later runs inside the same Railway network. |
| `LIVEKIT_SESSION_CONTEXT_SECRET` | Secret | Server-side Next.js only; same development value as API and worker. |
| `NEON_AUTH_URL` or `NEON_AUTH_BASE_URL` | URL | Neon Auth endpoint for the isolated development branch. |

Never expose these as `NEXT_PUBLIC_*`. The browser receives the LiveKit connection token from the authenticated server flow; it must not receive the LiveKit API secret or the session-context signing key.

### Names present in `.env.example`

The repository template currently defines `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GOOGLE_API_KEY`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `APP_ENV`, `RUNTIME_DB_ROLE`, `RUNTIME_DB_PASSWORD`, `LIVEKIT_SESSION_CONTEXT_SECRET`, `LIVEKIT_SESSION_CONTEXT_MAX_AGE_SECONDS`, `NEON_AUTH_URL`, `NEON_AUTH_BASE_URL`, `GOOGLE_OAUTH_STATE_SECRET`, `CREDENTIAL_BROKER_URL`, `CREDENTIAL_BROKER_SHARED_SECRET`, `CREDENTIAL_KEY_PROVIDER`, `CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_ENCRYPTION_KEY_VERSION`, `CREDENTIAL_KMS_KEY_ID`, `AWS_REGION`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `TRIGGER_API_KEY`. This guide also names settings present in application code but currently missing from `.env.example`, notably `BACKEND_URL`, `BACKEND_PORT`, `BACKEND_HOST`, `CORS_ORIGINS`, and `GOOGLE_REDIRECT_URI`; update the template in the later container-configuration task if it is brought into scope.

Do not put `DATABASE_URL_UNPOOLED`, `RUNTIME_DB_PASSWORD`, `CREDENTIAL_KMS_KEY_ID`, or `AWS_REGION` on ordinary development runtime services. Do not configure `TRIGGER_API_KEY` unless a deployed code path in this environment actually uses it.

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| Docker build cannot find `backend`, `agent`, or `db` | Ensure Railway's root directory/build context is the repository root and `.dockerignore` does not exclude required source packages. |
| `ModuleNotFoundError` at startup | Confirm the root package directories were copied to the image and the correct backend and agent requirements were installed. Run each listed start command from the repository root. |
| API or broker exits / health check fails | Confirm the service binds `0.0.0.0` and the injected `$PORT`; inspect sanitized startup logs and the `/health` response. Only the API and broker provide HTTP health endpoints. |
| Database is unreachable or RLS denies legitimate access | Confirm `DATABASE_URL` targets the named development Neon branch and the runtime role has `NOBYPASSRLS`; check migrations were applied to that branch. Never solve this by using the owner role or disabling RLS. |
| Broker returns 401/503 | Confirm private URL, API/broker `CREDENTIAL_BROKER_SHARED_SECRET` match, and system clocks are synchronized. A 503 may mean Neon nonce replay protection is unavailable; keep requests fail-closed. Do not make the broker public to troubleshoot. |
| Browser reports CORS errors | Confirm the exact frontend origin (scheme and hostname, no trailing path) is in API `CORS_ORIGINS`; avoid wildcard origins with credentials. Prefer the existing same-origin Next.js proxy routes. |
| Google OAuth redirect mismatch | `GOOGLE_REDIRECT_URI`, Google Cloud authorized redirect URI, and the frontend proxy callback must match exactly. Use the frontend `/auth/google/callback` URL for this architecture. |
| LiveKit worker does not register or receive dispatch | Check `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, agent start command, and `LIVEKIT_AGENT_NAME` agreement with API dispatch. Confirm outbound WebSocket access; do not expose worker port `8081` publicly. |
| Voice connects but tool requests fail | Check worker `BACKEND_URL` uses the API private hostname and port, API and worker share `LIVEKIT_SESSION_CONTEXT_SECRET`, and API requests pass the signed context checks. |
| Frontend returns 502 for backend requests | Check Next.js server-side `BACKEND_URL`, API HTTPS domain availability, and API `/health`. Do not place the broker URL in frontend variables. |

## Development acceptance checklist

- [ ] All three services build from the same GitHub commit with repository-root context and no secret files in the image.
- [ ] The API and broker return healthy status; API health reports `database: connected`.
- [ ] Broker has no public domain; API-to-broker communication uses private networking and HMAC authentication.
- [ ] API `CORS_ORIGINS` contains only approved frontend origins.
- [ ] LiveKit worker registers and receives exactly one test session dispatch; its service has no public domain.
- [ ] Next.js can reach API routes using server-only `BACKEND_URL`; the browser calls the same-origin frontend routes.
- [ ] Neon Auth sign-in uses the isolated development branch; Google OAuth callback and displayed account email work.
- [ ] Two company contexts cannot read or mutate one another's data or Google integration metadata.
- [ ] No secrets appear in Git, image layers, Docker build args, frontend bundles, or logs.
- [ ] No production Neon branch, production OAuth client, or production customer data was used.

## Production is out of scope

This guide creates a shared development environment only. Do not treat Railway environment variables or this deployment as production-ready credential protection. Production credential encryption requires `CREDENTIAL_KEY_PROVIDER=aws-kms`, `CREDENTIAL_KMS_KEY_ID`, `AWS_REGION`, and a dedicated AWS workload identity limited to the credential broker. Static AWS access keys and `CREDENTIAL_ENCRYPTION_KEY` are not acceptable for production. Follow [`docs/PRODUCTION_ROLLOUT_CHECKLIST.md`](docs/PRODUCTION_ROLLOUT_CHECKLIST.md) and [`docs/AWS_KMS_SETUP.md`](docs/AWS_KMS_SETUP.md) before any production rollout.

## Railway references

- [Railway private domains](https://docs.railway.com/networking/domains/working-with-domains#private-domains)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway environment variables and Docker builds](https://docs.railway.com/guides/build-time-vs-runtime-secrets)
- [Railway deployments and GitHub autodeploys](https://docs.railway.com/build-deploy#deployments)
