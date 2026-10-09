# Mobile LiveKit integration

> Project: AI Voice Bot mobile client (Expo React Native)  
> Last updated: 2026-09-29  
> Implementation status: code complete; physical-device verification pending

## Architecture

```text
Expo mobile app
  │  HTTPS + authenticated session cookie
  ▼
Next.js app: GET /api/livekit/token
  │  verifies login and signs X-Verified-Session-Context server-side
  ▼
Railway FastAPI: GET /api/livekit/token
  │  creates/reuses room, dispatches calendar-assistant, returns short-lived JWT
  ▼
LiveKit Cloud ◄──────── WebRTC audio/data ────────► Expo mobile app
      │
      └──────── Python calendar-assistant worker
```

The HMAC session-context secret remains server-side. The mobile application never creates or supplies `X-Verified-Session-Context`; it calls the authenticated Next.js proxy, which derives trusted tenant identity from the login session.

## Milestones

| Milestone | Deliverables | Status |
| --- | --- | --- |
| M1 — Native WebRTC | Expo plugins, LiveKit packages, Android/iOS permissions, `registerGlobals()` | Complete |
| M2 — Token and room lifecycle | Authenticated token client, native `AudioSession`, room/reconnect lifecycle, mic and audio output controls | Complete |
| M3 — Voice UI | `VoiceAssistant`, live transcript, task status, audio levels, mute/speaker/interrupt/end controls | Complete |
| M4 — Verification | Typecheck, config validation, automated tests, device protocol | Automated checks complete; device run pending |
| M5 — Modern UI & Keyboard Architecture | `KeyboardAwareScrollView`, redesigned Dashboard, Settings, Calls, Integrations, 4-tier test suite (89/89 tests passing) | Complete |

## Implemented files

- `mobile/app.json` — native plugins and microphone/audio permissions.
- `mobile/app/_layout.tsx` — registers LiveKit WebRTC globals before rooms are created.
- `mobile/src/services/livekitApi.ts` — calls the authenticated `/api/livekit/token` proxy with a stable session ID and validates the FastAPI response.
- `mobile/src/hooks/useVoiceBot.ts` — owns the LiveKit room, native audio session, reconnection state, microphone publication, output routing, transcripts, task updates, and teardown.
- `mobile/src/components/VoiceAssistant.tsx` — production call UI.
- `mobile/src/screens/LiveCallModal.tsx` — mounts the assistant from the existing `/live-call` route.
- `mobile/tests/livekitApi.test.ts` — executes the production token client contract.

The retired `useMobileLiveKitSession` prototype was removed. It used browser-only Web Audio APIs, silently fell back to a simulated call, and targeted the disabled legacy `/api/livekit-token` route.

## Runtime behavior

1. The voice screen requests a token from the authenticated Next.js proxy.
2. The hook configures LiveKit's communication audio preset and starts the native audio session.
3. The client connects to the returned LiveKit Cloud URL and publishes one microphone track.
4. Native LiveKit playback handles subscribed agent audio. `ActiveSpeakersChanged` drives the speaking state and audio-level UI.
5. DataChannel `transcript` and `task_update` messages update the UI.
6. The Interrupt control sends reliable `{ "type": "response.cancel" }` only while the agent is speaking.
7. End call, connection failure, or unmount disconnects the room and stops the native audio session.

## Environment

Create `mobile/.env` locally:

```env
# Public URL of the Next.js app that owns authentication and /api/livekit/token.
# On a physical device, do not use localhost; use an HTTPS deployment or a LAN URL.
EXPO_PUBLIC_APP_URL=https://your-app.example.com

# Public Railway FastAPI URL used by the app's non-voice API screens.
EXPO_PUBLIC_BACKEND_URL=https://your-api.up.railway.app
```

`EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT` may override the complete token URL for testing. `LIVEKIT_API_SECRET` and `LIVEKIT_SESSION_CONTEXT_SECRET` must never be placed in an `EXPO_PUBLIC_*` variable.

## How a packaged APK connects

The APK contains the public URLs, not backend credentials. Expo replaces `EXPO_PUBLIC_*` references while bundling the JavaScript, so these values must be set before building:

