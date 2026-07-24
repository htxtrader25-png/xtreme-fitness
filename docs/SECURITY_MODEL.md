# Harbormaster — Security Model

**Platform:** Harbormaster — Houston Harbor Bunker Fleet, Inventory & Commercial Operations Platform
**Operator tenant:** Fortune 100 energy major (reference tenant)
**Nomination counterparty:** Buffalo Marine · **Terminal:** HOFTI (Houston Oil Field Terminal Inc.)
**Ops tempo:** 24/7/365, Houston Ship Channel
**Document owner:** Principal Security & Platform Architect
**Classification:** Internal — Confidential
**Version:** 1.0 · **Last reviewed:** 2026-07-24

This document is the authoritative security specification for Harbormaster. It is consistent with the canonical `_DOMAIN_MODEL.md` (roles, modules, fleet, product/barge references) and is a companion to `ARCHITECTURE.md` and `POWERBI_REPORTING.md`.

---

## 1. Security Principles

1. **Zero standing privilege** — no human or workload holds long-lived credentials; access is brokered by Entra ID tokens and Azure Managed Identities with short lifetimes.
2. **Least privilege by role** — the eight business roles map to app roles; each app role receives only the capabilities its workspace requires (Section 4).
3. **Defense in depth** — network perimeter (Front Door/WAF), identity (Entra Conditional Access), application (RBAC + RLS/FLS), data (TDE + column encryption), and monitoring (SIEM) are independent layers.
4. **Assume breach** — every request is authenticated and authorized at the API boundary; there is no implicit trust between tiers.
5. **Immutable, complete audit** — every state-changing action on the schedule, inventory ledger, and nominations is recorded who/what/when/before-after and is tamper-evident.
6. **Segregation of duties (SoD)** — the person who drafts and sends a nomination cannot be the person who approves the commercial commitment behind it.

---

## 2. Identity — Microsoft Entra ID

### 2.1 Tenancy & topology
- Single-tenant application registration in the operator's Entra ID tenant. External counterparty users (e.g., Buffalo Marine) are **not** provisioned as interactive users — nomination delivery is machine-to-machine via Graph/Power Automate (Section 2.7), never a shared login.
- Two app registrations:
  - **`harbormaster-spa`** — public client (SPA), no client secret, PKCE enforced.
  - **`harbormaster-api`** — confidential resource server exposing scoped APIs; also the identity used for On-Behalf-Of (OBO) exchange to Microsoft Graph.

### 2.2 SPA sign-in — Authorization Code + PKCE
The React/TypeScript SPA uses OAuth2 **Authorization Code flow with PKCE** (MSAL.js / `@azure/msal-browser`). No implicit flow, no tokens in URL fragments beyond the auth code, no client secret in the browser.

```
Browser SPA ──(1) /authorize?code_challenge=S256──▶ Entra ID
Entra ID   ──(2) redirect ?code=…──────────────────▶ Browser SPA
Browser SPA──(3) /token  code + code_verifier──────▶ Entra ID
Entra ID   ──(4) access_token(aud=api://harbormaster-api)+id_token+refresh_token──▶ SPA
SPA        ──(5) Authorization: Bearer <access_token>──▶ FastAPI (harbormaster-api)
```

Token handling rules:
- Access tokens are short-lived (default 60–75 min, Entra-managed). Refresh tokens are rotating, single-use, bound to the SPA origin.
- Tokens are held in memory / session storage isolated per tab; **never** in `localStorage` for the API access token. Silent renew via hidden iframe / `acquireTokenSilent`.
- `aud` must equal `api://harbormaster-api`; the API rejects any token minted for another audience.
- Scopes: `access_as_user` (delegated). App roles carry authorization (Section 3).

### 2.3 API resource server validation
FastAPI validates every bearer token before any handler executes:
- Signature verified against Entra ID JWKS (`https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys`), cached with rotation.
- Validate `iss`, `aud`, `exp`, `nbf`, `tid` (must equal operator tenant), and `azp`/`appid` (must be the SPA or an approved workload).
- Extract `roles` (app role) and `oid`/`preferred_username` for RBAC and audit stamping.
- Reject tokens with no `roles` claim (fail closed).

