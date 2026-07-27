import type {
  AnalyticsKpis,
  Barge,
  Conflict,
  PlanState,
  ShoreTank,
} from '@/types';
import { fmtDay, iso } from '@/lib/time';
import { computeSnapshot } from './inventory';
import { computeUtilization } from './optimization';

// ---------------------------------------------------------------------------
// Analytics — headline KPIs for the command center & analytics dashboard.
// ---------------------------------------------------------------------------

export function computeKpis(
  plan: PlanState,
  conflicts: Conflict[],
  barges: Barge[],
  tank: ShoreTank,
  now: Date,
): AnalyticsKpis {
  const today = fmtDay(now);

  const deliveriesToday = plan.activities.filter(
    (a) => a.type === 'Delivery' && fmtDay(a.start) === today,
  ).length;

  const snap = computeSnapshot(plan, now, barges, tank);
  const util = computeUtilization(plan, barges);

  // At-risk = stems whose delivery falls outside window, or implicated in a
  // critical conflict.
  const riskyStemIds = new Set<string>();
  for (const c of conflicts) {
    if (c.severity === 'critical' || c.type === 'window-violation') {
      if (c.stemId) riskyStemIds.add(c.stemId);
    }
  }

  return {
    deliveriesToday,
    tankUtilization: snap.tank.utilization,
    fleetUtilization: util.fleetUtilization,
    idleHours: util.totalIdleHours,
    conflictCount: conflicts.length,
    atRiskDeliveries: riskyStemIds.size,
    totalStems: plan.stems.length,
    volumeScheduled: plan.stems.reduce((s, x) => s + x.volume, 0),
  };
}

/** Deliveries grouped by day for a small analytics bar chart. */
export function deliveriesByDay(plan: PlanState): { day: string; count: number; volume: number }[] {
  const map = new Map<string, { count: number; volume: number }>();
  for (const a of plan.activities) {
    if (a.type !== 'Delivery') continue;
    const day = fmtDay(a.start);
    const stem = plan.stems.find((s) => s.id === a.stemId);
    const cur = map.get(day) ?? { count: 0, volume: 0 };
    cur.count += 1;
    cur.volume += stem?.volume ?? 0;
    map.set(day, cur);
  }
  return [...map.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => iso(a.day).getTime() - iso(b.day).getTime());
}

/** Volume by product for an analytics breakdown. */
export function volumeByProduct(plan: PlanState): { product: string; volume: number }[] {
  const map = new Map<string, number>();
  for (const s of plan.stems) {
    map.set(s.product, (map.get(s.product) ?? 0) + s.volume);
  }
  return [...map.entries()].map(([product, volume]) => ({ product, volume }));
}
