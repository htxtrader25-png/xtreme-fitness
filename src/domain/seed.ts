import type { Activity, MaintenanceBlock, PlanState, Stem } from '@/types';
import { generateActivities } from './activities';
import { addH } from '@/lib/time';
import { stemRef, uid } from '@/lib/id';

// ---------------------------------------------------------------------------
// Seed plan. Anchored to the start of the current day so the scheduler always
// opens on a populated, "live" timeline with the current-time indicator in view.
// ---------------------------------------------------------------------------

interface SeedSpec {
  customer: string;
  vessel: string;
  product: Stem['product'];
  volume: number;
  bargeId: string;
  priority: Stem['priority'];
  /** Hours after today-midnight for the delivery window start. */
  windowStartH: number;
  /** Window length in hours. */
  windowLenH: number;
  notes: string;
}

// Delivery windows are spaced per barge so the seed opens as a clean, feasible
// plan (no conflicts). One maintenance block sits in an Atlas gap. Editing,
// dragging, or adding stems is what surfaces conflicts — the demo starts green.
const SEEDS: SeedSpec[] = [
  { customer: 'Maersk Line', vessel: 'Maersk Halifax', product: 'VLSFO', volume: 2400, bargeId: 'atlas', priority: 'high', windowStartH: 6, windowLenH: 5, notes: 'Berth 4 — pilot booked 05:30.' },
  { customer: 'MSC', vessel: 'MSC Gaia', product: 'VLSFO', volume: 5200, bargeId: 'titan', priority: 'critical', windowStartH: 9, windowLenH: 8, notes: 'Large stem, tight laycan — do not slip.' },
  { customer: 'CMA CGM', vessel: 'CMA CGM Jacques', product: 'MGO', volume: 900, bargeId: 'orion', priority: 'normal', windowStartH: 8, windowLenH: 4, notes: 'Small parcel, meter witness required.' },
  { customer: 'Stena Bulk', vessel: 'Stena Impero', product: 'LSMGO', volume: 1100, bargeId: 'orion', priority: 'low', windowStartH: 18, windowLenH: 4, notes: 'Anchorage delivery.' },
  { customer: 'Hapag-Lloyd', vessel: 'Hamburg Express', product: 'HSFO', volume: 1600, bargeId: 'atlas', priority: 'normal', windowStartH: 20, windowLenH: 4, notes: 'Scrubber vessel.' },
  { customer: 'Frontline', vessel: 'Front Altair', product: 'VLSFO', volume: 3600, bargeId: 'titan', priority: 'high', windowStartH: 26, windowLenH: 6, notes: 'VLCC top-up (next morning laycan).' },
];

export function todayMidnightISO(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function buildSeedPlan(now = new Date()): PlanState {
  const base = todayMidnightISO(now);
  const stems: Stem[] = [];
  const activities: Activity[] = [];

  SEEDS.forEach((spec, i) => {
    const windowStart = addH(base, spec.windowStartH);
    const windowEnd = addH(windowStart, spec.windowLenH);
    const stem: Stem = {
      id: uid('stem'),
      ref: stemRef(i),
      customer: spec.customer,
      vessel: spec.vessel,
      product: spec.product,
      volume: spec.volume,
      windowStart,
      windowEnd,
      priority: spec.priority,
      bargeId: spec.bargeId,
      notes: spec.notes,
      createdAt: base,
      status: 'planned',
    };
    stems.push(stem);
    activities.push(...generateActivities(stem));
  });

  const maintenance: MaintenanceBlock[] = [
    {
      id: uid('mnt'),
      bargeId: 'atlas',
      start: addH(base, 13),
      end: addH(base, 14.5),
      reason: 'Bunker meter calibration',
    },
  ];

  return { stems, activities, maintenance };
}
