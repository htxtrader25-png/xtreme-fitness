# Harbormaster — Power BI Reporting & Executive Semantic Model

**Platform:** Harbormaster — Houston Harbor Bunker Fleet, Inventory & Commercial Operations Platform
**Operator tenant:** Fortune 100 energy major · **Counterparty:** Buffalo Marine · **Terminal:** HOFTI
**Document owner:** Principal Security & Platform Architect
**Version:** 1.0 · **Last reviewed:** 2026-07-24

Companion documents: `_DOMAIN_MODEL.md` (canonical domain), `ARCHITECTURE.md` (data tier / read replicas / integrations), `SECURITY_MODEL.md` (RBAC, RLS, FLS). Fleet (HH-201…HH-208), products (VLSFO/HSFO/ULSFO/LSMGO/MGO), HOFTI tanks, customers, and roles are consistent with the domain model.

---

## 1. Purpose & Consumption

The executive semantic model gives leadership and commercial/operations management a governed, single-source-of-truth view of fleet economics, inventory position, and commercial operations. It is built on a **star schema** over the operational PostgreSQL **read replicas** (never the write primary — see `ARCHITECTURE.md` §3.1) so reporting load never touches the transactional hot path.

Consumers and their role mapping (RLS enforced, Section 6):
- **Executive Leadership** — Executive Command Center (aggregated KPIs, no deal-level pricing detail).
- **Operations Manager** — all operational + charter economics pages.
- **Commercial Manager / Trader** — commercial ops, margin, and inventory-availability pages (pricing/margin visible).
- **Marine Scheduler / Dispatcher / Blender / Commercial Operator** — scoped operational pages relevant to their workspace; pricing/margin excluded via RLS/OLS mirroring app FLS.

---

## 2. Semantic Model — Star Schema

### 2.1 Fact tables (grain)
| Fact table | Grain | Key measures/columns |
|---|---|---|
| **fact_delivery** | One row per completed delivery (bunkering to a customer vessel) | delivered MT, nominated MT, delivery cost, revenue, margin, demurrage hours/cost, lead-time band, on-time flag |
| **fact_inventory_snapshot** | One row per product × barge/terminal × ledger-dimension × **snapshot timestamp** (e.g., hourly/daily) | physical MT, floating MT, HOFTI MT, reserved MT, committed MT, uncommitted MT, commercial-available MT, off-spec MT, projected MT |
| **fact_charter_utilization** | One row per barge × **day** | charter cost/day, active hours, idle hours, off-hire hours, utilized MT-capacity-hours, deliveries count |
| **fact_loading** | One row per loading event at HOFTI (barge load from tank/berth) | loaded MT, loading start/end, loading rate MT/hr, berth, tank, wait/queue hours |

### 2.2 Dimension tables
| Dimension | Keys / attributes |
|---|---|
| **dim_barge** | barge_key, code (HH-201…HH-208), name (San Jacinto…Lynchburg), nominal_capacity_mt, charter_cost_day, charter_start/end, off_hire_flag |
| **dim_customer** | customer_key, customer (Maersk/MSC/CMA CGM/Frontline/Teekay/ONE…), segment (container/tanker), restricted_flag |
| **dim_product** | product_key, product (VLSFO/HSFO/ULSFO/LSMGO/MGO), sulphur_spec, grade (RMG380/DMA), unit (MT) |
| **dim_date** | date_key, date, day, week, month, quarter, year, is_month_end, fiscal period |
| **dim_terminal** | terminal_key, terminal (HOFTI), tank (T-01…T-08), berth (A/B), min_operating_mt, working_capacity_mt |
| **dim_vessel** (support) | vessel_key, vessel name, IMO, customer_key |
| **dim_nomination_status** (support) | status_key, state (Draft Ready…Revised) |

### 2.3 Relationships
- Single-direction (1→*) from each dimension to the facts on surrogate keys.
- `dim_date` is the model date table (`Mark as date table`), related to `fact_delivery[delivery_date_key]`, `fact_charter_utilization[date_key]`, `fact_inventory_snapshot[snapshot_date_key]`, `fact_loading[load_date_key]` — supporting a single time intelligence surface. Role-playing date (delivery vs load vs window) handled via inactive relationships + `USERELATIONSHIP`.
- `dim_barge` relates to `fact_delivery`, `fact_charter_utilization`, `fact_loading`, and `fact_inventory_snapshot` (floating slice).

