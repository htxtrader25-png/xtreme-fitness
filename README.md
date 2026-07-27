# Houston Bunker Fleet Scheduler

An enterprise **operational command center** for bunker fleet operations — a
live scheduling, inventory, optimization and decision-support platform (not a
dashboard). Built from `Houston_Bunker_Fleet_Scheduler_Enterprise_Spec.md`.

> Fleet: **Atlas**, **Titan**, **Orion** barges + **HOFTI Tank 101** shore tank.

## Stack

React 18 · TypeScript · Vite · DayPilot Lite React Scheduler · Tailwind CSS ·
Zustand (+ localStorage persistence) · date-fns · lucide-react.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check (tsc -b) + production build
npm run preview    # preview the production build
```

## Modules

| Module | What it does |
| --- | --- |
| **Fleet Scheduler** | Resource timeline (DayPilot) with drag/move, resize, drag-to-create, context-menu copy/edit/delete, day/week/month scales, current-time marker, filters, search and live conflict highlighting. |
| **Stem Management** | New/Edit stem modal (customer, vessel, product, volume, delivery window, priority, barge, notes) with a **live inventory-impact preview** before saving. Each stem auto-generates its Inspection → Loading → Transit → Delivery → Return Transit → Available lifecycle; moving one activity recalculates the rest. |
| **Inventory Engine** | Continuous inventory for the shore tank, each barge, total fleet, remaining capacity and utilization — recomputed instantly on every edit. |
| **Constraint & Conflict Engine** | Detects overlaps, low inventory, capacity exceeded, delivery-window violations, maintenance conflicts and impossible transits. |
| **Idle-Time Optimization** | Idle / waiting / sailing / loading / delivering hours and utilization per barge and fleet, with applicable suggestions (swap barge, shift departure, consolidate, reduce idle). |
| **AI Recommendations** | Always-on, reasoned recommendations: best barge assignment, inventory risk, conflict resolution, commercial impact, utilization — with one-click actions. |
| **Scenario / What-if** | Branch the live plan into a sandbox, edit freely, and compare **before/after** metrics (utilization, idle, conflicts, at-risk, tank trough). Apply back to live or discard. |
| **Command Center** | Persistent right panel: KPIs, alerts, inventory, fleet status, active stem, recommendations, conflicts. |
| **Analytics** | KPI tiles + deliveries-by-day, volume-by-product and per-barge time breakdown. |
| **Replay & Timeline** | Scrub/play the plan; inventory and fleet state evolve at the playhead. |
| **Map** | Schematic Houston Ship Channel with live barge positions derived from the schedule. |
| **Weather Hooks** | Pluggable `WeatherProvider` with a synthetic Houston source driving ops advisories. |
| **Persistence & Integration** | localStorage persistence; JSON export/import via a versioned plan envelope (ERP/DB migration seam). |

## Architecture

```
src/
  types/         Domain model (single source of truth)
  lib/           constants (fleet/products/timing), time & id helpers
  domain/        Pure engines — activities, inventory, constraints,
                 optimization, recommendations, analytics, weather,
                 integration, planMetrics, seed
  store/         Zustand store (+ persistence) and derived selectors
  components/    Scheduler, modals, command center, and each module view
```

The **domain engines are pure, framework-agnostic functions** operating on the
types in `src/types`. UI reads everything through `useDerived()`, which
recomputes inventory/conflicts/recommendations/KPIs from the effective plan and
clock. This keeps the model portable for a later migration to Bryntum Scheduler
Pro or a server backend.

See **`DECISIONS.md`** for the assumptions made where the spec was ambiguous.

## Note on the repository

This repo previously hosted a static "xtreme-fitness" site; those files were
preserved under `legacy/` so this Vite application can own the project root.