### 2.4 On-Behalf-Of (OBO) for downstream Graph
When a handler must call Microsoft Graph as the signed-in user (draft an Outlook message, post a Teams notification, resolve a manager for SoD), the API performs the **OBO flow**:

```
SPA token (aud=harbormaster-api) ──▶ /token grant_type=jwt-bearer
   client_id=harbormaster-api + client_assertion(managed identity)
   requested_scope = https://graph.microsoft.com/Mail.Send Chat.Create …
◀── Graph access token bound to the original user
```

- The API authenticates to Entra during OBO using a **federated managed-identity credential**, not a stored client secret.
- Graph delegated scopes are minimized: `Mail.Send`, `Mail.ReadWrite` (draft only), `ChatMessage.Send`, `User.Read.All` (manager lookup for SoD), `OnlineMeetings.ReadWrite` where needed.
- OBO tokens are never cached beyond their lifetime and never logged.

### 2.5 App roles
Eight app roles are declared in the `harbormaster-api` manifest, one per business workspace in `_DOMAIN_MODEL.md`. They are assigned to Entra ID **security groups**, not directly to users, so joiner/mover/leaver is governed by group membership and access reviews.

| App role value | Business role | Entra group |
|---|---|---|
| `CommercialOperator` | Commercial Operator | `sg-hm-commercial-operator` |
| `Dispatcher` | Dispatcher | `sg-hm-dispatcher` |
| `MarineScheduler` | Marine Scheduler | `sg-hm-marine-scheduler` |
| `Blender` | Blender | `sg-hm-blender` |
| `Trader` | Trader | `sg-hm-trader` |
| `CommercialManager` | Commercial Manager | `sg-hm-commercial-manager` |
| `OperationsManager` | Operations Manager | `sg-hm-operations-manager` |
| `Executive` | Executive Leadership | `sg-hm-executive` |
| `PlatformAdmin` | (privileged, non-business) | `sg-hm-platform-admin` (PIM-eligible) |

`PlatformAdmin` is not a business workspace; it is an operational/audit role granted **eligible** (not active) through Entra Privileged Identity Management (PIM) and requires activation with justification + approval (Section 9.3).

### 2.6 Conditional Access & MFA
Conditional Access (CA) policies applied to the Harbormaster enterprise app:
- **CA-1 Require MFA** — all users, all sessions. Phishing-resistant MFA (FIDO2 / Windows Hello / Authenticator number-match) required; SMS/voice disallowed.
- **CA-2 Require compliant or hybrid-joined device** — for any role that can mutate the schedule, ledger, or nominations (all roles except pure `Executive` read may sign in from managed mobile).
- **CA-3 Trusted network / risk** — sign-ins from outside named Houston operations locations or from Entra ID Protection **high sign-in risk** are blocked or step-up challenged.
- **CA-4 Session controls** — sign-in frequency 8h for standard roles, 1h re-auth for `PlatformAdmin`; persistent browser session disabled for privileged roles.
- **CA-5 Block legacy auth** — legacy/basic auth protocols blocked tenant-wide.
- **CA-6 Privileged activation** — `PlatformAdmin` and any nomination-approval elevation require MFA at activation and an approved PIM request.

### 2.7 Machine-to-machine & counterparty delivery
- **Buffalo Marine nomination delivery** is executed by a Power Automate flow / Graph mail-send using a **managed identity + application permission** (`Mail.Send` app scope on a dedicated `nominations@` shared mailbox), not a user's mailbox. Delivery is triggered only after the SoD-gated approval (Section 9.2).
- No counterparty ever receives an interactive account in the operator tenant.

### 2.8 Managed identities for service-to-service
Every workload authenticates with an Azure **user-assigned managed identity** (UAMI); there are no connection-string passwords in app settings.