```powershell
$env:EXPO_PUBLIC_APP_URL = 'https://your-app.example.com'
$env:EXPO_PUBLIC_BACKEND_URL = 'https://your-api.up.railway.app'
npx expo run:android --variant release
```

For a release/EAS build, set the same variables in the selected EAS build environment before invoking the Android build. Changing either URL requires another build; the current app does not fetch runtime configuration from an untrusted remote file.

At runtime the packaged app follows this sequence:

1. The user signs in through the app URL in `EXPO_PUBLIC_APP_URL`.
2. The app requests `GET https://your-app.example.com/api/livekit/token` with `credentials: "include"` and a generated `session_id`.
3. The Next.js proxy validates the authenticated session, creates the trusted HMAC context, and calls Railway FastAPI. The APK never sees or creates that HMAC secret.
4. FastAPI creates/reuses the LiveKit room, dispatches `calendar-assistant`, and returns `{ token, ws_url, room, identity, session_id }`.
5. The APK calls `Room.connect(ws_url, token)`. The token is short-lived; the LiveKit API key, API secret, Gemini credentials, and database credentials remain on server-side services.

The deployed Next.js service must therefore have its `BACKEND_URL`, `LIVEKIT_SESSION_CONTEXT_SECRET`, and authenticated-session configuration set, while Railway must have `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and a registered `calendar-assistant` worker. The APK should not call the FastAPI token endpoint directly.

For a physical-device test against a laptop, replace `localhost` with a LAN-reachable HTTPS/HTTP address and allow the device to reach it. `localhost` inside an APK means the phone itself, not the development computer.

## Verification completed

- `npm run lint` — TypeScript passed.
- `npm test` — 83 assertions passed, including three tests that execute `mobile/src/services/livekitApi.ts` directly.
- `npx expo config --type public` — Expo 57 resolves both LiveKit config plugins and the required native permissions.
- `npx expo install --check` — dependencies match Expo SDK 57's expected versions.
- `npm ci --dry-run --ignore-scripts` — the lockfile is reproducible.
- Dependency resolution uses Expo-compatible versions: `@livekit/react-native@3.0.0`, `@livekit/react-native-webrtc@144.2.0`, `@livekit/react-native-expo-plugin@1.0.3`, and `@config-plugins/react-native-webrtc@15.0.2`.
- `npm audit --omit=dev` reports 0 high/critical and 14 moderate advisories in the Expo/router/config-plugin dependency chain. npm's proposed automatic fixes downgrade to incompatible major versions, so no forced audit fix was applied.

## Live progress log

- **2026-09-29 19:18** — Antigravity created the mobile architecture plan and split the work into M1–M4.
- **2026-09-29 19:41** — Antigravity completed the initial Expo plugin and native-permission setup.
- **2026-09-29 19:48** — Antigravity added the first token client, state-machine draft, and simulation harness; 80 harness assertions passed. Voice UI work remained in progress.
- **2026-09-29 20:00** — Codex audited `mobile.md`, the new files, the existing browser-oriented mobile hook, the authenticated Next.js proxy, the FastAPI token endpoint, and the Python LiveKit agent contract.
- **2026-09-29 20:05** — Audit found that the initial tests exercised a duplicated JavaScript harness rather than the TypeScript production client. The real typecheck was initially unavailable because mobile dependencies were not installed.
- **2026-09-29 20:07** — The first clean install exposed an incompatible dependency graph: `@config-plugins/react-native-webrtc@12` only supported Expo 53 while the app uses Expo 57. No force/legacy-peer override was used.
- **2026-09-29 20:13** — LiveKit and WebRTC packages were aligned to Expo 57-compatible releases. Official SDK API review found and removed the draft's nonexistent `AudioSession.setSpeakerphoneOn(...)` usage in favor of `AudioSession.selectAudioOutput(...)`.
- **2026-09-29 20:18** — Token acquisition was corrected to use the authenticated Next.js `/api/livekit/token` proxy. Client-side HMAC generation was removed; trusted `X-Verified-Session-Context` signing remains server-to-server.
- **2026-09-29 20:21** — `useVoiceBot.ts` was completed with native audio configuration, room lifecycle and reconnection handling, microphone publication, native audio routing, DataChannel transcripts/tasks, interruption, telemetry, and teardown.
- **2026-09-29 20:24** — `VoiceAssistant.tsx` was completed and mounted in the existing `/live-call` modal route. The unused browser-only `useMobileLiveKitSession` prototype and silent demo fallback were removed.
- **2026-09-29 20:27** — Production token-client tests were added. The test suite was corrected so it no longer claims the mobile client sends the trusted HMAC header.
- **2026-09-29 20:30** — React best-practices review completed; async control races and disconnected-room listener cleanup were corrected.
- **2026-09-29 20:31** — Expo compatibility check requested four patch alignments (`expo`, `expo-constants`, `expo-router`, and `react-native-svg`); all four were applied.
- **2026-09-29 20:34** — Final automated gate passed: TypeScript clean, 83/83 tests passed, Expo dependency check passed, and `npm ci --dry-run` confirmed the lockfile is reproducible.
- **2026-09-29 20:36** — Production dependency audit recorded 0 high/critical and 14 moderate Expo-chain advisories. The suggested fixes require incompatible major downgrades and were intentionally not forced.
- **Pending** — Run the development build on physical Android/iOS hardware and complete the acoustic, route-switching, authenticated token, reconnect, and end-to-end agent checks below.
- **2026-09-29 20:42** — Documented the packaged APK connection sequence, build-time environment injection, server prerequisites, and the `localhost`/physical-device constraint.
- **2026-09-29 21:00** — Added EAS development/preview/production APK profiles and a pre-build public URL/secret validator. Production origins, EAS project/signing, backend deployment, and physical-device validation remain release blockers.
- **2026-09-29 21:15** — Added the staged execution tracker. Stage 4 automated checks and Stage 5 repository configuration are complete; authentication/API correctness, native OAuth, deployment identity, and physical-device stages remain blocked or partial.
- **2026-09-29 21:45** — Stage 1 implementation pass completed: email sign-in now advances only after session verification; protected routes redirect unauthenticated users; `/setup` routing is corrected; demo/fabricated data and false save/disconnect success paths were removed. Automated lint/tests pass. Development-device validation and full loading/retry/empty-state coverage remain pending.
- **2026-09-29 22:10** — Stage 2 proxy-routing pass completed: authenticated mobile API calls no longer fall back to direct FastAPI URLs; tool payloads use the Next.js contract; task list/status/cancel routes are aligned and protected. Mobile lint/tests pass; deployed signed-context verification remains pending.
- **2026-09-29 22:35** — Stage 3 scope locked with the product decision to ship email/password authentication only. Native Google sign-in was removed from the first-APK login screen, Google Calendar connect is visibly deferred instead of launching an incomplete native callback flow, and onboarding no longer enables Calendar by default. Hardware session-persistence verification remains pending; native OAuth is a later-release item.
- **2026-09-29 22:50** — Added a native AppState foreground session re-check so the app refreshes `/api/auth/get-session` after Android resume and can clear stale authenticated UI. Typecheck/tests remain green. No `adb` device or EAS CLI is available in this environment, so cookie persistence and cold-restart restoration remain hardware-gated and are not marked complete.
- **2026-09-29 23:05** — Stage 4 native-config pass found Expo/WebRTC public configuration still reported `android.permission.CAMERA` for this audio-only app. Added an Android blocked-permission rule and a static regression assertion. Native permission generation and all microphone/audio behavior remain device-build gates.
- **2026-09-29 23:20** — Added production voice-packet normalization in `src/services/voicePackets.ts`, wired the real `useVoiceBot` hook to it, and added direct production-parser coverage for transcripts, task updates, malformed payloads, metadata, and finality. The mobile suite now passes 87/87 assertions; full hook/UI and native audio behavior remain hardware/build gates.
- **2026-09-29 23:35** — Stage 5 configuration pass added `mobile/.env.example` with the approved public-only variable set and extended validation for optional LiveKit `wss://` URLs. A safe fixture configuration passed validation; the real build remains correctly blocked until the two production HTTPS origins are supplied. No EAS project or signing identity is available locally.
- **2026-09-29 23:50** — Completed the remaining repository-side release gates: `npx expo install --check`, public Expo config generation, `npm ci --dry-run --ignore-scripts`, and `git diff --check` all passed. Deployment URLs, EAS project identity, signing, and hardware remain external release gates.
- **2026-09-29 23:58** — Stage 4 scope decision recorded: APK v1 uses explicit manual interruption; natural barge-in/VAD is deferred. Added production component wiring checks for `VoiceAssistant` → `useVoiceBot`, native audio setup/teardown, microphone publication, and manual controls. Hardware behavior remains pending.
- **2026-09-30 13:05** — Expo preview build `e9e92091-803b-42c2-8a48-c65337994a9d` failed in Gradle `:app:mergeReleaseResources`: `mascot-1.png` and `mascot-2.png` were JPEG byte streams with `.png` names, so AAPT rejected them. Converted both assets to valid PNG files; mobile lint and 89 tests pass. A fresh EAS preview build is required before diagnosing runtime login behavior.
- **2026-09-30 13:25** — Expo preview variables were inspected and contain the deployed app/API origins plus the LiveKit URL. The mobile login failure was traced to Next.js `isSameOriginMutation`: native React Native requests do not supply a browser `Origin` header, so email sign-in/sign-up/sign-out and other mutations were rejected as cross-origin. Mobile mutations now send the deployed app origin explicitly; the fix is ready for the next branch commit, and preview build `8f138464-a65b-44b6-ba1b-541ca67da552` is queued from `/mobile` using the prior asset fix.
- **2026-09-30 13:40** — Preview build `8f138464-a65b-44b6-ba1b-541ca67da552` passed dependency installation but stopped at EAS configuration because `mobile/app.json` had no project linkage. Retrieved the existing Expo project ID `9b37b150-b5d3-46da-a098-4f065538e9ed` from the authenticated Expo project and added it with owner `metabox-ai-assistant`. The next build must use the latest commit containing both this linkage and the native-Origin login fix.
- **2026-09-30 14:07** — The next build `ece56292-baf5-4154-8f70-53d447db5ba0` reached EAS configuration but failed because the linked Expo project slug was `ai-voice-assistant-bot` while `app.json` still declared `vocalist-assistant-mobile`. Aligned the slug and pushed commit `10b527f`.
- **2026-09-30 14:10** — Confirmed the Expo Preview and Production environments contain the approved public values: app `https://ai-voice-bot-production-6573.up.railway.app`, API `https://voice-api-production-0c80.up.railway.app`, and LiveKit `wss://ai-voice-assistant-vu6rr406.livekit.cloud`. No secret is in these public variables.
- **2026-09-30 14:11** — Production Android internal build `2088a824-21f6-48b8-a742-77fdfba8360f` started from commit `10b527f` and passed configuration, Expo Doctor, prebuild, JavaScript bundling, and Gradle startup. It is still compiling; APK installation and hardware login/session restoration remain pending.
- **2026-09-30 14:30** — Expo build `2088a824-21f6-48b8-a742-77fdfba8360f` completed successfully as an Android APK (`com.vocalist.ai.mobile`, version `1.0.0 (1)`). Expo reports no build error and provides the internal-distribution install link. If TestApp.io reports a problem, first confirm it received this exact artifact/commit `10b527f`; installation and runtime authentication are separate device gates.
- **2026-09-30 14:45** — Device screenshot showed `CLEARTEXT communication to localhost not permitted`. Root cause: `mobile/src/services/api.ts` read `process.env[key]` dynamically; Expo only inlines explicit `process.env.EXPO_PUBLIC_*` references, so the release bundle used its localhost fallbacks despite the Expo variables being configured. Replaced the dynamic lookup with explicit public-variable references in commit `80e08e4`; lint and all 89 mobile tests pass. A new APK is required.
- **2026-09-30 14:52** — Corrected production APK build `98e3e973-9e0a-4874-9668-e267ddacbce8` was queued from commit `d2e2e41` with the explicit environment fix. It must replace the TestApp.io upload; do not reuse build `2088a824`.
- **2026-09-30 15:05** — Audited web/mobile assistant synchronization. Both clients use the authenticated `/api/assistant-config` source, but the mobile onboarding flow could republish a web profile while clearing notes, system prompt, business hours, FAQs, escalation rules, and capability flags. Onboarding now loads and preserves the complete existing company/assistant profile and only changes the fields edited in that flow. Lint and all 89 mobile tests pass; a new APK is required for this sync fix.
- **2026-09-30 15:08** — Synchronized APK build `e342e4ea-a2a9-4928-baeb-8e1f232bd51e` queued from commit `290a4d4` with both the localhost environment fix and profile-preservation fix. This is the artifact to install after it succeeds.
- **2026-10-01** — Verified the signed-in routing gate: it previously checked only `company_profile.company_name`, while the sign-in route separately repeated that incomplete check. Mobile now loads company profile, assistant configuration, and profile versions together; existing users with a published web assistant go directly to the dashboard, and only incomplete workspaces go to setup. Lint and all 89 mobile tests pass.
- **2026-10-01** — Latest APK build `d861e11d-247e-42b9-8fc4-b96badc8a646` queued from commit `abe6163`, including the setup-bypass gate. This is the build to install for the existing-account flow.
- **2026-10-01** — Inspected GitHub `develop`: merge commit `c749827` includes the updated mobile frontend design (`ab8753c`), keyboard-aware forms, new branding/assets, auth/layout updates, dashboard/settings refresh, and the tier 1–4 mobile test suite. Local mobile lint, 89 tests, Expo dependency check, public config generation, and diff check pass. Expo production Android build `e0750a3d-5e27-4756-a85a-a4c8d0cd9fda` is queued from `develop`/`c749827`.
- **2026-10-01** — Review found `develop` had regressed to a company-only onboarding gate (`hasConfiguredCompany`), so the assistant stage was not reliably recognized. Added an explicit read-only **Already configured on web? Skip setup** action, restored assistant/company/published-profile checks for automatic bypass, and changed sign-in routing to use the same gate. Skipping never saves or publishes a mobile profile; lint and all 89 tests pass. A new Expo build is required.

