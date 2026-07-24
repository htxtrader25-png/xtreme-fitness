# ⚓ Harbormaster — Houston Harbor Bunker Fleet, Inventory & Commercial Operations Platform

> A mission-critical operational command center for Houston Harbor bunker operations — the single
> operational surface for **dispatchers, commercial operators, traders, blenders, marine schedulers,
> charter coordinators, and executive leadership**. Built to replace spreadsheets, whiteboards,
> Outlook threads, phone calls, manual scheduling, and fragmented reporting.
>
> Designed to operate like **Bloomberg Terminal × Palantir Foundry × an Airline Operations Control Center**.

The company operates multiple **time-chartered bunker barges** serving customer vessels throughout
Houston Harbor. Barges load marine fuel from the **HOFTI** storage terminal and deliver to customer
vessels. Every barge is simultaneously **transportation capacity** *and* **floating inventory**;
HOFTI is the fleet reload point. Harbormaster optimizes the full operational cycle — 24/7/365 — while
maintaining complete visibility of inventory, scheduling, commercial commitments, and charter utilization.

---

## ▶ Run the prototype

The clickable prototype is a single self-contained file — **no build, no dependencies, no network**.

```bash
# open directly
open harbormaster.html          # macOS
xdg-open harbormaster.html      # Linux
# …or serve it
python3 -m http.server 8000     # then browse http://localhost:8000/harbormaster.html
```

Everything runs client-side with a live operational simulation (advancing clock, drifting inventory,
moving AIS positions, streaming ledger movements). It is fully interactive and keyboard-driven.

### Keyboard & interaction
| Key | Action |
|---|---|
| `⌘K` / `Ctrl-K` | Command palette (search barges, modules, run commands) |
| `1`–`9` | Jump to module (Exec, Fleet, Schedule, HOFTI, Floating, Inventory, Blender, Noms, AI Dispatch) |
| `C` | Toggle AI Copilot |
| `⌘Z` | Undo (in Scheduler) |
| `Esc` | Close palette / modal / copilot / drawer |
| Drag a block | Reassign a delivery between barge lanes / reschedule in time |
| Drag block edges | Resize a delivery window |

---

## The eighteen deliverables — where each one lives

| # | Deliverable | Where |
|---|---|---|
| 1 | Fully clickable, production-quality UI/UX prototype | `harbormaster.html` |
| 2 | Fleet scheduler with drag-and-drop | `harbormaster.html` → **Schedule** (airline dispatch board, daily/weekly/14-day, conflict detection, undo/redo, lock, publish) |
| 3 | HOFTI terminal management module | **HOFTI** (tank farm, loading queue, berths, projected inventory, alerts) |
| 4 | Floating inventory engine | **Floating** (per-barge onboard / committed / available / heel / utilization) |
| 5 | Enterprise inventory engine | **Inventory** (Physical / Floating / HOFTI / Reserved / Committed / Uncommitted / Commercial-Available / Off-spec / Projected, sliced by product / barge / customer / terminal / window) |
| 6 | Blender control center | **Blender** (enterprise view, inventory waterfall, 24/48/72h hourly projections, burn rate, shortage forecast) |
| 7 | Buffalo Marine nomination workflow | **Noms** (lead-time monitor, 9-point validation gate, auto-draft, review & send, Sent → Acknowledged → Revision loop, auto-revise on schedule change) |
| 8 | AI dispatch optimization engine | **AI Disp** (recommendations, conflict prediction, explainable savings) |
| 9 | AI copilot interface | Copilot drawer (`C`) — natural language: *"Show idle barges"*, *"Move D-112 to HH-206"*, *"Can we accept another bunker stem?"* |
| 10 | Executive command center | **Exec** (fleet/charter utilization, enterprise & floating inventory, idle cost, risk radar, top issues) |
| 11 | Complete relational database schema | [`docs/DATABASE_SCHEMA.sql`](docs/DATABASE_SCHEMA.sql) — 5 PostgreSQL schemas, ENUM lifecycle, ledger, partitioning, views, triggers, seeds (validated against live PostgreSQL 16) + [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) |
| 12 | API architecture & documentation | [`docs/API_ARCHITECTURE.md`](docs/API_ARCHITECTURE.md) — FastAPI REST reference across 14 domains, real-time SignalR channels, event-driven automation, AI contracts |
| 13 | Workflow diagrams | [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) — barge lifecycle state machine, nomination flow, HOFTI loading, AI dispatch loop, inspection-PDF automation (mermaid) |
| 14 | User journeys for every role | [`docs/USER_JOURNEYS.md`](docs/USER_JOURNEYS.md) — all 8 roles, day-in-the-life scenarios |
| 15 | Security & permission model | [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md) — Entra ID, 8-role RBAC matrix, RLS/FLS, STRIDE, audit |
| 16 | Power BI executive reporting layer | [`docs/POWERBI_REPORTING.md`](docs/POWERBI_REPORTING.md) — star schema, DAX measures, report pages, streaming/RLS |
| 17 | Responsive desktop & tablet layouts | `harbormaster.html` (CSS grid, responsive breakpoints); strategy in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| 18 | Modern animations & polished enterprise styling | `harbormaster.html` (dark terminal theme, live tickers, animated status, canvas maps/charts) |

