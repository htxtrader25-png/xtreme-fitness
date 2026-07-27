import type { Activity, ActivityType, Barge, Stem, StemStatus } from '@/types';
import { ACTIVITY_ORDER } from '@/types';
import { TIMING, bargeById } from '@/lib/constants';
import { uid } from '@/lib/id';
import { addH, hoursBetween, iso } from '@/lib/time';

// ---------------------------------------------------------------------------
// Stem lifecycle: Inspection → Loading → Transit → Delivery → ReturnTransit →
// Available. Every stem generates this linked chain of activities. Moving or
// resizing any one activity recalculates all dependents (see recalcChain).
// ---------------------------------------------------------------------------

/** Compute the natural duration (hours) of each activity for a given stem. */
export function activityDurations(
  stem: Pick<Stem, 'volume' | 'bargeId'>,
): Record<ActivityType, number> {
  const barge = bargeById(stem.bargeId);
  const loadRate = barge?.loadRate ?? 900;
  const pumpRate = barge?.pumpRate ?? 700;
  return {
    Inspection: TIMING.inspectionHours,
    Loading: round2(stem.volume / loadRate),
    Transit: TIMING.transitHours,
    Delivery: round2(stem.volume / pumpRate),
    ReturnTransit: TIMING.returnTransitHours,
    Available: TIMING.availableBufferHours,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Generate the full activity chain for a stem, anchored so that Delivery begins
 * at the start of the customer delivery window. Activities are contiguous.
 */
export function generateActivities(stem: Stem): Activity[] {
  const dur = activityDurations(stem);

  // Anchor Delivery at the window start, then back- and forward-calculate.
  const deliveryStart = stem.windowStart;
  const transitStart = addH(deliveryStart, -dur.Transit);
  const loadingStart = addH(transitStart, -dur.Loading);
  const inspectionStart = addH(loadingStart, -dur.Inspection);

  const chain: Array<{ type: ActivityType; start: string }> = [
    { type: 'Inspection', start: inspectionStart },
    { type: 'Loading', start: loadingStart },
    { type: 'Transit', start: transitStart },
    { type: 'Delivery', start: deliveryStart },
    { type: 'ReturnTransit', start: addH(deliveryStart, dur.Delivery) },
    {
      type: 'Available',
      start: addH(deliveryStart, dur.Delivery + dur.ReturnTransit),
    },
  ];

  return chain.map((c) => ({
    id: uid('act'),
    stemId: stem.id,
    bargeId: stem.bargeId,
    type: c.type,
    start: c.start,
    end: addH(c.start, dur[c.type]),
  }));
}

/** Order a stem's activities by lifecycle sequence. */
export function orderChain(activities: Activity[]): Activity[] {
  return [...activities].sort(
    (a, b) => ACTIVITY_ORDER.indexOf(a.type) - ACTIVITY_ORDER.indexOf(b.type),
  );
}

/**
 * Recalculate a stem's activity chain after one activity has been moved or
 * resized. The changed activity keeps its new position/duration; every
 * dependent activity is shifted to preserve a contiguous chain.
 *
 * @param chainActivities all activities belonging to the SAME stem
 * @param changedId       id of the moved/resized activity
 * @param newStart        new start ISO of the changed activity
 * @param newEnd          new end ISO of the changed activity (for resize)
 */
export function recalcChain(
  chainActivities: Activity[],
  changedId: string,
  newStart: string,
  newEnd?: string,
): Activity[] {
  const ordered = orderChain(chainActivities);
  const idx = ordered.findIndex((a) => a.id === changedId);
  if (idx === -1) return chainActivities;

  // Preserve each activity's current duration, except the changed one which
  // may have been resized.
  const durations = ordered.map((a) => hoursBetween(a.start, a.end));
  if (newEnd) {
    durations[idx] = hoursBetween(newStart, newEnd);
  }

  const result = ordered.map((a) => ({ ...a }));
  result[idx] = {
    ...result[idx],
    start: newStart,
    end: newEnd ?? addH(newStart, durations[idx]),
  };

  // Propagate forward from the changed activity.
  for (let i = idx + 1; i < result.length; i += 1) {
    const start = result[i - 1].end;
    result[i] = { ...result[i], start, end: addH(start, durations[i]) };
  }

  // Propagate backward from the changed activity.
  for (let i = idx - 1; i >= 0; i -= 1) {
    const end = result[i + 1].start;
    result[i] = { ...result[i], end, start: addH(end, -durations[i]) };
  }

  return result;
}

/**
 * When a stem is reassigned to a different barge, move all of its activities to
 * the new barge (and refresh loading/delivery durations for that barge's rates).
 */
export function reassignStemBarge(
  chainActivities: Activity[],
  stem: Stem,
  newBarge: Barge,
): Activity[] {
  const dur = activityDurations({ volume: stem.volume, bargeId: newBarge.id });
  const ordered = orderChain(chainActivities);
  // Keep the Delivery anchor stable; rebuild durations for new barge.
  const delivery = ordered.find((a) => a.type === 'Delivery');
  const deliveryStart = delivery ? delivery.start : stem.windowStart;

  const transitStart = addH(deliveryStart, -dur.Transit);
  const loadingStart = addH(transitStart, -dur.Loading);
  const inspectionStart = addH(loadingStart, -dur.Inspection);
  const starts: Record<ActivityType, string> = {
    Inspection: inspectionStart,
    Loading: loadingStart,
    Transit: transitStart,
    Delivery: deliveryStart,
    ReturnTransit: addH(deliveryStart, dur.Delivery),
    Available: addH(deliveryStart, dur.Delivery + dur.ReturnTransit),
  };

  return ordered.map((a) => ({
    ...a,
    bargeId: newBarge.id,
    start: starts[a.type],
    end: addH(starts[a.type], dur[a.type]),
  }));
}

/** Derive a stem's current status from its activities relative to `now`. */
export function deriveStemStatus(
  activities: Activity[],
  now: Date,
): StemStatus {
  const ordered = orderChain(activities);
  const t = now.getTime();
  const last = ordered[ordered.length - 1];
  if (last && iso(last.end).getTime() <= t) return 'completed';

  for (const a of ordered) {
    if (t >= iso(a.start).getTime() && t < iso(a.end).getTime()) {
      switch (a.type) {
        case 'Inspection':
          return 'inspecting';
        case 'Loading':
          return 'loading';
        case 'Transit':
          return 'in-transit';
        case 'Delivery':
          return 'delivering';
        case 'ReturnTransit':
          return 'returning';
        case 'Available':
          return 'completed';
      }
    }
  }
  return 'planned';
}

/** Full span (start of first, end of last) for a stem chain. */
export function chainSpan(activities: Activity[]): { start: string; end: string } | null {
  if (activities.length === 0) return null;
  const ordered = orderChain(activities);
  return { start: ordered[0].start, end: ordered[ordered.length - 1].end };
}
