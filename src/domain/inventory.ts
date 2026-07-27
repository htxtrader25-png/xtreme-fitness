import type {
  Activity,
  Barge,
  InventorySnapshot,
  PlanState,
  ShoreTank,
  Stem,
} from '@/types';
import { iso } from '@/lib/time';

// ---------------------------------------------------------------------------
// Inventory engine.
//
// Model: continuous (linear) transfer during Loading and Delivery activities so
// that inventory ramps smoothly for the live display and replay.
//   • Loading  : tank ↓ and assigned barge ↑ linearly over the activity.
//   • Delivery : assigned barge ↓ linearly over the activity.
// Barges open empty at the horizon; the shore tank opens at its configured
// opening inventory. Any schedule edit simply re-evaluates snapshots — updates
// are therefore instantaneous.
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Fraction (0..1) of an activity completed at time `at`. */
function progressAt(activity: Activity | undefined, at: number): number {
  if (!activity) return 0;
  const s = iso(activity.start).getTime();
  const e = iso(activity.end).getTime();
  if (e <= s) return at >= e ? 1 : 0;
  return clamp01((at - s) / (e - s));
}

interface StemLegs {
  stem: Stem;
  loading?: Activity;
  delivery?: Activity;
}

function legsFor(plan: PlanState): StemLegs[] {
  const byStem = new Map<string, StemLegs>();
  for (const s of plan.stems) byStem.set(s.id, { stem: s });
  for (const a of plan.activities) {
    const legs = byStem.get(a.stemId);
    if (!legs) continue;
    if (a.type === 'Loading') legs.loading = a;
    if (a.type === 'Delivery') legs.delivery = a;
  }
  return [...byStem.values()];
}

/** Compute a full inventory snapshot for the whole operation at time `at`. */
export function computeSnapshot(
  plan: PlanState,
  at: Date,
  barges: Barge[],
  tank: ShoreTank,
): InventorySnapshot {
  const t = at.getTime();
  const legs = legsFor(plan);

  let tankLevel = tank.openingInventory;
  const bargeLevels = new Map<string, number>();
  for (const b of barges) bargeLevels.set(b.id, 0);

  for (const { stem, loading, delivery } of legs) {
    const loadedFrac = progressAt(loading, t);
    const deliveredFrac = progressAt(delivery, t);
    const loaded = stem.volume * loadedFrac;
    const delivered = stem.volume * deliveredFrac;

    // Loading pulls from the tank and fills the barge.
    tankLevel -= loaded;
    const cur = bargeLevels.get(stem.bargeId) ?? 0;
    bargeLevels.set(stem.bargeId, cur + loaded - delivered);
  }

  const bargeSnaps = barges.map((b) => {
    const level = Math.max(0, bargeLevels.get(b.id) ?? 0);
    return {
      id: b.id,
      name: b.name,
      level,
      capacity: b.capacity,
      remaining: b.capacity - level,
      utilization: b.capacity > 0 ? level / b.capacity : 0,
    };
  });

  const fleetLevel = bargeSnaps.reduce((s, b) => s + b.level, 0);
  const fleetCapacity = barges.reduce((s, b) => s + b.capacity, 0);

  return {
    at: at.toISOString(),
    tank: {
      id: tank.id,
      level: Math.max(0, tankLevel),
      capacity: tank.capacity,
      utilization: tank.capacity > 0 ? Math.max(0, tankLevel) / tank.capacity : 0,
    },
    barges: bargeSnaps,
    fleetLevel,
    fleetCapacity,
    fleetRemaining: fleetCapacity - fleetLevel,
    fleetUtilization: fleetCapacity > 0 ? fleetLevel / fleetCapacity : 0,
  };
}

/**
 * Peak barge level reached at any point across the plan for a given barge — used
 * to detect capacity-exceeded conditions independent of the current snapshot.
 */
export function peakBargeLevel(
  plan: PlanState,
  bargeId: string,
  barges: Barge[],
  tank: ShoreTank,
): number {
  // Evaluate at every activity boundary — extrema of the piecewise-linear curve.
  const times = new Set<number>();
  for (const a of plan.activities) {
    times.add(iso(a.start).getTime());
    times.add(iso(a.end).getTime());
  }
  let peak = 0;
  for (const t of times) {
    const snap = computeSnapshot(plan, new Date(t), barges, tank);
    const b = snap.barges.find((x) => x.id === bargeId);
    if (b && b.level > peak) peak = b.level;
  }
  return peak;
}

/** Lowest tank level reached across the plan (for low-inventory detection). */
export function troughTankLevel(
  plan: PlanState,
  barges: Barge[],
  tank: ShoreTank,
): { level: number; at: string } {
  const times = new Set<number>();
  for (const a of plan.activities) {
    times.add(iso(a.start).getTime());
    times.add(iso(a.end).getTime());
  }
  let trough = tank.openingInventory;
  let at = new Date().toISOString();
  for (const t of times) {
    const snap = computeSnapshot(plan, new Date(t), barges, tank);
    if (snap.tank.level < trough) {
      trough = snap.tank.level;
      at = new Date(t).toISOString();
    }
  }
  return { level: trough, at };
}

/**
 * Inventory-impact preview for a prospective stem, shown before saving in the
 * New Stem modal. Compares tank & barge levels with and without the stem at the
 * moment loading completes.
 */
export function previewImpact(
  plan: PlanState,
  candidate: Stem,
  candidateActivities: Activity[],
  barges: Barge[],
  tank: ShoreTank,
): {
  atLoadingComplete: string;
  tankBefore: number;
  tankAfter: number;
  bargeBefore: number;
  bargeAfter: number;
  bargeCapacity: number;
  tankCapacity: number;
  wouldExceedBarge: boolean;
  wouldEmptyTank: boolean;
} {
  const loading = candidateActivities.find((a) => a.type === 'Loading');
  const at = loading ? iso(loading.end) : iso(candidate.windowStart);
  const barge = barges.find((b) => b.id === candidate.bargeId)!;

  const before = computeSnapshot(plan, at, barges, tank);
  const withStem: PlanState = {
    ...plan,
    stems: [...plan.stems, candidate],
    activities: [...plan.activities, ...candidateActivities],
  };
  const after = computeSnapshot(withStem, at, barges, tank);

  const bargeBeforeSnap = before.barges.find((b) => b.id === candidate.bargeId)!;
  const bargeAfterSnap = after.barges.find((b) => b.id === candidate.bargeId)!;

  return {
    atLoadingComplete: at.toISOString(),
    tankBefore: before.tank.level,
    tankAfter: after.tank.level,
    bargeBefore: bargeBeforeSnap.level,
    bargeAfter: bargeAfterSnap.level,
    bargeCapacity: barge.capacity,
    tankCapacity: tank.capacity,
    wouldExceedBarge: bargeAfterSnap.level > barge.capacity + 1e-6,
    wouldEmptyTank: after.tank.level < -1e-6 || before.tank.level - candidate.volume < 0,
  };
}