| Workload | Identity | Grants |
|---|---|---|
| FastAPI pods (AKS) | `id-hm-api` (workload identity federation) | Key Vault secrets get, PostgreSQL AAD auth, Service Bus send/receive, OpenAI, Document Intelligence, Storage |
| Power Automate connector | `id-hm-automation` | Graph `Mail.Send` (app), Teams post |
| Ingestion worker (AIS/NOAA) | `id-hm-ingest` | Key Vault (API keys), Service Bus, Storage, PostgreSQL |
| Power BI gateway/data source | `id-hm-analytics` | PostgreSQL read-replica AAD login (RLS-scoped service principal) |
| CI/CD deploy | `id-hm-deploy` (OIDC federated to GitHub Actions) | ACR push, AKS deploy, Bicep what-if — no stored cloud credential |

PostgreSQL uses **Entra ID authentication** (AAD tokens) rather than passwords wherever the driver supports it; the managed identity is granted a database role scoped to the schemas it needs.

---

## 3. Authorization Model (RBAC)

Authorization is enforced **server-side at the API** on every request. The SPA hides controls the user cannot use, but the API is the trust boundary — a hidden button is a UX affordance, never a control.

Enforcement layers:
1. **App role gate** — the `roles` claim must contain a role permitted for the route (declarative dependency in FastAPI, e.g., `require_roles("MarineScheduler","OperationsManager")`).
2. **Capability check** — fine-grained capability (e.g., `schedule:publish`) resolved from role→capability map, evaluated per action.
3. **Row-level scope** — the data the caller may see/modify is filtered by RLS predicates (Section 5).
4. **Field-level scope** — sensitive columns (commercial pricing, margin) are projected out for roles without the `pricing:read` capability (Section 5).

### 3.1 Capability catalog (per module)
- **Fleet Scheduler:** `schedule:read`, `schedule:edit`, `schedule:publish`, `schedule:lock`
- **HOFTI Terminal Ops:** `hofti:read`, `hofti:edit` (tank allocations, loading queue, berth assignment)
- **Floating Inventory (on-barge):** `floating:read`, `floating:adjust`
- **Enterprise Inventory (ledger engine):** `enterprise_inv:read`, `enterprise_inv:reconcile`
- **Blender Center:** `blend:read`, `blend:execute` (create/commit blend recipes & post ledger movements)
- **Nominations (Buffalo Marine):** `nom:draft`, `nom:send`, `nom:approve`, `nom:revise`
- **AI Dispatch:** `dispatch:view`, `dispatch:accept` (accept/override optimizer recommendations)
- **Executive KPIs:** `kpi:read`
- **Commercial / Pricing (field-level):** `pricing:read`, `margin:read`
- **Admin / Audit:** `audit:read`, `admin:manage`

---

## 4. RBAC Permission Matrix

Legend: **✓** = full (create/edit/act) · **RO** = read-only · **✗** = no access
SoD guarantee: no single role holds both `nom:send` and `nom:approve` (see Section 9.2).

| Capability / Module | Commercial Operator | Dispatcher | Marine Scheduler | Blender | Trader | Commercial Manager | Operations Manager | Executive |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Fleet Scheduler — edit** | ✗ | RO | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **Fleet Scheduler — publish** | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **Fleet Scheduler — lock** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **HOFTI Terminal Ops** | RO | ✓ | ✓ | RO | ✗ | RO | ✓ | RO |
| **Floating Inventory (on-barge)** | ✓ | ✓ | RO | RO | RO | RO | ✓ | RO |
| **Enterprise Inventory — read** | RO | RO | RO | RO | RO | RO | RO | RO |
| **Enterprise Inventory — reconcile** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **Blender Center** | RO | ✗ | RO | ✓ | RO | RO | ✓ | ✗ |
| **Nominations — draft** | ✓ | ✗ | RO | ✗ | RO | ✓ | RO | ✗ |
| **Nominations — send** | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | RO | ✗ |
| **Nominations — approve** | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |
| **Nominations — revise** | ✓ | ✗ | ✗ | ✗ | RO | ✓ | RO | ✗ |
| **AI Dispatch — view** | RO | ✓ | ✓ | ✗ | RO | RO | ✓ | RO |
| **AI Dispatch — accept** | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **Executive KPIs** | RO | RO | RO | RO | RO | ✓ | ✓ | ✓ |
| **Commercial pricing (field-level)** | RO | ✗ | ✗ | ✗ | ✓ | ✓ | RO | RO |
| **Margin / P&L (field-level)** | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | RO | RO |
| **Admin / user management** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Audit log — read** | ✗ | ✗ | ✗ | ✗ | ✗ | RO | ✓ | RO |