### 2.4 DirectQuery vs Import (storage mode)
Composite / hybrid model:
- **Import**: `dim_*` (small, slowly changing) and `fact_charter_utilization` (daily grain, aggregated) and historical partitions of `fact_delivery`/`fact_loading` — fast, cached, refreshed on schedule.
- **DirectQuery**: current/live operational facts — the latest partition of `fact_inventory_snapshot` and today's `fact_delivery`/`fact_loading` — so inventory position and today's deliveries are live against the read replica.
- **Dual** storage mode on dimensions so they serve both import aggregates and DirectQuery joins efficiently.
- **Hybrid (incremental refresh + real-time) tables**: `fact_inventory_snapshot` and `fact_delivery` use incremental refresh for history with a DirectQuery/real-time hot partition for today (Section 5).
- **Aggregations**: import-mode agg table over `fact_delivery` (by date/product/customer) accelerates common exec queries while detail falls through to DirectQuery.

---

## 3. Key DAX Measures

All measures live in a dedicated `_Measures` table. Costs in USD, volumes in MT. Time intelligence uses `dim_date`.

```dax
-- Fleet Utilization %: utilized capacity-hours vs available capacity-hours across the fleet
Fleet Utilization % =
VAR ActiveHours   = SUM ( fact_charter_utilization[active_hours] )
VAR OffHireHours  = SUM ( fact_charter_utilization[off_hire_hours] )
VAR AvailableHours = SUM ( fact_charter_utilization[active_hours] )
                   + SUM ( fact_charter_utilization[idle_hours] )
RETURN
DIVIDE ( ActiveHours, AvailableHours - OffHireHours )
```

```dax
-- Charter Utilization %: revenue-generating (delivering/loading/transit) hours vs total on-hire hours per barge
Charter Utilization % =
VAR OnHireHours =
    SUM ( fact_charter_utilization[active_hours] )
  + SUM ( fact_charter_utilization[idle_hours] )
VAR ProductiveHours =
    SUM ( fact_charter_utilization[active_hours] )
RETURN
DIVIDE ( ProductiveHours, OnHireHours )
```

```dax
-- Idle Charter Cost: cost of charter time the barge sat idle (idle hours × pro-rated day-rate)
Idle Charter Cost =
SUMX (
    fact_charter_utilization,
    fact_charter_utilization[idle_hours]
        * DIVIDE ( RELATED ( dim_barge[charter_cost_day] ), 24 )
)
```

```dax
-- Cost per MT: total delivery + allocated charter cost per metric ton delivered
Cost per MT =
VAR TotalCost =
    SUM ( fact_delivery[delivery_cost] )
  + [Total Charter Cost]
VAR TotalMT = SUM ( fact_delivery[delivered_mt] )
RETURN
DIVIDE ( TotalCost, TotalMT )
```

```dax
-- Supporting: Total Charter Cost (day-rate summed over the period)
Total Charter Cost =
SUMX (
    fact_charter_utilization,
    DIVIDE ( RELATED ( dim_barge[charter_cost_day] ), 24 )
        * ( fact_charter_utilization[active_hours]
          + fact_charter_utilization[idle_hours] )
)
```

```dax
-- Cost per Delivery: fully-loaded cost divided by number of completed deliveries
Cost per Delivery =
VAR TotalCost =
    SUM ( fact_delivery[delivery_cost] ) + [Total Charter Cost]
VAR Deliveries =
    CALCULATE (
        COUNTROWS ( fact_delivery ),
        fact_delivery[status] = "Delivery Complete"
    )
RETURN
DIVIDE ( TotalCost, Deliveries )
```

```dax
-- Total Enterprise Inventory: latest snapshot of all physical inventory across barges + HOFTI
Total Enterprise Inventory =
CALCULATE (
    SUM ( fact_inventory_snapshot[physical_mt] ),
    fact_inventory_snapshot[snapshot_ts]
        = MAX ( fact_inventory_snapshot[snapshot_ts] )
)
```

```dax
-- Floating Inventory: latest on-barge inventory (in transit / on the water)
Floating Inventory =
CALCULATE (
    SUM ( fact_inventory_snapshot[floating_mt] ),
    fact_inventory_snapshot[snapshot_ts]
        = MAX ( fact_inventory_snapshot[snapshot_ts] ),
    dim_terminal[terminal] <> "HOFTI"  -- on-barge, not in terminal tanks
)
```

```dax
-- Commercial Available Inventory: uncommitted, on-spec inventory available to sell
Commercial Available Inventory =
CALCULATE (
    SUM ( fact_inventory_snapshot[commercial_available_mt] ),
    fact_inventory_snapshot[snapshot_ts]
        = MAX ( fact_inventory_snapshot[snapshot_ts] ),
    fact_inventory_snapshot[off_spec_flag] = FALSE
)
```

```dax
-- Daily Deliveries: count of completed deliveries in context (use with dim_date on axis)
Daily Deliveries =
CALCULATE (
    COUNTROWS ( fact_delivery ),
    fact_delivery[status] = "Delivery Complete"
)
```

