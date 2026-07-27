import type { Barge, PlanState, ShoreTank } from '@/types';
import { detectConflicts } from './constraints';
import { computeUtilization } from './optimization';
import { troughTankLevel } from './inventory';

// ---------------------------------------------------------------------------
// Compact metric bundle for a plan — used for scenario before/after comparison.
// ---------------------------------------------------------------------------

export interface PlanMetrics {
  conflicts: number;
  criticalConflicts: number;
  fleetUtilization: number;
  idleHours: number;
  tankTrough: number;
  atRisk: number;
  stems: number;
  volume: number;
}

export function computePlanMetrics(
  plan: PlanState,
  barges: Barge[],
  tank: ShoreTank,
): PlanMetrics {
  const conflicts = detectConflicts(plan, barges, tank);
  const util = computeUtilization(plan, barges);
  const trough = troughTankLevel(plan, barges, tank);
  const atRisk = new Set(
    conflicts
      .filter((c) => c.severity === 'critical' || c.type === 'window-violation')
      .map((c) => c.stemId)
      .filter(Boolean) as string[],
  );
  return {
    conflicts: conflicts.length,
    criticalConflicts: conflicts.filter((c) => c.severity === 'critical').length,
    fleetUtilization: util.fleetUtilization,
    idleHours: util.totalIdleHours,
    tankTrough: trough.level,
    atRisk: atRisk.size,
    stems: plan.stems.length,
    volume: plan.stems.reduce((s, x) => s + x.volume, 0),
  };
}