> **Admin / user management** and full audit administration are held **only** by the out-of-band `PlatformAdmin` PIM role — deliberately absent from all eight business roles to preserve SoD. Operations Manager gets **read** audit access for operational oversight; Commercial Manager and Executive get scoped read for governance.

Notes on the matrix:
- **Marine Scheduler** owns the schedule (edit/publish) but cannot **lock** it — locking a published window (freezing it against further edits ahead of execution) is an Operations Manager control.
- **Dispatcher** executes terminal and floating-inventory operations and accepts AI dispatch recommendations, but has **no** commercial pricing visibility (Section 5).
- **Trader** and **Commercial Manager** are the only roles with margin/P&L; Trader cannot touch operations (schedule/HOFTI edit) — a commercial/operational separation.
- **Commercial Operator** drafts and **sends** nominations but **cannot approve** them; **Commercial Manager** approves but does not send — the core SoD split.

---

## 5. Row-Level & Field-Level Security

### 5.1 Field-level security (FLS)
Sensitive columns are gated by capability and enforced both in the API projection layer and in the database view layer (belt and suspenders):

| Field group | Example columns | Visible to |
|---|---|---|
| Commercial pricing | `deal_price_usd_mt`, `index_diff`, `platts_ref`, `formula` | `pricing:read` → Trader, Commercial Manager, Commercial Operator (own deals), Operations Manager (RO), Executive (RO) |
| Margin / P&L | `gross_margin_usd`, `net_margin_usd_mt`, `charter_cost_alloc` | `margin:read` → Trader, Commercial Manager, Operations Manager (RO), Executive (RO) |
| Operational (always) | qty MT, product, barge, window, status | all authenticated roles |

- **Dispatcher example:** a dispatcher opening a delivery sees vessel, product, nominated MT, window, berth, and barge assignment, but the `deal_price_usd_mt` / margin columns are **absent from the response body**, not merely hidden in the UI. The API strips them based on the token's capabilities before serialization.
- **Trader example:** a trader sees the full commercial picture (price, formula, margin) but does **not** see the `schedule:edit`/`hofti:edit` mutation endpoints at all.

Implementation: FastAPI response models are role-parameterized (Pydantic `model_dump` with a field allow-list resolved from capabilities). PostgreSQL exposes `v_delivery_commercial` (with pricing) and `v_delivery_operational` (without) as separate secured views; the analytics/reporting path only ever touches the appropriate view.

### 5.2 Row-level security (RLS)
Row visibility is constrained by data ownership and scope. Enforced with PostgreSQL **Row Level Security policies** keyed on the authenticated principal (set per request via `SET LOCAL app.current_role`, `app.current_user_oid`, `app.book`):

| Dimension | Rule |
|---|---|
| Commercial book | Traders/Commercial Operators see rows for the **book(s)** they are assigned; a trader on the residuals book does not see distillates book deals. |
| Customer confidentiality | Deals flagged `restricted_customer` are visible only to the assigned owner + Commercial Manager. |
| Barge / terminal ops | Dispatchers and Schedulers see all fleet/terminal rows (operations are shared), but ledger **commercial** slices are pricing-gated per FLS. |
| Draft nominations | A draft nomination is visible to its author, the Commercial Operator team, and approvers; it is invisible to unrelated books until approved & sent. |
| Executive | Executives see **aggregated** rows across all books but not row-level draft/working commercial detail (KPIs, not deal blotter). |

RLS is applied identically in the API (query predicates) and in Power BI (RLS roles mirroring app roles — see `POWERBI_REPORTING.md` §RLS).

---

## 6. Data Protection

### 6.1 Encryption at rest
- **PostgreSQL Flexible Server:** Transparent Data Encryption (TDE) with **customer-managed keys (CMK)** in Azure Key Vault (`kv-hm-data`), AES-256. Key rotation every 12 months (auto) and on-demand on personnel change.
- **Redis, Service Bus, Storage, ACR:** encryption at rest with Microsoft-managed or CMK where CMK is supported; blobs (inspection PDFs, backups) use CMK.
- **Column-level encryption:** the most sensitive commercial fields (deal formulas, counterparty pricing) can be additionally protected with application-layer envelope encryption using a Key Vault key, so even a DBA with TDE cannot read plaintext without the app key.