```dax
-- Demurrage Exposure: accrued + projected demurrage cost from delivery delays
Demurrage Exposure =
SUMX (
    fact_delivery,
    MAX ( fact_delivery[demurrage_hours], 0 )
        * fact_delivery[demurrage_rate_hr]
)
```

```dax
-- Inventory Days of Cover: how many days current commercial-available inventory lasts
-- at the trailing 30-day average daily delivered volume
Inventory Days of Cover =
VAR AvailableMT = [Commercial Available Inventory]
VAR AvgDailyLift =
    DIVIDE (
        CALCULATE (
            SUM ( fact_delivery[delivered_mt] ),
            DATESINPERIOD ( dim_date[date], MAX ( dim_date[date] ), -30, DAY )
        ),
        30
    )
RETURN
DIVIDE ( AvailableMT, AvgDailyLift )
```

Supporting measures also defined: `Total Delivered MT`, `On-Time Delivery %`, `Avg Loading Rate MT/hr`, `Reserved Inventory`, `Committed Inventory`, `Uncommitted Inventory`, `Projected Inventory`, `Gross Margin USD` and `Net Margin USD/MT` (the last two protected by OLS/RLS so only pricing/margin-entitled roles resolve them).

---

## 4. Report Pages

### 4.1 Executive Command Center
Audience: Executive Leadership, Operations Manager, Commercial Manager. The single-glance operating picture.
- **KPI cards (top ribbon):** Total Enterprise Inventory (MT), Commercial Available Inventory (MT), Inventory Days of Cover, Fleet Utilization %, Daily Deliveries (today), Demurrage Exposure (USD), Cost per MT.
- **Fleet status donut/bar:** count of barges by lifecycle state (Available, Loading, Bunkering, Transit, …) from the operational lifecycle.
- **Deliveries trend:** Daily Deliveries + Total Delivered MT time series (last 30/90 days) with On-Time Delivery %.
- **Inventory by product stacked column:** physical / floating / HOFTI / commercial-available by product (VLSFO/HSFO/ULSFO/LSMGO/MGO).
- **Map tile:** Azure-Maps-style barge/vessel positions (live via streaming tile).
- **Alerts panel:** low-tank, weather advisory (NOAA), demurrage-risk deliveries.

### 4.2 Charter Economics
Audience: Operations Manager, Commercial Manager, Executive.
- **Charter Utilization % by barge** (bar, HH-201…HH-208) with fleet average line.
- **Idle Charter Cost by barge & week** (matrix/heatmap) — where money is burning on idle time.
- **Cost per MT and Cost per Delivery** trend and by-barge breakdown.
- **Idle hours vs active vs off-hire** stacked bars per barge.
- **Utilization vs capacity** scatter (nominal capacity MT vs utilization %) to spot under-used large barges (Texas City / Baytown 8,000 MT).
- KPIs: Fleet Utilization %, Charter Utilization %, Total Charter Cost, Idle Charter Cost.

### 4.3 Inventory & Blending
Audience: Operations Manager, Blender, Commercial Manager.
- **Enterprise inventory waterfall:** Physical → Reserved → Committed → Uncommitted → Commercial Available, by product.
- **Floating vs HOFTI split** by product and barge.
- **Inventory Days of Cover** gauge per product with min-operating thresholds.
- **Off-spec inventory** table (product, barge/tank, MT) feeding blend decisions.
- **Blend activity** (from blender center): recipes executed, resulting on-spec MT, yield.
- **HOFTI tank levels** (T-01…T-08): current / working / minimum-operating / available, projected depletion.
- KPIs: Total Enterprise Inventory, Floating Inventory, Commercial Available Inventory, Days of Cover.

### 4.4 Nomination / Commercial Ops
Audience: Commercial Manager, Trader, Commercial Operator (pricing/margin visible per RLS).
- **Nomination funnel:** counts by state (Draft Ready → Sent → Acknowledged → Revision Required → Revised).
- **Deliveries by customer & product** (Maersk/MSC/CMA CGM/Frontline/Teekay/ONE) — MT and revenue.
- **Margin analysis:** Gross Margin USD, Net Margin USD/MT by product/customer (OLS-gated).
- **Lead-time compliance:** deliveries by contract lead-time band (6/12/24/48 hr) and on-time %.
- **Demurrage Exposure** by customer/vessel with delay drivers.
- **Revision loop rate:** % nominations requiring revision (quality signal on drafting).
- KPIs: Daily Deliveries, Total Delivered MT, On-Time Delivery %, Demurrage Exposure, margins.

