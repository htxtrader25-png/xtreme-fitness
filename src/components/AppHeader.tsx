import { useRef } from 'react';
import {
  Anchor,
  Download,
  FlaskConical,
  RotateCcw,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useFleetStore } from '@/store/useFleetStore';
import { useDerived } from '@/store/useDerived';
import { downloadPlan, parseEnvelope } from '@/domain/integration';
import { WeatherWidget } from '@/components/weather/WeatherWidget';
import { pct } from '@/components/common/ui';
import { fmtDateTime } from '@/lib/time';
import type { ModuleId } from '@/App';

export function AppHeader({
  active,
  onNavigate,
}: {
  active: ModuleId;
  onNavigate: (m: ModuleId) => void;
}) {
  const { kpis, now, plan } = useDerived();
  const isScenario = useFleetStore((s) => s.activeScenarioId !== null);
  const scenarios = useFleetStore((s) => s.scenarios);
  const activeScenarioId = useFleetStore((s) => s.activeScenarioId);
  const exitScenario = useFleetStore((s) => s.exitScenario);
  const openNewStem = useFleetStore((s) => s.openNewStem);
  const resetToSeed = useFleetStore((s) => s.resetToSeed);
  const importPlan = useFleetStore((s) => s.importPlan);

  const fileRef = useRef<HTMLInputElement>(null);

  const scenarioName = scenarios.find((s) => s.id === activeScenarioId)?.name;

  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importPlan(parseEnvelope(String(reader.result)));
      } catch (err) {
        alert(`Import failed: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <header className="flex flex-col border-b border-panel-600 bg-panel-900">
      <div className="flex items-center gap-4 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/15">
            <Anchor size={18} className="text-accent" />
          </div>
          <div>
            <h1 className="text-sm font-bold leading-tight text-slate-100">
              Houston Bunker Fleet Scheduler
            </h1>
            <p className="text-[11px] leading-tight text-slate-500">
              Operational command center
            </p>
          </div>
        </div>

        {isScenario && (
          <button
            onClick={exitScenario}
            className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-950/40 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-900/40"
            title="You are editing a scenario. Click to return to the live plan."
          >
            <FlaskConical size={12} />
            Scenario: {scenarioName ?? 'draft'} · exit
          </button>
        )}

        {/* KPI strip */}
        <div className="ml-2 hidden items-center gap-4 lg:flex">
          <HeaderKpi label="Deliveries" value={String(kpis.deliveriesToday)} />
          <HeaderKpi label="Fleet util" value={pct(kpis.fleetUtilization)} />
          <HeaderKpi label="Tank" value={pct(kpis.tankUtilization)} />
          <HeaderKpi
            label="Conflicts"
            value={String(kpis.conflictCount)}
            tone={kpis.conflictCount > 0 ? 'bad' : 'good'}
          />
        </div>

        <div className="flex-1" />

        <WeatherWidget compact />
        <div className="hidden font-mono text-xs text-slate-400 md:block">
          {fmtDateTime(now)}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            className="btn-ghost !px-2"
            title="Export plan (JSON)"
            onClick={() => downloadPlan(plan, now.toISOString())}
          >
            <Download size={15} />
          </button>
          <button
            className="btn-ghost !px-2"
            title="Import plan (JSON)"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={15} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={onImport}
          />
          <button
            className="btn-ghost !px-2"
            title="Reset to demo plan"
            onClick={() => {
              if (confirm('Reset the plan and all scenarios to the demo seed?')) resetToSeed();
            }}
          >
            <RotateCcw size={15} />
          </button>
          <button className="btn-primary text-xs" onClick={() => openNewStem()}>
            <Sparkles size={14} /> New Stem
          </button>
        </div>
      </div>

      {/* Module nav */}
      <nav className="flex items-center gap-1 px-3">
        {MODULES.map((m) => (
          <button
            key={m.id}
            onClick={() => onNavigate(m.id)}
            className={`relative px-3 py-2 text-sm font-medium transition-colors ${
              active === m.id
                ? 'text-accent'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {m.label}
            {active === m.id && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </nav>
    </header>
  );
}

const MODULES: { id: ModuleId; label: string }[] = [
  { id: 'scheduler', label: 'Scheduler' },
  { id: 'optimization', label: 'Optimization' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'replay', label: 'Replay' },
  { id: 'map', label: 'Map' },
  { id: 'analytics', label: 'Analytics' },
];

function HeaderKpi({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad';
}) {
  const toneClass =
    tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-slate-100';
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${toneClass}`}>{value}</span>
    </div>
  );
}
