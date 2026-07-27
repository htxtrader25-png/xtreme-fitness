import { useMemo } from 'react';
import { useFleetStore } from './useFleetStore';
import { BARGES, SHORE_TANK } from '@/lib/constants';
import { computeSnapshot } from '@/domain/inventory';
import { detectConflicts, conflictedActivityIds } from '@/domain/constraints';
import { computeUtilization, generateOptimizations } from '@/domain/optimization';
import { generateRecommendations } from '@/domain/recommendations';
import { computeKpis } from '@/domain/analytics';
import type { PlanState } from '@/types';

/** The effective wall-clock (or replay) time the whole app evaluates against. */
export function useEffectiveTime(): Date {
  const clockMs = useFleetStore((s) => s.clockMs);
  const replay = useFleetStore((s) => s.replay);
  return useMemo(
    () => new Date(replay.active ? replay.atMs : clockMs),
    [replay.active, replay.atMs, clockMs],
  );
}

/** The plan currently in view (live plan or active scenario draft). */
export function usePlan(): PlanState {
  const stems = useFleetStore((s) => s.stems);
  const activities = useFleetStore((s) => s.activities);
  const maintenance = useFleetStore((s) => s.maintenance);
  const scenarios = useFleetStore((s) => s.scenarios);
  const activeScenarioId = useFleetStore((s) => s.activeScenarioId);

  return useMemo(() => {
    if (activeScenarioId) {
      const sc = scenarios.find((x) => x.id === activeScenarioId);
      if (sc) return sc.draft;
    }
    return { stems, activities, maintenance };
  }, [stems, activities, maintenance, scenarios, activeScenarioId]);
}

/** All engine outputs derived from the current plan + effective time. */
export function useDerived() {
  const plan = usePlan();
  const now = useEffectiveTime();

  return useMemo(() => {
    const snapshot = computeSnapshot(plan, now, BARGES, SHORE_TANK);
    const conflicts = detectConflicts(plan, BARGES, SHORE_TANK);
    const utilization = computeUtilization(plan, BARGES);
    const optimizations = generateOptimizations(plan, BARGES, SHORE_TANK);
    const recommendations = generateRecommendations(
      plan,
      conflicts,
      BARGES,
      SHORE_TANK,
      now,
    );
    const kpis = computeKpis(plan, conflicts, BARGES, SHORE_TANK, now);
    const conflictActivityIds = conflictedActivityIds(conflicts);

    return {
      plan,
      now,
      snapshot,
      conflicts,
      conflictActivityIds,
      utilization,
      optimizations,
      recommendations,
      kpis,
    };
  }, [plan, now]);
}

export type Derived = ReturnType<typeof useDerived>;
