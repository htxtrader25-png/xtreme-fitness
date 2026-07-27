# Engineering Decisions & Assumptions

This document records the production-ready assumptions made where the
specification was ambiguous, per the build instructions. Each entry states the
decision, the rationale, and the migration path where relevant.

---

## D1 — Scheduler library: DayPilot **Lite** React Scheduler

The spec names "DayPilot React Scheduler (MVP)". The full **DayPilot Pro**
Scheduler is a commercial component (its public npm package is a licensing
placeholder) and would require a paid license — incompatible with "production
quality, no placeholder UI" in a self-contained build.

**Decision:** Use `@daypilot/daypilot-lite-react` (v5.10, Apache-2.0), which
ships a real resource-timeline `DayPilotScheduler` supporting event move,
resize, drag-to-create (time-range select), context menus and custom
cell/event rendering — covering every scheduler requirement, free and
production-usable.

**Migration path:** All scheduler interaction is funnelled through a thin bridge
(`src/components/scheduler/dp.ts` + `FleetScheduler.tsx`) that maps our domain
`Activity` objects to scheduler events and back. Swapping in Bryntum Scheduler
Pro or DayPilot Pro means reimplementing only that one component against the same
store actions (`moveActivity`, `resizeActivity`, `openNewStem`, …).

## D2 — Current-time indicator

DayPilot Lite does not expose a built-in "now" line. **Decision:** mark the cell
containing the current time via `onBeforeCellRender` (a red left-accent border +
tint) and auto-scroll to now on view change. This scrolls natively with the grid
and is robust across day/week/month scales.

## D3 — Activity timing model

Durations are derived, not hard-coded per stem:
- **Inspection** — fixed 1.0 h (survey / meter check).
- **Loading** — `volume ÷ barge.loadRate` (barge-specific shore pump rate).
- **Transit / Return Transit** — fixed 2.5 h each (Houston Ship Channel average).
- **Delivery** — `volume ÷ barge.pumpRate` (barge-specific delivery rate).
- **Available** — fixed 1.0 h reset/availability buffer.

The chain is **anchored at the Delivery activity = the start of the customer
delivery window**, then back-calculated (Transit → Loading → Inspection) and
forward-calculated (Return Transit → Available). Activities within a stem are
contiguous; idle/waiting time therefore lives in the gaps *between* stems on a
barge, which is what the optimization engine measures.

## D4 — "Moving one activity recalculates all dependents"

