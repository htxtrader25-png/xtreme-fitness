import type {
  Activity,
  Barge,
  Conflict,
  PlanState,
  ShoreTank,
} from '@/types';
import { THRESHOLDS, TIMING, bargeById } from '@/lib/constants';
import { uid } from '@/lib/id';
import { fmtDateTime, hoursBetween, intervalsOverlap, iso } from '@/lib/time';
import { orderChain } from './activities';
import { peakBargeLevel, troughTankLevel } from './inventory';

// ---------------------------------------------------------------------------
// Constraint & conflict engine. Detects:
//   • overlap             — two activities collide on the same barge
//   • low-inventory       — shore tank dips below the low threshold
//   • capacity-exceeded   — a barge would carry more than its capacity
//   • window-violation    — delivery falls outside the stem's laycan window
//   • maintenance-conflict— an activity overlaps a maintenance block
//   • impossible-transit  — a transit leg is physically too short
// ---------------------------------------------------------------------------

export function detectConflicts(
  plan: PlanState,
  barges: Barge[],
  tank: ShoreTank,
): Conflict[] {
  const conflicts: Conflict[] = [];
  conflicts.push(...detectOverlaps(plan, barges));
  conflicts.push(...detectCapacity(plan, barges, tank));
  conflicts.push(...detectLowInventory(plan, barges, tank));
  conflicts.push(...detectWindowViolations(plan));
  conflicts.push(...detectMaintenanceConflicts(plan));
  conflicts.push(...detectImpossibleTransit(plan));
  return conflicts;
}

function detectOverlaps(plan: PlanState, _barges: Barge[]): Conflict[] {
  const out: Conflict[] = [];
  const byBarge = groupByBarge(plan.activities);
  for (const [bargeId, acts] of byBarge) {
    const sorted = [...acts].sort(
      (a, b) => iso(a.start).getTime() - iso(b.start).getTime(),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i];
        const b = sorted[j];
        // Different stems only (within-stem activities are contiguous by design).
        if (a.stemId === b.stemId) continue;
        if (iso(b.start).getTime() >= iso(a.end).getTime()) break;
        if (intervalsOverlap(a.start, a.end, b.start, b.end)) {
          out.push({
            id: uid('cf'),
            type: 'overlap',
            severity: 'critical',
            bargeId,
            activityIds: [a.id, b.id],
            at: b.start,
            message: `${bargeById(bargeId)?.name ?? bargeId}: ${a.type} and ${b.type} overlap at ${fmtDateTime(b.start)}.`,
            suggestion:
              'Shift one stem later, or reassign it to another barge to remove the overlap.',
          });
        }
      }
    }
  }
  return out;
}

function detectCapacity(
  plan: PlanState,
  barges: Barge[],
  tank: ShoreTank,
): Conflict[] {
  const out: Conflict[] = [];
  for (const b of barges) {
    const peak = peakBargeLevel(plan, b.id, barges, tank);
    if (peak > b.capacity + 1) {
      out.push({
        id: uid('cf'),
        type: 'capacity-exceeded',
        severity: 'critical',
        bargeId: b.id,
        activityIds: plan.activities
          .filter((a) => a.bargeId === b.id && a.type === 'Loading')
          .map((a) => a.id),
        message: `${b.name} peaks at ${Math.round(peak).toLocaleString()} m³, exceeding its ${b.capacity.toLocaleString()} m³ capacity.`,
        suggestion:
          'Reduce a stem volume, split the delivery, or move a concurrent stem to another barge.',
      });
    }
  }
  return out;
}

function detectLowInventory(
  plan: PlanState,
  barges: Barge[],
  tank: ShoreTank,
): Conflict[] {
  const out: Conflict[] = [];
  const { level, at } = troughTankLevel(plan, barges, tank);
  const lowLine = tank.capacity * THRESHOLDS.tankLowFraction;
  if (level < 0) {
    out.push({
      id: uid('cf'),
      type: 'low-inventory',
      severity: 'critical',
      activityIds: [],
      at,
      message: `${tank.name} is oversubscribed — projected to run dry (${Math.round(level).toLocaleString()} m³) around ${fmtDateTime(at)}.`,
      suggestion: 'Schedule a tank replenishment or defer a loading before this time.',
    });
  } else if (level < lowLine) {
    out.push({
      id: uid('cf'),
      type: 'low-inventory',
      severity: 'warning',
      activityIds: [],
      at,
      message: `${tank.name} dips to ${Math.round(level).toLocaleString()} m³ (below ${Math.round(lowLine).toLocaleString()} m³ low line) around ${fmtDateTime(at)}.`,
      suggestion: 'Plan a replenishment to keep the tank above the low-inventory threshold.',
    });
  }
  return out;
}

