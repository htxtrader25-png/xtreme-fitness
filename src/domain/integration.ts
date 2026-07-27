import type { PlanState } from '@/types';
import { BARGES, SHORE_TANK } from '@/lib/constants';

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

export function parseEnvelope(json: string): PlanState {
  const parsed = JSON.parse(json) as Partial<PlanEnvelope>;
  if (parsed.format !== 'houston-bunker-fleet-scheduler') {
    throw new Error('Unrecognized file format.');
  }
  if (!parsed.plan || !Array.isArray(parsed.plan.stems)) {
    throw new Error('Envelope is missing a valid plan.');
  }
  return {
    stems: parsed.plan.stems,
    activities: parsed.plan.activities ?? [],
    maintenance: parsed.plan.maintenance ?? [],
  };
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