### 6.2 Encryption in transit
- **TLS 1.2 minimum, TLS 1.3 preferred**, everywhere: browser→Front Door, Front Door→App Gateway→AKS ingress, and all east-west pod-to-pod (mTLS via service mesh / cluster network policy).
- HSTS enforced (`max-age` ≥ 1 year, `includeSubDomains`, `preload`). Weak ciphers and TLS 1.0/1.1 disabled at Front Door and App Gateway. Certificates managed by Key Vault + Front Door managed certs; internal mTLS via mesh CA.
- Database connections require SSL (`sslmode=verify-full`), Redis requires TLS, Service Bus AMQP over TLS.

### 6.3 Secrets management
- **All** secrets, connection strings, API keys (AIS, NOAA, OpenAI, Document Intelligence), and certificates live in **Azure Key Vault** (`kv-hm-app`, `kv-hm-data`), with soft-delete + purge protection enabled.
- Workloads fetch secrets at runtime via managed identity; no secret is ever in a container image, environment variable baked at build, or source control.
- Key Vault access is RBAC (not access policies), logged to Log Analytics, and alerts fire on any secret read by an unexpected identity.
- Secret rotation: automated where the provider supports it; manual keys rotated ≤ 90 days.

### 6.4 PII & sensitive data handling
- PII footprint is **small by design**: operator staff identities (name, UPN, `oid`) sourced from Entra; counterparty contacts (Buffalo Marine dispatch email); vessel master/agent contacts.
- PII is classified and tagged (Microsoft Purview) so it is excluded from analytics extracts, redacted in logs, and covered by DSR (data subject request) tooling.
- Logs and telemetry are scrubbed of PII and secrets before shipping to App Insights/SIEM; tokens are never logged (Section 8).
- Data minimization: the platform stores operational/commercial marine data, not payment card or health data (no PCI/HIPAA scope).

### 6.5 Tenant & environment isolation
- Single operator tenant; the platform is **not** multi-tenant, but is logically partitioned by commercial book and hard-partitioned by environment (dev/test/staging/prod are separate subscriptions/resource groups, separate Key Vaults, separate databases — see `ARCHITECTURE.md`).
- Network isolation: private endpoints for PostgreSQL, Key Vault, Storage, Service Bus; no public database exposure. AKS egress via controlled NAT/firewall.
- No prod data in lower environments; test data is synthetic or irreversibly masked.

---

## 7. Audit Logging

### 7.1 What is logged
Every **state-changing** action and every **sensitive read** produces an immutable audit event with:
- **Who** — `user_oid`, `preferred_username`, app role, `azp` (originating client), source IP, device/session id.
- **What** — action verb + resource (`schedule.publish`, `ledger.adjust`, `nomination.send`, `dispatch.accept`, `pricing.read`).
- **When** — UTC timestamp (server clock, NTP-synced) + monotonic sequence.
- **Where/context** — correlation id (trace id), request id, environment.
- **Before → after** — for mutations, the prior and new values of changed fields (JSON diff), e.g., a schedule slot moved barge HH-205 "Texas City" from Berth A 0600 to Berth B 0900, or a ledger movement crediting/debiting a HOFTI tank.
- **Decision** — allow/deny, and the policy/capability that governed it (denied attempts are logged too).

Specifically instrumented high-value flows: **Fleet Scheduler edit/publish/lock**, **inventory ledger movements & reconciliations** (enterprise engine), **blend executions**, **nomination draft→send→approve→revise**, **AI dispatch accept/override**, **pricing/margin field reads**, and all **admin/PIM activations**.

### 7.2 Immutability & integrity
- Audit events are **append-only**. They are written to a dedicated `audit` schema with `INSERT`-only grants (no `UPDATE`/`DELETE` for any application role, including `PlatformAdmin`).
- Tamper-evidence: each event carries a hash chained to the prior event's hash (`prev_hash`), forming a per-partition hash chain; a nightly job verifies chain integrity and signs a daily digest into WORM storage.
- A parallel stream is exported (append-only) to an immutable, legal-hold **WORM blob** container and to the SIEM, so the source-of-truth exists in ≥ 2 independent stores.