### 4.5 Terminal (HOFTI) Ops
Audience: Dispatcher, Operations Manager, Marine Scheduler.
- **Tank matrix (T-01…T-08):** product, current / working / min-operating / available / reserved MT, utilization %, projected inventory, incoming replenishment.
- **Loading throughput:** loaded MT and Avg Loading Rate MT/hr by berth (A/B) and day.
- **Berth queue & wait times:** queue length, avg wait/queue hours, active berth occupancy.
- **Loading events timeline** (fact_loading): start/end, barge, tank, berth, rate.
- **Tank depletion projection** vs minimum operating level with replenishment ETAs.
- KPIs: Avg Loading Rate MT/hr, tank utilization, HOFTI inventory (from Total Enterprise Inventory sliced to terminal).

---

## 5. Refresh, Streaming & Hybrid Tables

- **Import dimensions & aggregates:** scheduled refresh (e.g., every 30–60 min for aggregates; daily for slowly-changing dims) via the analytics service principal against the read replica.
- **Incremental refresh + real-time (hybrid) tables:** `fact_inventory_snapshot` and `fact_delivery` keep historical partitions in import (incremental refresh, e.g., 24 months) and a **hot DirectQuery/real-time partition for today**, so inventory position and today's deliveries are always current without reloading history.
- **Real-time live-ops tiles:** the Executive Command Center's live tiles (current tank levels, active barge states, live delivery count, map positions) are fed by a **push/streaming dataset**. Backend workers push events (from the Service Bus event stream — see `ARCHITECTURE.md` §6) into the Power BI **streaming dataset** via the REST push API, giving sub-minute tile updates on the ops dashboard.
- **DirectQuery** for detailed live drill-through (current snapshot rows) hits the read replica so the write primary is never loaded by reporting.
- Refresh health and dataset failures are monitored; failures alert the platform team.

---

## 6. Row-Level Security (RLS) — Mirroring App Roles

Power BI RLS roles mirror the Harbormaster app roles and FLS rules defined in `SECURITY_MODEL.md` (§3–5), enforced by DAX filters on the model and, for column protection, **Object-Level Security (OLS)** hiding pricing/margin columns and measures.

| Power BI RLS role | Row scope (DAX filter) | Pricing/Margin (OLS) |
|---|---|---|
| **Executive** | All rows, aggregated (no restricted-customer deal detail) | Hidden (KPIs only, no deal pricing) |
| **OperationsManager** | All operational rows | Read (margin visible, read-only) |
| **CommercialManager** | All commercial rows | Visible (pricing + margin) |
| **Trader** | Rows for assigned commercial **book(s)** only: `[book] IN VALUES(book_membership)` | Visible (pricing + margin) |
| **CommercialOperator** | Own/team commercial rows | Pricing visible, margin hidden |
| **MarineScheduler** | Operational (fleet/schedule/terminal) rows | Hidden |
| **Dispatcher** | Operational (terminal/floating) rows | Hidden |
| **Blender** | Inventory/blend rows | Hidden |

Implementation notes:
- RLS filters use `USERPRINCIPALNAME()` mapped through a `dim_user_book` security bridge (user → book / customer / role scope) so trader book isolation and restricted-customer confidentiality match the API's row-level security exactly.
- Membership in a Power BI role is driven by the same Entra security groups (`sg-hm-*`) used for app roles — one identity model, no divergence between app and report entitlements.
- Restricted-customer rows (`dim_customer[restricted_flag]=TRUE`) are filtered out for all but the assigned owner and Commercial Manager, mirroring `SECURITY_MODEL.md` §5.2.
- Pricing/margin **measures** (`Gross Margin USD`, `Net Margin USD/MT`) and columns are OLS-protected so a Dispatcher or Scheduler opening the report cannot resolve them at all — matching the app's field-level security (a dispatcher never sees commercial pricing).

---

## 7. Governance & Deployment

- Semantic model developed in Power BI Desktop, source-controlled (PBIP/TMDL), deployed via **deployment pipelines** across dev/test/prod workspaces aligned to `ARCHITECTURE.md` environments.
- Certified/promoted datasets; a single shared semantic model feeds all report pages (one source of truth for measures).
- Data source: read replica via gateway/service principal with least-privilege, RLS-scoped database login (`id-hm-analytics`, `SECURITY_MODEL.md` §2.8). No writeback from Power BI.
- Sensitivity labels (Purview) applied; export controls limited for pricing/margin pages.

---

## 8. Summary

A governed star-schema semantic model (facts: delivery, inventory snapshot, charter utilization, loading; dims: barge, customer, product, date, terminal) over the operational read replicas, using a hybrid Import/DirectQuery/streaming strategy. It supplies leadership with fleet economics, live inventory position, and commercial-ops insight across five report pages, with a full set of DAX measures (utilization, cost per MT/delivery, enterprise/floating/commercial-available inventory, days of cover, demurrage exposure) and Power BI RLS/OLS that mirror the app's roles and field-level security — so the report tier upholds the same segregation (dispatchers never see pricing; traders see only their book) enforced in `SECURITY_MODEL.md`.
