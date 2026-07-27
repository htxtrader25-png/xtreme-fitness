import { useMemo, useState } from 'react';
import { ArrowRight, Check, FlaskConical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useFleetStore } from '@/store/useFleetStore';
import { BARGES, SHORE_TANK } from '@/lib/constants';
import { computePlanMetrics } from '@/domain/planMetrics';
import type { Scenario } from '@/types';
import { fmtDuration, fmtDateTime } from '@/lib/time';
import { m3, pct } from '@/components/common/ui';

export function ScenarioView() {
  const scenarios = useFleetStore((s) => s.scenarios);
  const activeScenarioId = useFleetStore((s) => s.activeScenarioId);
  const createScenario = useFleetStore((s) => s.createScenario);
  const enterScenario = useFleetStore((s) => s.enterScenario);
  const exitScenario = useFleetStore((s) => s.exitScenario);
  const deleteScenario = useFleetStore((s) => s.deleteScenario);
  const resetScenarioDraft = useFleetStore((s) => s.resetScenarioDraft);
  const applyScenarioToLive = useFleetStore((s) => s.applyScenarioToLive);

  const [name, setName] = useState('');

  const create = () => {
    createScenario(name.trim() || `Scenario ${scenarios.length + 1}`);
    setName('');
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center gap-2">
        <FlaskConical size={18} className="text-accent" />
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Scenario / What-if Planning</h1>
          <p className="text-xs text-slate-500">
            Branch the live plan into a sandbox, edit freely, and compare before &amp; after.
          </p>
        </div>
      </div>

      {activeScenarioId && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-950/30 px-4 py-3">
          <span className="text-sm font-semibold text-amber-200">
            Editing scenario draft — live plan is untouched.
          </span>
          <span className="text-xs text-amber-300/80">
            Changes on the Scheduler now apply to this scenario.
          </span>
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost text-xs" onClick={exitScenario}>
              Exit to live
            </button>
          </div>
        </div>
      )}

      {/* Create */}
      <div className="panel mb-4 flex items-center gap-2 p-3">
        <input
          className="input max-w-xs"
          placeholder="New scenario name (e.g. Swap Titan/Atlas)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button className="btn-primary text-sm" onClick={create}>
          <Plus size={14} /> Snapshot current plan
        </button>
        <span className="text-xs text-slate-500">
          Creates a scenario from the live plan and starts editing it.
        </span>
      </div>

      {scenarios.length === 0 ? (
        <div className="panel p-8 text-center text-sm text-slate-500">
          No scenarios yet. Snapshot the current plan to explore what-if changes safely.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {scenarios.map((sc) => (
            <ScenarioCard
              key={sc.id}
              scenario={sc}
              active={sc.id === activeScenarioId}
              onEnter={() => enterScenario(sc.id)}
              onExit={exitScenario}
              onReset={() => resetScenarioDraft(sc.id)}
              onApply={() => applyScenarioToLive(sc.id)}
              onDelete={() => deleteScenario(sc.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioCard({
  scenario,
  active,
  onEnter,
  onExit,
  onReset,
  onApply,
  onDelete,
}: {
  scenario: Scenario;
  active: boolean;
  onEnter: () => void;
  onExit: () => void;
  onReset: () => void;
  onApply: () => void;
  onDelete: () => void;
}) {
  const base = useMemo(
    () => computePlanMetrics(scenario.base, BARGES, SHORE_TANK),
    [scenario.base],
  );
  const draft = useMemo(
    () => computePlanMetrics(scenario.draft, BARGES, SHORE_TANK),
    [scenario.draft],
  );

  return (
    <div
      className={`panel p-4 ${active ? 'ring-1 ring-amber-400/60' : ''}`}
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{scenario.name}</h3>
          <p className="text-[11px] text-slate-500">
            Snapshotted {fmtDateTime(scenario.createdAt)}
          </p>
        </div>
        {active && (
          <span className="chip bg-amber-600/30 text-amber-200">Active</span>
        )}
      </div>

      {/* Before / After metrics */}
      <div className="overflow-hidden rounded-md border border-panel-700">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-panel-900/60 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-1.5 font-medium">Metric</th>
              <th className="px-3 py-1.5 text-right font-medium">Before</th>
              <th className="px-3 py-1.5 text-right font-medium">After</th>
              <th className="px-3 py-1.5 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody className="tabular-nums text-slate-300">
            <Row label="Fleet utilization" before={pct(base.fleetUtilization)} after={pct(draft.fleetUtilization)} delta={draft.fleetUtilization - base.fleetUtilization} good="up" fmt={(n) => `${(n * 100 >= 0 ? '+' : '')}${Math.round(n * 100)} pp`} />
            <Row label="Idle hours" before={fmtDuration(base.idleHours)} after={fmtDuration(draft.idleHours)} delta={draft.idleHours - base.idleHours} good="down" fmt={(n) => `${n >= 0 ? '+' : ''}${fmtDuration(n)}`} />
            <Row label="Conflicts" before={String(base.conflicts)} after={String(draft.conflicts)} delta={draft.conflicts - base.conflicts} good="down" fmt={(n) => `${n >= 0 ? '+' : ''}${n}`} />
            <Row label="At-risk" before={String(base.atRisk)} after={String(draft.atRisk)} delta={draft.atRisk - base.atRisk} good="down" fmt={(n) => `${n >= 0 ? '+' : ''}${n}`} />
            <Row label="Tank trough" before={m3(base.tankTrough)} after={m3(draft.tankTrough)} delta={draft.tankTrough - base.tankTrough} good="up" fmt={(n) => `${n >= 0 ? '+' : ''}${m3(n)}`} />
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {active ? (
          <button className="btn-ghost text-xs" onClick={onExit}>
            Stop editing
          </button>
        ) : (
          <button className="btn-primary text-xs" onClick={onEnter}>
            <ArrowRight size={13} /> Edit this scenario
          </button>
        )}
        <button className="btn-ghost text-xs" onClick={onReset} title="Reset draft to snapshot">
          <RotateCcw size={13} /> Reset
        </button>
        <button className="btn-ghost text-xs" onClick={onApply} title="Apply draft to live plan">
          <Check size={13} /> Apply to live
        </button>
        <button className="btn-danger ml-auto text-xs" onClick={onDelete}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  before,
  after,
  delta,
  good,
  fmt,
}: {
  label: string;
  before: string;
  after: string;
  delta: number;
  good: 'up' | 'down';
  fmt: (n: number) => string;
}) {
  const improved = good === 'up' ? delta > 0.0001 : delta < -0.0001;
  const worsened = good === 'up' ? delta < -0.0001 : delta > 0.0001;
  const tone = improved ? 'text-emerald-400' : worsened ? 'text-rose-400' : 'text-slate-500';
  return (
    <tr className="border-t border-panel-700">
      <td className="px-3 py-1.5 text-slate-400">{label}</td>
      <td className="px-3 py-1.5 text-right">{before}</td>
      <td className="px-3 py-1.5 text-right font-medium text-slate-100">{after}</td>
      <td className={`px-3 py-1.5 text-right ${tone}`}>{fmt(delta)}</td>
    </tr>
  );
}