### 7.3 Retention
- Operational audit: **online 13 months**, archived (WORM) **7 years** to satisfy commercial recordkeeping and SOC2/ISO evidence.
- Nomination & commercial commitment audit: **7 years** (contractual/regulatory).
- Sign-in & Entra audit logs: retained in Log Analytics + exported per corporate policy.

### 7.4 SIEM export
- Audit events, Entra sign-in/audit logs, Key Vault access, Front Door/WAF logs, and AKS/App Insights security signals are exported to **Microsoft Sentinel** (or corporate SIEM) via Log Analytics + Event Hub.
- Analytics rules: impossible-travel, privileged activation without approval, ledger adjustment outside business rules, nomination sent without a matching approval event (SoD violation detector), bulk pricing reads, WAF anomaly spikes.
- Alerts route to the SOC and on-call; SoD-violation and audit-chain-break alerts are P1.

---

## 8. Application Security

### 8.1 OWASP Top 10 coverage
| Risk | Control |
|---|---|
| A01 Broken Access Control | Server-side RBAC + RLS/FLS on every route (Sections 3–5); deny-by-default; object-level checks (IDOR-safe: every resource fetch re-validates ownership/scope). |
| A02 Cryptographic Failures | TLS 1.2+/1.3, TDE+CMK, column encryption, Key Vault (Section 6). |
| A03 Injection | Parameterized queries / ORM (SQLAlchemy), no string-built SQL; strict input validation (Pydantic); output encoding; LLM prompt-injection guardrails on Azure OpenAI calls (see 8.6). |
| A04 Insecure Design | Threat model (Section 8.7), SoD, least privilege designed in. |
| A05 Security Misconfiguration | IaC-defined config (Bicep/Terraform), CIS-benchmarked AKS, no default creds, security headers, disabled debug in prod. |
| A06 Vulnerable Components | Dependency & container scanning in CI (Section 8.5). |
| A07 Auth Failures | Entra ID, phishing-resistant MFA, PKCE, no local passwords, short tokens, Conditional Access (Section 2). |
| A08 Data/Software Integrity | Signed images, provenance/SBOM, protected branches, IaC review, chained audit. |
| A09 Logging/Monitoring Failures | Comprehensive audit + SIEM (Section 7). |
| A10 SSRF | Egress allow-list; ingestion workers may reach only pinned AIS/NOAA hosts; no user-supplied URLs are fetched server-side; metadata endpoint blocked (Section 8.4). |

### 8.2 Input validation
- All request bodies/query/path params validated by **Pydantic** models with explicit types, ranges, and enums (product ∈ {VLSFO,HSFO,ULSFO,LSMGO,MGO}; quantities ≥ 0 MT with sane caps; barge ∈ known fleet; status ∈ defined lifecycle from `_DOMAIN_MODEL.md`).
- Reject-unknown-fields (`extra="forbid"`) to prevent mass-assignment.
- Uploaded inspection PDFs (for Document Intelligence OCR) are content-type + magic-byte validated, size-capped, scanned, and processed out-of-band in a sandboxed worker; never trusted as executable.