## Pre-APK production readiness

The repository now includes `mobile/eas.json` with development, preview, and
production APK profiles. Every EAS build runs `npm run check:public-env` before
installation. The check rejects missing origins, localhost/loopback hosts,
non-HTTPS release URLs, URL paths/query strings, and secret-looking
`EXPO_PUBLIC_*` variables.

Required public build variables (embedded in `mobile/eas.json` for Preview and Production):

- `EXPO_PUBLIC_APP_URL=https://ai-voice-assistants.vercel.app` — canonical HTTPS Next.js origin on Vercel.
- `EXPO_PUBLIC_BACKEND_URL=https://ai-assistant-backend-production-977c.up.railway.app` — public HTTPS Railway FastAPI origin.
- `EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT` — optional complete override; defaults to
  `${EXPO_PUBLIC_APP_URL}/api/livekit/token`.
- `EXPO_PUBLIC_LIVEKIT_URL=wss://ai-voice-assistant-vu6rr406.livekit.cloud` — LiveKit Cloud WebSocket URL.

The APK must never receive `BACKEND_URL` private hostnames,
`CREDENTIAL_BROKER_URL`, database/Neon URLs, LiveKit API credentials, Gemini
credentials, or `LIVEKIT_SESSION_CONTEXT_SECRET`. The LiveKit WebSocket URL is
returned by the authenticated token response; the legacy
`EXPO_PUBLIC_LIVEKIT_URL` fallback is retained only for compatibility.