Overall reference architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Operational model

**Fleet** — 8 time-chartered barges (HH-201…HH-208), 3,000–8,000 MT.
**Products** — VLSFO 0.50%, HSFO 3.50%, ULSFO 0.10%, LSMGO, MGO.
**Lifecycle** — the full 16-state cycle every delivery/barge moves through, each transition firing
downstream workflows:

```
Available → Transit to HOFTI → Waiting to Load → Loading → Load Complete →
Inspection Pending → Inspection Complete → Nomination Draft Ready → Nomination Sent →
Transit to Customer → Waiting Alongside → Bunkering → Delivery Complete →
Return Transit → Queue for Reload → Available Again
```

The canonical shared model used across the prototype and every document is
[`docs/_DOMAIN_MODEL.md`](docs/_DOMAIN_MODEL.md).

---

## Reference technical architecture

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript (Vite), dark terminal UI, Azure Maps — *prototype is a self-contained vanilla build for zero-dependency review* |
| Backend | FastAPI (Python, async) — .NET acceptable — REST + WebSocket/SignalR |
| Data | PostgreSQL (primary) / SQL Server, Redis cache & pub/sub, Azure Service Bus event bus |
| Identity | Microsoft Entra ID (OIDC/OAuth2 + PKCE), app roles, RBAC, row-level security |
| AI | Azure OpenAI (copilot, dispatch optimization), Azure AI Document Intelligence (inspection PDF OCR) |
| Automation | Power Automate, Microsoft Teams + Outlook (Graph API) |
| Analytics | Power BI executive semantic model (DirectQuery + streaming) |
| Integrations | AIS vessel tracking, NOAA weather / marine advisories |
| Platform | Multi-AZ HA, active-active API, read replicas, App Insights, immutable audit logging |

---

## Repository layout

```
harbormaster.html              ← the clickable platform (open this)
README.md
docs/
  _DOMAIN_MODEL.md             ← canonical shared model
  DATABASE_SCHEMA.sql          ← PostgreSQL DDL (validated) + seeds
  DATA_MODEL.md                ← ER diagram, ledger derivation, partitioning/RLS
  API_ARCHITECTURE.md          ← FastAPI REST + real-time + automation + AI contracts
  WORKFLOWS.md                 ← lifecycle / nomination / dispatch / inspection diagrams
  USER_JOURNEYS.md             ← day-in-the-life for all 8 roles
  SECURITY_MODEL.md            ← Entra ID, RBAC matrix, RLS/FLS, STRIDE, audit
  ARCHITECTURE.md              ← Azure deployment, HA/DR, CI/CD, integration, responsive
  POWERBI_REPORTING.md         ← semantic model, DAX, report pages, streaming/RLS
```

> **Prototype scope.** All operational data is simulated in-browser for demonstration; no live
> external systems are contacted. The prototype demonstrates the UX, interaction model, and
> operational logic; the `docs/` set specifies the production architecture behind it.
