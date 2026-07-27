import { isValid, parseISO } from 'date-fns';
import type {
  Activity,
  ActivityType,
  MaintenanceBlock,
  PlanState,
  Priority,
  ProductId,
  Stem,
  StemStatus,
} from '@/types';
import { ACTIVITY_ORDER } from '@/types';
import { BARGES, PRODUCTS, SHORE_TANK } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Enterprise integration adapters.
//
// The MVP persists to localStorage. This module provides the migration surface
// for future ERP / terminal / PostgreSQL integrations by exposing a stable,
// versioned export/import envelope. A real adapter would POST this envelope to
// an ERP endpoint or stream it over WebSockets; here we export/import JSON.
// ---------------------------------------------------------------------------

export interface PlanEnvelope {
  format: 'houston-bunker-fleet-scheduler';
  version: 1;
  exportedAt: string;
  fleet: { barges: typeof BARGES; tank: typeof SHORE_TANK };
  plan: PlanState;
}

export function exportPlan(plan: PlanState, exportedAt: string): PlanEnvelope {
  return {
    format: 'houston-bunker-fleet-scheduler',
    version: 1,
    exportedAt,
    fleet: { barges: BARGES, tank: SHORE_TANK },
    plan,
  };
}

export function serializePlan(plan: PlanState, exportedAt: string): string {
  return JSON.stringify(exportPlan(plan, exportedAt), null, 2);
}

// --- Import validation ------------------------------------------------------
// Imported files are untrusted input. Even though every downstream consumer
// renders through React/DayPilot escaping (so there is no injection sink), we
// validate the envelope field-by-field so a malformed or hostile file cannot
// seed invalid dates/types into the store and corrupt the running plan. Unknown
// keys are ignored; malformed child records are dropped; a fundamentally
// invalid envelope is rejected with a clear error.

const VALID_BARGE_IDS = new Set(BARGES.map((b) => b.id));
const VALID_PRODUCT_IDS = new Set(PRODUCTS.map((p) => p.id));
const VALID_ACTIVITY_TYPES = new Set<string>(ACTIVITY_ORDER);
const VALID_PRIORITIES = new Set<Priority>(['low', 'normal', 'high', 'critical']);
const VALID_STATUSES = new Set<StemStatus>([
  'planned',
  'inspecting',
  'loading',
  'in-transit',
  'delivering',
  'returning',
  'completed',
]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isIsoDate = (v: unknown): v is string => isStr(v) && isValid(parseISO(v));
const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function validateStem(v: unknown): Stem | null {
  if (!isObj(v)) return null;
  if (
    !isStr(v.id) ||
    !isStr(v.ref) ||
    !isStr(v.customer) ||
    !isStr(v.vessel) ||
    !isStr(v.product) ||
    !VALID_PRODUCT_IDS.has(v.product as ProductId) ||
    !isFiniteNum(v.volume) ||
    v.volume <= 0 ||
    !isIsoDate(v.windowStart) ||
    !isIsoDate(v.windowEnd) ||
    !isStr(v.priority) ||
    !VALID_PRIORITIES.has(v.priority as Priority) ||
    !isStr(v.bargeId) ||
    !VALID_BARGE_IDS.has(v.bargeId)
  ) {
    return null;
  }
  return {
    id: v.id,
    ref: v.ref,
    customer: v.customer,
    vessel: v.vessel,
    product: v.product as ProductId,
    volume: v.volume,
    windowStart: v.windowStart,
    windowEnd: v.windowEnd,
    priority: v.priority as Priority,
    bargeId: v.bargeId,
    notes: isStr(v.notes) ? v.notes : '',
    createdAt: isIsoDate(v.createdAt) ? v.createdAt : new Date().toISOString(),
    status: VALID_STATUSES.has(v.status as StemStatus)
      ? (v.status as StemStatus)
      : 'planned',
  };
}

function validateActivity(v: unknown, stemIds: Set<string>): Activity | null {
  if (!isObj(v)) return null;
  if (
    !isStr(v.id) ||
    !isStr(v.stemId) ||
    !stemIds.has(v.stemId) ||
    !isStr(v.bargeId) ||
    !VALID_BARGE_IDS.has(v.bargeId) ||
    !isStr(v.type) ||
    !VALID_ACTIVITY_TYPES.has(v.type) ||
    !isIsoDate(v.start) ||
    !isIsoDate(v.end)
  ) {
    return null;
  }
  return {
    id: v.id,
    stemId: v.stemId,
    bargeId: v.bargeId,
    type: v.type as ActivityType,
    start: v.start,
    end: v.end,
    locked: typeof v.locked === 'boolean' ? v.locked : undefined,
  };
}

function validateMaintenance(v: unknown): MaintenanceBlock | null {
  if (!isObj(v)) return null;
  if (
    !isStr(v.id) ||
    !isStr(v.bargeId) ||
    !VALID_BARGE_IDS.has(v.bargeId) ||
    !isIsoDate(v.start) ||
    !isIsoDate(v.end)
  ) {
    return null;
  }
  return {
    id: v.id,
    bargeId: v.bargeId,
    start: v.start,
    end: v.end,
    reason: isStr(v.reason) ? v.reason : 'Maintenance',
  };
}

export function parseEnvelope(json: string): PlanState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!isObj(parsed) || parsed.format !== 'houston-bunker-fleet-scheduler') {
    throw new Error('Unrecognized file format.');
  }
  const plan = parsed.plan;
  if (!isObj(plan) || !Array.isArray(plan.stems)) {
    throw new Error('Envelope is missing a valid plan.');
  }

  const stems = (plan.stems as unknown[])
    .map(validateStem)
    .filter((s): s is Stem => s !== null);
  if (stems.length === 0) {
    throw new Error('No valid stems found in the imported plan.');
  }
  const stemIds = new Set(stems.map((s) => s.id));

  const activities = (Array.isArray(plan.activities) ? plan.activities : [])
    .map((a) => validateActivity(a, stemIds))
    .filter((a): a is Activity => a !== null);

  const maintenance = (Array.isArray(plan.maintenance) ? plan.maintenance : [])
    .map(validateMaintenance)
    .filter((m): m is MaintenanceBlock => m !== null);

  return { stems, activities, maintenance };
}

/** Trigger a browser download of the current plan as JSON. */
export function downloadPlan(plan: PlanState, exportedAt: string): void {
  const blob = new Blob([serializePlan(plan, exportedAt)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bunker-plan-${exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
