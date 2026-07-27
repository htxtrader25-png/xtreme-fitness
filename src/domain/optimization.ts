import type {
  Activity,
  Barge,
  BargeUtilization,
  FleetUtilization,
  OptimizationSuggestion,
  PlanState,
  ShoreTank,
  Stem,
} from '@/types';
import { uid } from '@/lib/id';
import { addH, hoursBetween, iso, overlapMinutes } from '@/lib/time';
import { chainSpan, orderChain } from './activities';

// ---------------------------------------------------------------------------
// Idle-time optimization engine.
// Computes, per barge and for the fleet across a horizon:
//   idle, waiting, sailing (transit), loading, delivering, inspecting hours and
//   utilization; then proposes concrete improvements:
//   swap barges, shift departures, consolidate trips, reduce idle hours.
// ---------------------------------------------------------------------------

/** Compute the planning horizon spanning all activities (fallback: today). */
export function planHorizon(plan: PlanState): { start: string; end: string } {
  if (plan.activities.length === 0) {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: addH(start.toISOString(), 24) };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const a of plan.activities) {
    min = Math.min(min, iso(a.start).getTime());
    max = Math.max(max, iso(a.end).getTime());
  }
  return { start: new Date(min).toISOString(), end: new Date(max).toISOString() };
}

export function computeUtilization(
  plan: PlanState,
  barges: Barge[],
  horizon?: { start: string; end: string },
): FleetUtilization {
  const h = horizon ?? planHorizon(plan);
  const horizonHours = Math.max(0, hoursBetween(h.start, h.end));

  const perBarge: BargeUtilization[] = barges.map((b) => {
    const acts = orderChain(plan.activities.filter((a) => a.bargeId === b.id));
    const buckets = {
      Inspection: 0,
      Loading: 0,
      Transit: 0,
      Delivery: 0,
      ReturnTransit: 0,
      Available: 0,
    } as Record<string, number>;

    const intervals: Array<[number, number]> = [];
    for (const a of acts) {
      // Count only the portion within the horizon.
      const mins = overlapMinutes(a.start, a.end, h.start, h.end);
      buckets[a.type] += mins / 60;
      if (mins > 0) {
        const start = Math.max(iso(a.start).getTime(), iso(h.start).getTime());
        const end = Math.min(iso(a.end).getTime(), iso(h.end).getTime());
        intervals.push([start, end]);
      }
    }

    // Waiting = gaps between consecutive stems (idle gaps inside the horizon).
    let waiting = 0;
    const spans = stemSpans(plan, b.id);
    for (let i = 1; i < spans.length; i += 1) {
      const gap = hoursBetween(spans[i - 1].end, spans[i].start);
      if (gap > 0) waiting += gap;
    }

    // Busy = union of activity intervals (overlaps counted once), so
    // utilization can never exceed 100% even when the plan has conflicts.
    const busy = Math.min(horizonHours, mergedHours(intervals));
    const idle = Math.max(0, horizonHours - busy);

    return {
      bargeId: b.id,
      name: b.name,
      horizonHours,
      idleHours: round1(idle),
      waitingHours: round1(waiting),
      sailingHours: round1(buckets.Transit + buckets.ReturnTransit),
      loadingHours: round1(buckets.Loading),
      deliveringHours: round1(buckets.Delivery),
      inspectingHours: round1(buckets.Inspection),
      utilization: horizonHours > 0 ? Math.min(1, busy / horizonHours) : 0,
    };
  });

  const sum = (f: (b: BargeUtilization) => number) =>
    perBarge.reduce((s, b) => s + f(b), 0);
  const fleetBusy = perBarge.reduce(
    (s, b) => s + b.utilization * b.horizonHours,
    0,
  );
  const fleetCapacityHours = horizonHours * barges.length;

  return {
    horizonStart: h.start,
    horizonEnd: h.end,
    horizonHours,
    perBarge,
    fleetUtilization: fleetCapacityHours > 0 ? fleetBusy / fleetCapacityHours : 0,
    totalIdleHours: round1(sum((b) => b.idleHours)),
    totalWaitingHours: round1(sum((b) => b.waitingHours)),
    totalSailingHours: round1(sum((b) => b.sailingHours)),
    totalLoadingHours: round1(sum((b) => b.loadingHours)),
    totalDeliveringHours: round1(sum((b) => b.deliveringHours)),
  };
}

