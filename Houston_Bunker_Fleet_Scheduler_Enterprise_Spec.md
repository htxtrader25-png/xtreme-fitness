# Houston Bunker Fleet Scheduler – Enterprise Build Specification

> This document is the master specification for building a production-quality
> bunker fleet scheduling and decision-support platform. It is the authoritative
> product requirements document (PRD) for this repository.

## Vision

Build an enterprise React application that functions as the operational command
center for bunker operations. It is not a dashboard. It is a live scheduling,
inventory, optimization, and decision-support platform.

## Core Modules

1. Platform Architecture
2. Fleet Scheduler
3. Stem Management
4. Inventory Engine
5. Constraint & Conflict Engine
6. Idle-Time Optimization
7. AI Recommendation Engine
8. Scenario / What-if Planning
9. Command Center
10. Analytics
11. Replay & Timeline
12. Map Integration
13. Weather Hooks
14. Persistence
15. Enterprise Integration

## Technology

- React
- TypeScript
- Vite
- DayPilot React Scheduler (MVP)
- Tailwind CSS
- Zustand
- date-fns
- Local Storage (MVP)
- Modular architecture allowing later migration to Bryntum Scheduler Pro

## Fleet

Three barges:
- Atlas
- Titan
- Orion

One shore tank:
- HOFTI Tank 101

## Scheduler Requirements

- Resource timeline
- Drag and drop
- Resize
- Drag-to-create
- Copy/delete/edit
- Day/week/month views
- Current-time indicator
- Filters
- Search
- Conflict highlighting

## Stem Lifecycle

Each stem automatically generates linked activities:

Inspection → Loading → Transit → Delivery → Return Transit → Available

Moving one activity recalculates all dependent activities.

## Live Inventory

Continuously display:
- HOFTI inventory
- Inventory by barge
- Total fleet inventory
- Remaining capacity
- Utilization

Updating any event immediately recalculates inventory.

## New Stem

Modal includes: Customer, Vessel, Product, Volume, Delivery window, Priority,
Assigned barge, Notes.

Preview inventory impact before saving.

## Constraint Engine

Detect: Overlaps, Low inventory, Capacity exceeded, Delivery window violations,
Maintenance conflicts, Impossible transit.

## Idle-Time Optimization

Calculate: Hours idle, Fleet utilization, Waiting time, Sailing time, Loading
time, Delivering time.

Optimization button suggests: Swap barges, Shift departures, Consolidate trips,
Reduce idle hours.

## AI Recommendations

Always-on panel explaining: Best barge assignment, Inventory risks, Conflict
resolution, Commercial impact, Expected utilization improvement.

## Scenario Mode

Create temporary scenarios without changing live schedule.

Compare: Before / After.

Metrics: Inventory, Utilization, Conflicts, Idle hours.

## Command Center

Persistent right panel: Alerts, Inventory, Fleet status, KPIs, Active stem,
Recommendations, Conflicts.

## Analytics

KPIs: Deliveries today, Tank utilization, Fleet utilization, Idle hours,
Conflict count, At-risk deliveries.

## Replay

Timeline playback showing inventory and fleet state over time.

## Optional Future Integrations

- PostgreSQL
- WebSockets
- Authentication
- AIS vessel tracking
- Weather/tides
- ERP/terminal APIs

## Acceptance Criteria

Every visible control functions. All drag operations update inventory instantly.
Every schedule change triggers validation. All recommendations include
reasoning. No placeholder UI.