`recalcChain` (in `src/domain/activities.ts`) preserves each activity's duration
and re-anchors the whole contiguous chain around the moved/resized activity —
propagating forward and backward. Dragging a stem's bar to a different barge row
reassigns the entire stem (and re-derives loading/delivery durations for that
barge's rates).

## D5 — Inventory model: continuous (linear) transfer

Rather than step changes, Loading and Delivery transfer volume **linearly over
the activity duration**: during Loading the shore tank ramps down and the barge
ramps up; during Delivery the barge ramps down. This yields smooth inventory
curves for the live display and the Replay scrubber. Barges open **empty** at the
horizon; the shore tank opens at its configured opening inventory (28,000 m³).
Any schedule edit simply re-evaluates snapshots, so updates are instantaneous.

## D6 — Fleet utilization uses a **union** of busy intervals

Utilization is `busy ÷ horizon` where `busy` is the union (overlaps counted
once) of a barge's activity intervals, capped at 100%. This keeps utilization
meaningful even when the plan contains overlap conflicts.

## D7 — AI Recommendation & Optimization engines are rule-based

No external LLM/network dependency. The engines are deterministic,
explainable rule systems (`recommendations.ts`, `optimization.ts`). **Every**
recommendation and suggestion carries human-readable reasoning, satisfying the
"all recommendations include reasoning" criterion. The `Recommendation`/
`OptimizationSuggestion` types leave room for a future model-backed provider.

## D8 — Map Integration is a schematic SVG (no external tiles)

Outbound tile/AIS services are out of scope for the MVP and the environment
restricts arbitrary network calls. **Decision:** a schematic Houston Ship
Channel SVG positions each barge live from its current activity/progress
(shore → channel → sea buoy). The position model is isolated so a real AIS /
marine-chart layer can be dropped in later against the same fractions.

## D9 — Weather Hooks: pluggable provider with a synthetic source

A `WeatherProvider` interface (`src/domain/weather.ts`) abstracts the source. The
MVP ships a deterministic synthetic provider (diurnal wind pattern, gusts, wave,
visibility, ops advisories) so the feature is fully functional offline. Swap
`weatherProvider` for a NOAA/tides adapter to integrate live data.

## D10 — Persistence: Zustand `persist` → localStorage

The live plan (stems, activities, maintenance), scenarios, and view preferences
are persisted under `houston-bunker-fleet-scheduler:v1`. Transient UI state
(open modal, replay playing) is intentionally **not** persisted. A versioned
key + `partialize` gives a clean migration seam toward PostgreSQL/WebSocket
persistence (see `src/domain/integration.ts` for the export/import envelope
that a real backend adapter would consume).

## D11 — Enterprise Integration surface

`src/domain/integration.ts` defines a stable, versioned `PlanEnvelope` and
JSON export/import (wired to the header's download/upload buttons). This is the
concrete migration point for ERP/terminal APIs — a real adapter POSTs the same
envelope instead of downloading it.

## D12 — Seed data & the clock

The demo plan is **anchored to the start of the current day** so the timeline
always opens populated with the current-time marker in view. Delivery windows
are spaced per barge so the seed opens **conflict-free and feasible**; editing,
dragging or adding stems is what surfaces conflicts. One maintenance block sits
in an Atlas gap to exercise the maintenance-conflict detector once a stem is
dragged onto it. The app clock ticks every 15 s (real time); Replay mode
overrides the effective time so all engines evaluate against the scrubbed
instant.

## D13 — Repository layout

The repository previously held a static "xtreme-fitness" HTML site. Those four
files were **preserved** by moving them into `legacy/` (not deleted) so the Vite
app can own the repository root (`index.html` is the Vite entry). Nothing from
the prior site was destroyed.

## D14 — Three barges, one tank, four products

Fleet capacities/rates (`src/lib/constants.ts`): Atlas 6,000 m³, Titan
8,000 m³, Orion 4,500 m³; HOFTI Tank 101 40,000 m³. Products: VLSFO, HSFO, MGO,
LSMGO. These are realistic assumptions for a Houston barge operation and are the
single source of truth consumed by every engine.

## D15 — Security posture & hardening

A security audit confirmed no exploitable vulnerabilities (fully client-side app:
no backend, no network calls, no secrets; React and DayPilot escape all rendered
text; no `dangerouslySetInnerHTML`/`eval`/`innerHTML`). Three hardening measures
were nonetheless applied:

- **Import validation.** `parseEnvelope` (`src/domain/integration.ts`) treats
  imported JSON as untrusted: it validates every field (types, enums,
  ISO-date validity, known barge/product ids), drops malformed child records,
  and rejects fundamentally invalid envelopes with a clear error — so a hostile
  or corrupt file cannot seed invalid state.
- **Content-Security-Policy.** A build-only Vite plugin injects a tight CSP
  (`default-src 'self'`, `script-src 'self'`, `object-src 'none'`,
  `base-uri 'none'`, …) into the production `index.html`. It is applied to the
  build only so it never interferes with dev HMR/react-refresh. Verified: the
  production bundle runs with zero CSP violations, including the Blob-based JSON
  export.
- **Dependency updates.** Upgraded Vite (→ 8) and `@vitejs/plugin-react` (→ 6),
  clearing the dev-server esbuild/vite advisories; `npm audit` reports 0
  vulnerabilities.

While hardening the build, a **production-only startup crash** was found and
fixed: the earlier `manualChunks` split of React into a `vendor` chunk made
`react-dom` initialize before `react`. Only DayPilot is now split into its own
chunk; React stays in the entry chunk. (This bug was previously masked because
only the dev server had been exercised.)