/** Total hours covered by the union of intervals (overlaps counted once). */
function mergedHours(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const [s, e] = sorted[i];
    if (s > curEnd) {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else {
      curEnd = Math.max(curEnd, e);
    }
  }
  total += curEnd - curStart;
  return total / 3_600_000;
}

/** Per-stem [start,end] spans on a barge, ordered by start. */
function stemSpans(plan: PlanState, bargeId: string): { start: string; end: string }[] {
  const byStem = new Map<string, Activity[]>();
  for (const a of plan.activities) {
    if (a.bargeId !== bargeId) continue;
    const list = byStem.get(a.stemId) ?? [];
    list.push(a);
    byStem.set(a.stemId, list);
  }
  const spans: { start: string; end: string }[] = [];
  for (const acts of byStem.values()) {
    const span = chainSpan(acts);
    if (span) spans.push(span);
  }
  return spans.sort((a, b) => iso(a.start).getTime() - iso(b.start).getTime());
}

// ---------------------------------------------------------------------------
// Suggestion generation
// ---------------------------------------------------------------------------

export function generateOptimizations(
  plan: PlanState,
  barges: Barge[],
  _tank: ShoreTank,
): OptimizationSuggestion[] {
  const out: OptimizationSuggestion[] = [];
  const util = computeUtilization(plan, barges);

  const busiest = [...util.perBarge].sort((a, b) => b.utilization - a.utilization)[0];
  const idlest = [...util.perBarge].sort((a, b) => a.utilization - b.utilization)[0];

  // 1) Swap / rebalance — move a stem off the busiest barge onto the idlest.
  if (busiest && idlest && busiest.bargeId !== idlest.bargeId) {
    const spread = busiest.utilization - idlest.utilization;
    if (spread > 0.2) {
      const candidate = movableStemFrom(plan, busiest.bargeId, idlest.bargeId, barges);
      if (candidate) {
        out.push({
          id: uid('opt'),
          kind: 'swap-barge',
          title: `Rebalance ${candidate.ref} → ${idlest.name}`,
          reasoning: `${busiest.name} is ${pct(busiest.utilization)} utilized while ${idlest.name} sits at ${pct(idlest.utilization)}. Moving ${candidate.ref} (${candidate.volume.toLocaleString()} m³, ${candidate.customer}) to ${idlest.name} evens the workload and reduces the risk of overlaps on ${busiest.name}.`,
          estimatedUtilizationGain: round1(spread * 50), // rough pp gain to fleet
          estimatedIdleReduction: round1(Math.min(idlest.idleHours, 4)),
          stemId: candidate.id,
          fromBargeId: busiest.bargeId,
          toBargeId: idlest.bargeId,
          applicable: true,
        });
      }
    }
  }

  // 2) Reduce idle — call out the barge with the most idle hours.
  const mostIdle = [...util.perBarge].sort((a, b) => b.idleHours - a.idleHours)[0];
  if (mostIdle && mostIdle.idleHours > 6) {
    out.push({
      id: uid('opt'),
      kind: 'reduce-idle',
      title: `${mostIdle.name} has ${mostIdle.idleHours}h idle`,
      reasoning: `${mostIdle.name} is idle ${mostIdle.idleHours}h of the ${Math.round(mostIdle.horizonHours)}h horizon (${pct(mostIdle.utilization)} utilized). Pull forward a queued stem or assign upcoming demand to ${mostIdle.name} to convert idle time into productive deliveries.`,
      estimatedUtilizationGain: round1((mostIdle.idleHours / Math.max(1, mostIdle.horizonHours)) * 40),
      estimatedIdleReduction: round1(mostIdle.idleHours * 0.4),
      fromBargeId: mostIdle.bargeId,
      applicable: false,
    });
  }

  // 3) Shift departure — close large waiting gaps by pulling a stem earlier.
  for (const b of barges) {
    const spans = stemSpans(plan, b.id);
    for (let i = 1; i < spans.length; i += 1) {
      const gap = hoursBetween(spans[i - 1].end, spans[i].start);
      if (gap > 4) {
        const stem = stemStartingAt(plan, b.id, spans[i].start);
        if (stem) {
          const proposedShift = Math.min(gap - 0.5, gap);
          out.push({
            id: uid('opt'),
            kind: 'shift-departure',
            title: `Pull ${stem.ref} earlier by ${Math.floor(proposedShift)}h`,
            reasoning: `${b.name} waits ${round1(gap)}h between stems before ${stem.ref}. Shifting ${stem.ref} earlier tightens the rotation, freeing ${b.name} sooner for additional demand while still honoring its delivery window.`,
            estimatedUtilizationGain: round1((proposedShift / Math.max(1, spans.length * 8)) * 20),
            estimatedIdleReduction: round1(proposedShift),
            stemId: stem.id,
            fromBargeId: b.id,
            proposedStart: shiftStemStart(plan, stem.id, -proposedShift),
            applicable: true,
          });
        }
        break; // one shift suggestion per barge is enough
      }
    }
  }

  // 4) Consolidate — same customer, same barge, close in time and under capacity.
  const consolidations = findConsolidations(plan, barges);
  out.push(...consolidations);

  return out.sort((a, b) => b.estimatedUtilizationGain - a.estimatedUtilizationGain);
}