### Building in EAS connected to GitHub:

When building through EAS Build connected to this GitHub repository:
1. **Base Directory**: In your Expo dashboard (`expo.dev`) under **Project > GitHub settings**, ensure the **Base directory** is set to `mobile`.
2. **Environment Variables**: Public variables are defined directly inside `mobile/eas.json` under `build.production.env`, `build.preview.env`, and `build.development.env`.
3. **Build Commands**:
   - For internal testing APK:
     ```bash
     npx eas build --platform android --profile production
     ```
   - For Google Play Store App Bundle (AAB):
     ```bash
     npx eas build --platform android --profile production-aab
     ```
   - For iOS build:
     ```bash
     npx eas build --platform ios --profile production
     ```

## Staged execution tracker

This is the execution order for taking the mobile app from the current code
state to a distributable APK. A phase is marked complete only after its exit
gate has evidence in this file. Do not start a later phase while a blocking
item in an earlier phase remains open.

### Stage 1 — Mobile application correctness

**Status: PARTIAL — implementation pass complete; runtime validation and UI-state work pending**

- [x] Fix email sign-in success navigation.
- [x] Protect tabs, setup, and live-call routes from unauthenticated deep links.
- [x] Replace the `/onboarding` navigation target with the existing `/setup` route.
- [x] Remove Apex/demo defaults and fabricated PBX/call/email fallback data.
- [x] Make save, publish, 3CX connect/disconnect, Google disconnect, and onboarding
  failures explicit; never report a remote action as successful when it failed.
