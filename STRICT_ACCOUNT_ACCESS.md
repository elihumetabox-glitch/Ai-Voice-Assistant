# Strict Account Access & Resource Boundary Policy

**Account Identities**: `anesu@intern-mail.metabox.technology`, `vayen@intern-mail.metabox.technology`  
**Target Project Endpoint**: `ep-shiny-snow-za0dicjh`  
**Region**: `eu-west-2` (AWS London)  
**Environment**: `development` / Production Stack  

---

## 1. Executive Summary & Policy Scope

This project configuration and resource policy strictly binds all database connections, authentication providers, backend deployments, WebRTC streaming services, and API integrations exclusively to the authorized accounts (**`anesu@intern-mail.metabox.technology`** and **`vayen@intern-mail.metabox.technology`**) and the target Neon project endpoint **`ep-shiny-snow-za0dicjh`**.

Any credentials, database endpoints, authentication endpoints, or services belonging to unauthorized external organizations or unrelated test projects are strictly prohibited from being mixed into this environment.

---

## 2. Infrastructure Resource Bindings

### A. Neon Serverless PostgreSQL Database
- **Project Endpoint ID**: `ep-shiny-snow-za0dicjh`
- **Region**: `eu-west-2` (AWS London)
- **Database Name**: `neondb`
- **Database Owner**: `neondb_owner`
- **Branch**: `br-flat-thunder-zabqhepy`
- **Pooled Connection String**:
  ```env
  DATABASE_URL="postgresql://neondb_owner:npg_wf48FprySqHD@ep-shiny-snow-za0dicjh-pooler.c-2.eu-west-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require"
  ```
- **Unpooled Connection String**:
  ```env
  DATABASE_URL_UNPOOLED="postgresql://neondb_owner:npg_wf48FprySqHD@ep-shiny-snow-za0dicjh.c-2.eu-west-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require"
  ```

### B. Neon Authentication & Local Access
- **Neon Auth Base URL**:
  ```env
  NEON_AUTH_BASE_URL=https://ep-shiny-snow-za0dicjh.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth
  ```
- **Authorized Accounts**: `anesu@intern-mail.metabox.technology`, `vayen@intern-mail.metabox.technology`
- **Trusted Origins / Redirect Whitelist**:
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
  - `http://localhost:8000`
  - `https://ai-voice-assistants.vercel.app`

### C. LiveKit WebRTC Real-Time Media Transport
- **LiveKit Cloud URL**: `wss://ai-voice-assistant-vu6rr406.livekit.cloud`
- **Agent Name**: `calendar-assistant`
- **Session Context**: Signed with internal dispatch secret tied to this tenant environment.

### D. Google Multimodal Live & OAuth Integration
- **Google Cloud Project**: `0944069925` / `921027457755`
- **OAuth Client ID**: `921027457755-kf4epo0unnhnhno0ug71jepv5bo52um0.apps.googleusercontent.com`
- **Authorized JavaScript Origins**:
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
  - `https://ai-voice-assistants.vercel.app`
- **Authorized Redirect URIs / Callback Endpoints**:
  - `http://localhost:8000/auth/google/callback`
  - `https://ai-voice-assistants.vercel.app/auth/google/callback`
- **Google OAuth Test Users**: `anesu@intern-mail.metabox.technology`, `vayen@intern-mail.metabox.technology`

### E. Railway & Backend Deployment Environment
- **Backend Host**: `127.0.0.1:8000` (Local) / Dedicated Railway instance
- **CORS Allowed Origins**: `http://localhost:3000`, `http://127.0.0.1:3000`, `https://ai-voice-assistants.vercel.app`
- **Strict Tenant Enforcement**: All requests require signed session context matching authorized accounts.

---

## 3. Strict Security & Access Controls

1. **Database Isolation**:
   - All connection pools MUST target `ep-shiny-snow-za0dicjh-pooler.c-2.eu-west-2.aws.neon.tech`.
   - No queries, migrations, or data writes are permitted outside this project endpoint.

2. **Authentication Isolation**:
   - Only authenticated sessions originating from `anesu@intern-mail.metabox.technology` or `vayen@intern-mail.metabox.technology` and validated against Neon Auth and Google OAuth are granted API token minting privileges.

3. **No Unrelated Code or Credentials**:
   - Third-party or temporary test credentials from outside this tenant must be removed immediately upon discovery.