function detectWindowViolations(plan: PlanState): Conflict[] {
  const out: Conflict[] = [];
  for (const stem of plan.stems) {
    const delivery = plan.activities.find(
      (a) => a.stemId === stem.id && a.type === 'Delivery',
    );
    if (!delivery) continue;
    const startsBefore = iso(delivery.start).getTime() < iso(stem.windowStart).getTime();
    const endsAfter = iso(delivery.end).getTime() > iso(stem.windowEnd).getTime();
    if (startsBefore || endsAfter) {
      out.push({
        id: uid('cf'),
        type: 'window-violation',
        severity: 'warning',
        stemId: stem.id,
        bargeId: stem.bargeId,
        activityIds: [delivery.id],
        at: delivery.start,
        message: `${stem.ref} (${stem.customer}) delivery ${fmtDateTime(delivery.start)}–${fmtDateTime(delivery.end)} falls outside its window ${fmtDateTime(stem.windowStart)}–${fmtDateTime(stem.windowEnd)}.`,
        suggestion: startsBefore
          ? 'Delay loading so delivery starts within the agreed laycan.'
          : 'Bring the schedule forward or extend the window with the customer.',
      });
    }
  }
  return out;
}

function detectMaintenanceConflicts(plan: PlanState): Conflict[] {
  const out: Conflict[] = [];
  for (const m of plan.maintenance) {
    for (const a of plan.activities) {
      if (a.bargeId !== m.bargeId) continue;
      if (intervalsOverlap(a.start, a.end, m.start, m.end)) {
        out.push({
          id: uid('cf'),
          type: 'maintenance-conflict',
          severity: 'critical',
          bargeId: m.bargeId,
          stemId: a.stemId,
          activityIds: [a.id],
          at: a.start,
          message: `${bargeById(m.bargeId)?.name ?? m.bargeId}: ${a.type} overlaps maintenance (${m.reason}) ${fmtDateTime(m.start)}–${fmtDateTime(m.end)}.`,
          suggestion: 'Reschedule the stem around the maintenance window or use another barge.',
        });
      }
    }
  }
  return out;
}

function detectImpossibleTransit(plan: PlanState): Conflict[] {
  const out: Conflict[] = [];
  for (const stem of plan.stems) {
    const chain = orderChain(
      plan.activities.filter((a) => a.stemId === stem.id),
    );
    for (const a of chain) {
      if (a.type !== 'Transit' && a.type !== 'ReturnTransit') continue;
      const dur = hoursBetween(a.start, a.end);
      if (dur < TIMING.minTransitHours) {
        out.push({
          id: uid('cf'),
          type: 'impossible-transit',
          severity: 'critical',
          stemId: stem.id,
          bargeId: stem.bargeId,
          activityIds: [a.id],
          at: a.start,
          message: `${stem.ref}: ${a.type} compressed to ${dur.toFixed(1)}h — below the ${TIMING.minTransitHours}h minimum sailing time.`,
          suggestion: 'Give the transit leg realistic duration; the barge cannot sail that fast.',
        });
      }
      if (iso(a.end).getTime() <= iso(a.start).getTime()) {
        out.push({
          id: uid('cf'),
          type: 'impossible-transit',
          severity: 'critical',
          stemId: stem.id,
          bargeId: stem.bargeId,
          activityIds: [a.id],
          at: a.start,
          message: `${stem.ref}: ${a.type} has zero or negative duration.`,
          suggestion: 'Reset the activity to a positive duration.',
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

function groupByBarge(activities: Activity[]): Map<string, Activity[]> {
  const m = new Map<string, Activity[]>();
  for (const a of activities) {
    const list = m.get(a.bargeId) ?? [];
    list.push(a);
    m.set(a.bargeId, list);
  }
  return m;
}

/** Set of activity ids that participate in any conflict (for highlighting). */
export function conflictedActivityIds(conflicts: Conflict[]): Set<string> {
  const s = new Set<string>();
  for (const c of conflicts) for (const id of c.activityIds) s.add(id);
  return s;
}