- [x] Make the onboarding Save Draft control truthful when draft persistence is
  unavailable.
- [ ] Verify sign-in, sign-out, session refresh, and route protection on a
  development build.
- [ ] Add complete loading, retry, empty, and error states to the mobile screens.

**Exit gate:** a new user can sign in, complete setup, navigate every screen,
and receives truthful success/failure feedback with no demo data presented as
real data.

### Stage 2 — Trusted authentication and API routing

**Status: PARTIAL — proxy routing implemented; deployed-context verification pending**

- [x] Route all authenticated mobile operations through the Next.js proxy.
- [x] Restrict direct `EXPO_PUBLIC_BACKEND_URL` use to health/diagnostic checks.
- [x] Align task list, task status, and task cancellation paths with the
  frontend and FastAPI route contracts.
- [ ] Verify company, assistant, 3CX, calls, tasks, tools, and LiveKit requests
  all carry server-generated trusted session context.
- [x] Confirm no mobile code creates or accepts `X-Verified-Session-Context`.

**Exit gate:** authenticated API calls work through Next.js and FastAPI rejects
direct unsigned tenant requests.

### Stage 3 — Native OAuth and session persistence

**Status: PARTIAL — v1 scope locked to email/password; native Google OAuth deferred**

- [x] Product decision recorded: the first APK supports email/password sign-in
  and account creation only.
