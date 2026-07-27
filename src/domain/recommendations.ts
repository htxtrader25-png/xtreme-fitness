import type {
  Barge,
  Conflict,
  PlanState,
  Recommendation,
  ShoreTank,
} from '@/types';
import { THRESHOLDS } from '@/lib/constants';
import { uid } from '@/lib/id';
import { fmtDateTime } from '@/lib/time';
import { computeSnapshot } from './inventory';
import { computeUtilization } from './optimization';

// ---------------------------------------------------------------------------
// AI recommendation engine (rule-based decision support).
// Produces always-on, reasoned recommendations across five categories:
//   barge-assignment, inventory-risk, conflict-resolution, commercial-impact,
//   utilization. Every recommendation includes explicit reasoning.
// ---------------------------------------------------------------------------

export function generateRecommendations(
  plan: PlanState,
  conflicts: Conflict[],
  barges: Barge[],
  tank: ShoreTank,
  now: Date,
): Recommendation[] {
  const out: Recommendation[] = [];

  out.push(...bargeAssignmentRecs(plan, barges, tank));
  out.push(...inventoryRiskRecs(plan, barges, tank, now));
  out.push(...conflictResolutionRecs(conflicts));
  out.push(...commercialImpactRecs(plan));
  out.push(...utilizationRecs(plan, barges));

  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// --- Best barge assignment --------------------------------------------------

function bargeAssignmentRecs(
  plan: PlanState,
  barges: Barge[],
  _tank: ShoreTank,
): Recommendation[] {
  const out: Recommendation[] = [];
  const util = computeUtilization(plan, barges);
  const byId = new Map(util.perBarge.map((u) => [u.bargeId, u]));

  for (const stem of plan.stems) {
    const assigned = barges.find((b) => b.id === stem.bargeId);
    if (!assigned) continue;

    // Ideal barge: smallest capacity that comfortably fits the volume and is
    // less utilized than the current assignment.
    const fits = barges
      .filter((b) => b.capacity >= stem.volume)
      .sort((a, b) => a.capacity - b.capacity);
    const best = fits[0];
    if (!best) {
      out.push({
        id: uid('rec'),
        category: 'barge-assignment',
        severity: 'critical',
        title: `${stem.ref}: no barge fits ${stem.volume.toLocaleString()} m³`,
        reasoning: `The ordered volume exceeds every barge's capacity. Split ${stem.ref} into multiple stems or renegotiate the volume.`,
        stemId: stem.id,
      });
      continue;
    }

    const assignedUtil = byId.get(assigned.id)?.utilization ?? 0;
    const bestUtil = byId.get(best.id)?.utilization ?? 0;
    // Recommend a change only when there is a materially better fit.
    if (best.id !== assigned.id && (assigned.capacity - stem.volume) / assigned.capacity > 0.55 && bestUtil <= assignedUtil + 0.05) {
      out.push({
        id: uid('rec'),
        category: 'barge-assignment',
        severity: 'info',
        title: `${stem.ref}: better fit on ${best.name}`,
        reasoning: `${stem.ref} (${stem.volume.toLocaleString()} m³) is on ${assigned.name} (${assigned.capacity.toLocaleString()} m³ — heavily oversized). ${best.name} (${best.capacity.toLocaleString()} m³) fits the parcel more tightly and is ${pct(bestUtil)} utilized, keeping ${assigned.name} free for larger parcels.`,
        action: {
          label: `Reassign to ${best.name}`,
          kind: 'reassign-barge',
          stemId: stem.id,
          toBargeId: best.id,
        },
        stemId: stem.id,
      });
    }
  }
  return out.slice(0, 3);
}

// --- Inventory risk ---------------------------------------------------------

function inventoryRiskRecs(
  plan: PlanState,
  barges: Barge[],
  tank: ShoreTank,
  now: Date,
): Recommendation[] {
  const out: Recommendation[] = [];
  const snap = computeSnapshot(plan, now, barges, tank);
  const lowLine = tank.capacity * THRESHOLDS.tankLowFraction;

  if (snap.tank.level < lowLine) {
    out.push({
      id: uid('rec'),
      category: 'inventory-risk',
      severity: snap.tank.level <= 0 ? 'critical' : 'warning',
      title: `${tank.name} low: ${Math.round(snap.tank.level).toLocaleString()} m³`,
      reasoning: `Current shore inventory is ${pct(snap.tank.utilization)} of capacity, below the ${pct(THRESHOLDS.tankLowFraction)} low line. Loadings scheduled after now risk drawing the tank dry — arrange a replenishment or resequence loadings to protect committed deliveries.`,
    });
  }

  for (const b of snap.barges) {
    if (b.utilization >= THRESHOLDS.bargeHighFraction) {
      out.push({
        id: uid('rec'),
        category: 'inventory-risk',
        severity: 'warning',
        title: `${b.name} near capacity (${pct(b.utilization)})`,
        reasoning: `${b.name} is carrying ${Math.round(b.level).toLocaleString()} of ${b.capacity.toLocaleString()} m³. There is little headroom for an additional stem before its next delivery discharges cargo.`,
      });
    }
  }
  return out;
}

// --- Conflict resolution ----------------------------------------------------

function conflictResolutionRecs(conflicts: Conflict[]): Recommendation[] {
  return conflicts
    .filter((c) => c.severity === 'critical')
    .slice(0, 3)
    .map((c) => ({
      id: uid('rec'),
      category: 'conflict-resolution' as const,
      severity: c.severity,
      title: `Resolve: ${c.type.replace(/-/g, ' ')}`,
      reasoning: `${c.message} ${c.suggestion ?? ''}`.trim(),
      stemId: c.stemId,
      action: {
        label: 'Focus on timeline',
        kind: 'resolve-conflict' as const,
        stemId: c.stemId,
      },
    }));
}

// --- Commercial impact ------------------------------------------------------

function commercialImpactRecs(plan: PlanState): Recommendation[] {
  const out: Recommendation[] = [];
  const critical = plan.stems.filter((s) => s.priority === 'critical');
  const highValue = [...plan.stems].sort((a, b) => b.volume - a.volume)[0];

  if (critical.length > 0) {
    out.push({
      id: uid('rec'),
      category: 'commercial-impact',
      severity: 'warning',
      title: `${critical.length} critical-priority stem${critical.length > 1 ? 's' : ''} in play`,
      reasoning: `Critical stems (${critical.map((s) => s.ref).join(', ')}) carry the highest commercial and relationship risk. Protect their windows first: they should be first to keep their slots when resolving any conflict or optimization trade-off.`,
      stemId: critical[0].id,
    });
  }
  if (highValue) {
    out.push({
      id: uid('rec'),
      category: 'commercial-impact',
      severity: 'info',
      title: `Largest parcel: ${highValue.ref} (${highValue.volume.toLocaleString()} m³)`,
      reasoning: `${highValue.customer}'s ${highValue.volume.toLocaleString()} m³ ${highValue.product} stem is the largest scheduled parcel and the biggest single revenue event. A slip on its window (${fmtDateTime(highValue.windowStart)}) has outsized commercial impact — prioritize its loading sequence.`,
      stemId: highValue.id,
    });
  }
  return out;
}

// --- Utilization ------------------------------------------------------------

function utilizationRecs(plan: PlanState, barges: Barge[]): Recommendation[] {
  const util = computeUtilization(plan, barges);
  const target = THRESHOLDS.fleetUtilizationTarget;
  if (util.fleetUtilization >= target) return [];
  const gapPp = Math.round((target - util.fleetUtilization) * 100);
  const idlest = [...util.perBarge].sort((a, b) => b.idleHours - a.idleHours)[0];
  return [
    {
      id: uid('rec'),
      category: 'utilization',
      severity: 'info',
      title: `Fleet ${pct(util.fleetUtilization)} vs ${pct(target)} target`,
      reasoning: `Fleet utilization is ${gapPp} points below target with ${util.totalIdleHours}h of idle time — ${idlest?.name} alone is idle ${idlest?.idleHours ?? 0}h. Consolidating trips or pulling forward queued stems would lift utilization toward target and improve barge productivity.`,
    },
  ];
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;