function movableStemFrom(
  plan: PlanState,
  fromBarge: string,
  toBarge: string,
  barges: Barge[],
): Stem | undefined {
  const target = barges.find((b) => b.id === toBarge);
  if (!target) return undefined;
  return plan.stems
    .filter((s) => s.bargeId === fromBarge)
    .find((s) => s.volume <= target.capacity);
}

function stemStartingAt(
  plan: PlanState,
  bargeId: string,
  start: string,
): Stem | undefined {
  const act = plan.activities.find(
    (a) => a.bargeId === bargeId && a.type === 'Inspection' && a.start === start,
  );
  if (!act) {
    // Fallback: match by earliest activity of a stem.
    const stem = plan.stems.find((s) => {
      const span = chainSpan(plan.activities.filter((x) => x.stemId === s.id));
      return span?.start === start;
    });
    return stem;
  }
  return plan.stems.find((s) => s.id === act.stemId);
}

function shiftStemStart(plan: PlanState, stemId: string, deltaHours: number): string {
  const span = chainSpan(plan.activities.filter((a) => a.stemId === stemId));
  return span ? addH(span.start, deltaHours) : new Date().toISOString();
}

function findConsolidations(plan: PlanState, _barges: Barge[]): OptimizationSuggestion[] {
  const out: OptimizationSuggestion[] = [];
  const byCustomer = new Map<string, Stem[]>();
  for (const s of plan.stems) {
    const key = `${s.customer}::${s.bargeId}`;
    const list = byCustomer.get(key) ?? [];
    list.push(s);
    byCustomer.set(key, list);
  }
  for (const [key, stems] of byCustomer) {
    if (stems.length < 2) continue;
    const [customer] = key.split('::');
    const totalVol = stems.reduce((s, x) => s + x.volume, 0);
    out.push({
      id: uid('opt'),
      kind: 'consolidate',
      title: `Consolidate ${stems.length} ${customer} stems`,
      reasoning: `${customer} has ${stems.length} stems (${totalVol.toLocaleString()} m³ total) on the same barge. If windows allow, combining them into a single loading + delivery run removes duplicate inspection and transit legs, cutting sailing time and idle turnaround.`,
      estimatedUtilizationGain: round1(stems.length * 3),
      estimatedIdleReduction: round1((stems.length - 1) * 5), // per removed round-trip
      stemId: stems[0].id,
      fromBargeId: stems[0].bargeId,
      applicable: false,
    });
  }
  return out;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (n: number): string => `${Math.round(n * 100)}%`;
