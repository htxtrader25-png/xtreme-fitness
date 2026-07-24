# Houston Harbor Bunker Platform — Canonical Domain Model (shared reference)

Product code name: **Harbormaster** — Houston Harbor Bunker Fleet, Inventory & Commercial Operations Platform.
Operator: Fortune 100 energy major (reference tenant). Nomination counterparty: **Buffalo Marine**.
Terminal / reload point: **HOFTI** (Houston Oil Field Terminal Inc.) primary bunker storage.
Ops tempo: 24/7/365, Houston Harbor / Houston Ship Channel.

## Products (marine fuels)
- VLSFO  — Very Low Sulphur Fuel Oil 0.50% (RMG 380)
- HSFO   — High Sulphur Fuel Oil 3.50% (RMG 380)
- ULSFO  — Ultra Low Sulphur Fuel Oil 0.10%
- LSMGO  — Low Sulphur Marine Gas Oil DMA 0.10%
- MGO    — Marine Gas Oil DMA
Units: metric tons (MT). Density/temp corrected volumes tracked in liters@15C for inspection reconciliation.

## Fleet (time-chartered bunker barges)
8 barges. Names + nominal capacity (MT):
- HH-201 "San Jacinto"    — 6,500 MT
- HH-202 "Buffalo Bayou"  — 6,500 MT
- HH-203 "Bolivar"        — 4,200 MT
- HH-204 "Morgan's Point" — 4,200 MT
- HH-205 "Texas City"     — 8,000 MT
- HH-206 "Baytown"        — 8,000 MT
- HH-207 "Galveston"      — 3,000 MT
- HH-208 "Lynchburg"      — 3,000 MT
Each barge: charter cost/day, heel volume, utilization %, idle hours, charter contract, off-hire windows.

## Operational status lifecycle (ordered)
Available -> Transit to HOFTI -> Waiting to Load -> Loading -> Load Complete ->
Inspection Pending -> Inspection Complete -> Nomination Draft Ready -> Nomination Sent ->
Transit to Customer -> Waiting Alongside -> Bunkering -> Delivery Complete ->
Return Transit -> Queue for Reload -> Available Again

## HOFTI terminal
Tanks (e.g., T-01..T-08) each holding one product. Metrics: current, working, minimum operating,
available, reserved inventory; incoming replenishment; loading queue; active berth; loading rate (MT/hr);
avg loading time; projected inventory; tank utilization. Two loading berths (Berth A / Berth B).

## Customers & vessels (examples)
- Maersk (container): "Maersk Sentosa", "Maersk Halifax"
- MSC: "MSC Ambra", "MSC Diana"
- CMA CGM: "CMA CGM Jacques Saade"
- Frontline (tanker): "Front Altair"
- Teekay: "Teekay Foundation"
- ONE: "ONE Innovation"
Each delivery: customer, vessel, product, nominated qty (MT), delivery window (start/end), berth/anchorage,
contract nomination lead time (6/12/24/48 hr).

## Nomination (Buffalo Marine) states
Draft Ready -> Sent -> Acknowledged -> Revision Required (loop) ; plus Revised re-issue with audit trail.

## Inventory ledger dimensions (enterprise engine)
Physical, Floating (on-barge), HOFTI, Reserved, Committed, Uncommitted, Commercial Available,
Off-spec, Projected. Sliced by Product / Barge / Customer / Terminal / Delivery Window.

## Roles / workspaces
Commercial Operator, Dispatcher, Marine Scheduler, Blender, Trader, Commercial Manager,
Operations Manager, Executive Leadership.

## Reference tech architecture
Frontend: React + TypeScript (Vite), Fluent/Design-system dark terminal UI, Azure Maps.
Backend: FastAPI (Python) primary [.NET acceptable], async, REST.
Data: PostgreSQL (primary) / SQL Server. Redis cache + pub/sub. Event bus (Azure Service Bus).
Identity: Microsoft Entra ID (OIDC/OAuth2, app roles). RBAC + row-level security.
AI: Azure OpenAI (copilot, dispatch optimization, NL), Azure AI Document Intelligence (inspection PDF OCR).
Automation: Power Automate flows; Microsoft Teams + Outlook (Graph API) notifications/drafts.
Analytics: Power BI (executive semantic model / DirectQuery).
Integrations: AIS vessel tracking API, NOAA weather / marine advisories.
Observability: audit logging, App Insights. HA: multi-AZ, active-active API, read replicas.