- [x] Remove the native Google sign-in action from the first-APK login screen.
- [x] Keep Google Calendar authorization visibly deferred in the mobile UI; do
  not launch a browser flow that cannot safely return a native session.
- [x] Re-check the authenticated server session when the native app returns to
  the foreground, covering process resume and server-side expiry.
- [ ] Verify email/password cookies persist across navigation and app restart on
  a physical Android device.
- [ ] Implement `vocalist-mobile://auth/callback`, browser-to-app session
  transfer, and callback state validation in the later Google OAuth phase.
- [ ] Verify Google Calendar connect, reconnect, disconnect, denial, and expired
  authorization states in that later phase.

**Exit gate for APK v1:** email/password sign-in and session restoration are
validated on hardware. Google sign-in and Calendar authorization are explicitly
out of scope and must not be presented as available.

### Stage 4 — Production-level mobile verification

**Status: PARTIAL — automated checks complete; production-hook/device checks pending**

- [x] TypeScript lint passes.
- [x] 89 automated assertions pass.
- [x] Expo SDK 57 dependency check passes.
- [x] Expo native configuration resolves LiveKit plugins and permissions.
- [x] Add direct tests for production LiveKit data-channel packet handling used
  by `useVoiceBot` (transcripts, task updates, malformed payloads).
- [x] Add production parser and component-wiring regression coverage around the
  real `useVoiceBot` hook and `VoiceAssistant` screen.
- [x] Decide v1 uses explicit manual interruption; natural mobile barge-in/VAD
  is deferred to a later release.
- [x] Block unexpected camera permission in the Android app configuration for
  this audio-only app; verify the generated manifest during the native build.
- [ ] Add physical-device tests for microphone, routing, reconnect, transcript,
  interruption, and teardown behavior.

**Exit gate:** production mobile code and native hardware behavior pass the
voice-session test protocol.