### 8.3 CSRF / XSS
- **XSS:** React auto-escapes; `dangerouslySetInnerHTML` is banned by lint rule; a strict **Content-Security-Policy** (`default-src 'self'`, no inline scripts, nonce-based where needed), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` / `frame-ancestors 'none'`.
- **CSRF:** the API is a **bearer-token** API (no ambient cookie auth), so classic CSRF does not apply; tokens are sent in the `Authorization` header explicitly by the SPA. CORS is locked to the SPA origin(s) only, credentials mode off for cross-origin.

### 8.4 SSRF & egress control
- Server-side outbound calls go only to a pinned allow-list (Graph, OpenAI, Document Intelligence, AIS provider host, NOAA host) via a controlled egress firewall.
- The Azure Instance Metadata Service (169.254.169.254) is blocked at the pod network policy; workload identity federation removes the need to reach it for creds.
- No endpoint accepts a URL to fetch on the server's behalf.

### 8.5 Rate limiting, dependency & supply-chain scanning
- **Rate limiting / throttling** at Front Door (WAF rate rules), API Gateway, and per-principal token-bucket in FastAPI (e.g., pricing reads and AI dispatch calls throttled; auth endpoints have aggressive limits + lockout via Entra smart lockout).
- **WAF:** Azure Front Door WAF with OWASP managed ruleset + custom rules (block SQLi/XSS signatures, geo-fence, bot protection).
- **Dependency scanning:** GitHub Dependabot + `pip-audit`/`npm audit` gates in CI; build fails on high/critical CVEs.
- **Container scanning:** images scanned in ACR (Microsoft Defender for Containers / Trivy) at push and continuously; base images pinned & minimal (distroless where possible).
- **SBOM & signing:** SBOM generated per build; images signed (cosign), verified at admission by AKS policy (Gatekeeper/Kyverno). Secret scanning (gitleaks) blocks committed secrets.
- **IaC scanning:** Bicep/Terraform scanned (checkov/tfsec) before deploy.

### 8.6 AI/LLM-specific controls
- Azure OpenAI calls run under managed identity in the operator tenant; prompts/completions are **not** used for model training and stay in-region.
- Prompt-injection defense: user/free-text and OCR'd document content are treated as untrusted; tool/action calls proposed by the copilot (e.g., accept a dispatch, draft a nomination) are **advisory** and always pass back through the same RBAC/SoD checks — the AI can never bypass authorization.
- Output handling: model output rendered as data, never executed; no server-side eval.

### 8.7 Threat Model — STRIDE (top assets)
Top three assets: **the Schedule** (fleet plan), **the Inventory Ledger** (enterprise engine, source of truth for physical/floating/commercial inventory), and **Nominations** (Buffalo Marine commercial commitments).

| Asset | Threat (STRIDE) | Vector | Mitigation |
|---|---|---|---|
| **Schedule** | **S**poofing | Forged user acting as Marine Scheduler | Entra auth + role gate on `schedule:*`; MFA; token audience/tenant checks |
| Schedule | **T**ampering | Unauthorized edit/publish of a locked window | `schedule:lock` (Ops Manager) freezes edits; append-only audit with before/after; optimistic concurrency/version stamps |
| Schedule | **R**epudiation | "I didn't publish that plan" | Immutable chained audit of publish with user/oid + diff |
| Schedule | **I**nfo disclosure | Competitor learns fleet movements | RLS, least-privilege reads, TLS, no public endpoints |
| Schedule | **D**oS | Flood of edit/publish calls | Rate limiting, WAF, autoscale, per-principal quotas |
| Schedule | **E**oP | Dispatcher self-grants publish | Server-side capability check; roles from token only; no client-trusted role |
| **Inventory Ledger** | **S** | Rogue workload posts movements | Managed identity + workload identity; only `enterprise_inv`/`blend`/`floating` capabilities can post; signed images |
| Ledger | **T** | Silent balance manipulation / off-book adjustment | Append-only double-entry movements, `reconcile` gated to Ops Manager, hash-chained audit, SIEM rule on out-of-policy adjustment |
| Ledger | **R** | Deny making an adjustment | Before/after audit with user identity; daily signed digest |
| Ledger | **I** | Commercial-available/pricing leakage to dispatcher | FLS strips pricing/margin; separate secured views; RLS by book |
| Ledger | **D** | Reconciliation job starvation | Queue isolation (Service Bus), backpressure, HA |
| Ledger | **E** | Blender escalates to reconcile | `blend:execute` ≠ `enterprise_inv:reconcile`; distinct capabilities |
| **Nominations** | **S** | Impersonated send to Buffalo Marine | Send via dedicated `nominations@` managed identity + app scope; counterparty verifies sender; no shared login |
| Nominations | **T** | Altered qty/price after approval | Approve is on an immutable snapshot; any post-approval change forces re-approval (revise loop) with new audit entry |
| Nominations | **R** | Dispute over what was sent/approved | Full draft→approve→send chain retained 7 yrs, WORM; message copy stored |
| Nominations | **I** | Nomination detail leaks cross-book | RLS on drafts; restricted-customer flag |
| Nominations | **D** | Delivery flow flooded | Idempotent send, dedup keys, rate limits |
| Nominations | **E** (SoD) | One person drafts, approves **and** sends | Enforced SoD: `nom:send` and `nom:approve` never co-held (Section 9.2); SIEM detects send-without-approval |

---

## 9. Compliance, Segregation of Duties & Operational Security

### 9.1 Compliance alignment
- **SOC 2 Type II** (Security, Availability, Confidentiality, Processing Integrity) — this document + CI/CD, monitoring, and change-management evidence map to CC-series controls. Audit logging (Section 7) provides processing-integrity and monitoring evidence.
- **ISO/IEC 27001:2022** — Annex A control mapping: A.5 (policies), A.8 (asset/data), A.5.15–18 (access control, this doc's Sections 3–5), A.8.24 (cryptography, Section 6), A.8.15–16 (logging/monitoring, Section 7), A.8.25–28 (secure development, Section 8).
- Change management: all prod changes via reviewed PR + IaC + approvals (see `ARCHITECTURE.md` CI/CD); no manual prod mutation.
- Access reviews: quarterly Entra access reviews on all `sg-hm-*` groups and PIM-eligible roles; joiner/mover/leaver via group lifecycle.

### 9.2 Segregation of Duties — nomination control
The nomination lifecycle (`Draft Ready → Sent → Acknowledged → Revision Required → Revised`) enforces SoD:

- **Draft** (`nom:draft`) — Commercial Operator / Commercial Manager / Trader (draft).
- **Approve** (`nom:approve`) — **Commercial Manager or Operations Manager** — approves the commercial commitment; must be a **different principal** than the drafter for value above a threshold.
- **Send** (`nom:send`) — Commercial Operator — transmits to Buffalo Marine, but only after an approval event exists.

Hard rules enforced in the API and monitored in SIEM:
1. No role holds **both** `nom:send` and `nom:approve` (verified in the matrix — Commercial Operator sends but cannot approve; Commercial Manager approves but cannot send).
2. `nomination.send` is rejected unless a valid, matching `nomination.approve` event exists for the current immutable snapshot.
3. Any post-approval change (`nom:revise`) invalidates the prior approval and requires re-approval before it can be sent again.
4. The approver may not be the drafter (four-eyes) above the configured value threshold.

### 9.3 Break-glass access
- Two **break-glass** accounts exist for catastrophic Entra/IdP outage: cloud-only, excluded from CA MFA-dependency loops but protected by FIDO2 hardware keys held in split custody (two custodians), long complex passphrase, and **no** standing app roles.
- Break-glass use is: (a) alarmed — any sign-in fires a P1 SOC alert immediately; (b) time-boxed — access is activated for a fixed window; (c) fully audited and reviewed post-incident within 24h; (d) credentials rotated after every use.
- For **application** privileged operations, `PlatformAdmin` is PIM-eligible only: activation requires justification + approver, is limited to a short window, MFA at activation, and is fully logged. There is no permanently active admin.

### 9.4 Incident response hooks
- Detections (Section 7.4) route to the SOC with runbooks for: SoD violation, audit-chain break, privileged activation anomaly, ledger out-of-policy adjustment, mass pricing read, and counterparty delivery failure.
- RTO/RPO and failover for availability incidents are defined in `ARCHITECTURE.md` (HA/DR).

---

## 10. Summary of Guarantees

- Every request is authenticated by Entra ID (PKCE for the SPA) and authorized **server-side** by app role + capability + RLS + FLS.
- Dispatchers never see commercial pricing; traders never edit operations; no one person can draft, approve, **and** send a Buffalo Marine nomination.
- All data is encrypted in transit (TLS 1.2+) and at rest (TDE/CMK), secrets live only in Key Vault, and workloads use managed identities — no standing secrets.
- Every change to the schedule, inventory ledger, and nominations is captured who/what/when/before-after in an immutable, hash-chained, SIEM-exported audit trail retained up to 7 years.
- The design aligns to SOC 2 and ISO 27001, enforces segregation of duties, and provides alarmed, time-boxed break-glass access.