### Stage 5 — Deployment, URLs, and EAS release setup

**Status: PARTIAL — repository configuration complete; deployment identity pending**

- [x] Add `mobile/eas.json` with development, preview, and production APK
  profiles.
- [x] Add the public URL/secret validator and EAS pre-install hook.
- [x] Run Expo dependency, public-config, reproducible-install, and diff checks.
- [x] Document the release-only public environment contract in `mobile/.env.example`.
- [x] Validate optional `EXPO_PUBLIC_LIVEKIT_URL` as a credential-free `wss://`
  origin when supplied.
- [x] Supply and verify the real `EXPO_PUBLIC_APP_URL` in Expo Preview and Production.
- [x] Supply and verify the real `EXPO_PUBLIC_BACKEND_URL` in Expo Preview and Production.
- [x] Confirm the active LiveKit URL in Expo Preview and Production.
- [ ] Verify frontend, API, worker, broker, Neon, Google OAuth, and LiveKit
  deployment environments from one approved commit.
- [x] Link the Expo EAS project and add the owner/project ID.
- [ ] Confirm `com.vocalist.ai.mobile` as the permanent Android package ID.
- [ ] Configure Android signing and build-number policy.
- [ ] Install/authenticate EAS CLI or run the build through an authenticated
  EAS environment.

**Exit gate:** EAS can produce a signed development APK with confirmed HTTPS
origins and no secrets embedded in the public bundle.

### Stage 6 — Physical-device release and APK acceptance

**Status: BLOCKED — requires deployed services and Android hardware**

- [ ] Install the development APK on a real Android phone.
- [ ] Verify email/password sign-in, session restoration, and setup; Google
  integration is explicitly deferred for APK v1.
- [ ] Verify a complete LiveKit call with the registered `calendar-assistant`.
- [ ] Verify microphone permission, agent audio, mute, speaker/earpiece,
  Bluetooth/headset routing, reconnect, interruption, transcript, and teardown.
- [ ] Correlate one `session_id` across APK, Next.js, FastAPI, LiveKit, and
  worker logs.
- [ ] Build the signed production APK using the confirmed URL set.
- [ ] Record the EAS build ID, version, commit, test date, and embedded public
  origins in this document.

**Exit gate:** the signed APK completes an authenticated real voice call from
launch through teardown without demo fallbacks or unresolved errors.

### User inputs required before the blocked stages can proceed

- Confirmed public Next.js app URL.
- Confirmed public Railway FastAPI URL.
- Confirmed LiveKit Cloud WebSocket URL.
- Expo account/organization access for EAS (interactive login; do not share a
  password in chat).
- Google sign-in is deferred from the first APK; native OAuth remains a later
  release item.
- Android phone access for physical-device testing.
- Confirmation that `com.vocalist.ai.mobile` is the permanent package ID.

## Physical-device gate

LiveKit contains native modules and does not run in Expo Go. Before release:

1. Configure `EXPO_PUBLIC_APP_URL` to a URL reachable by the device and sign in on the mobile app.
2. Build a development client with `npx expo run:android` or `npx expo run:ios`.
3. Confirm microphone permission, room connection, agent audio, Bluetooth/headset/speaker routing, mute/unmute, interrupt, reconnect, transcript delivery, and hardware release after ending the call.
4. Correlate the mobile session ID with FastAPI, LiveKit, and worker logs. A successful build alone does not prove acoustic quality or end-to-end agent behavior.

## Progress log

- **2026-10-01 — Onboarding preservation fix shipped:** `develop` commit
  `79518d9` restores recognition of the completed Assist stage using the
  company profile, assistant configuration, and published/deployed status.
  Mobile onboarding now includes a read-only **Already configured on web? Skip
  setup** action. It only navigates to the dashboard; it does not save,
  publish, or overwrite the web configuration.
- **2026-10-01 — Expo build queued:** EAS production Android internal build
  `916bc564-37a5-4566-ac98-22ff4a7e3848` was queued from GitHub `develop` at
  commit `79518d9`, with base directory `/mobile` and the production
  environment. The APK is not yet verified until this build succeeds and is
  installed on a physical Android device.
