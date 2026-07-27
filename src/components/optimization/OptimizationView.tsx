import { ArrowRightLeft, Clock, Layers, Sparkles, TrendingUp } from 'lucide-react';
import { useDerived } from '@/store/useDerived';
import { useFleetStore } from '@/store/useFleetStore';
import { StatTile, pct } from '@/components/common/ui';
import { fmtDuration } from '@/lib/time';
import type { OptimizationKind, OptimizationSuggestion } from '@/types';

const KIND_ICON: Record<OptimizationKind, React.ReactNode> = {
  'swap-barge': <ArrowRightLeft size={15} />,
  'shift-departure': <Clock size={15} />,
  consolidate: <Layers size={15} />,
  'reduce-idle': <TrendingUp size={15} />,
};

export function OptimizationView() {
  const { optimizations, utilization } = useDerived();
  const reassignStem = useFleetStore((s) => s.reassignStem);
  const shiftStem = useFleetStore((s) => s.shiftStem);
  const selectStem = useFleetStore((s) => s.selectStem);

  const apply = (s: OptimizationSuggestion) => {
    if (s.kind === 'swap-barge' && s.stemId && s.toBargeId) {
      reassignStem(s.stemId, s.toBargeId);
      selectStem(s.stemId);
    } else if (s.kind === 'shift-departure' && s.stemId && s.proposedStart) {
      shiftStem(s.stemId, s.proposedStart);
      selectStem(s.stemId);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles size={18} className="text-accent" />
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Idle-Time Optimization</h1>
          <p className="text-xs text-slate-500">
            Fleet productivity analysis with actionable suggestions.
          </p>
        </div>
      </div>

      {/* Fleet summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Fleet utilization"
          value={pct(utilization.fleetUtilization)}
          tone={utilization.fleetUtilization >= 0.7 ? 'good' : 'warn'}
        />
        <StatTile label="Idle hours" value={fmtDuration(utilization.totalIdleHours)} tone="warn" />
        <StatTile label="Waiting hours" value={fmtDuration(utilization.totalWaitingHours)} />
        <StatTile label="Sailing hours" value={fmtDuration(utilization.totalSailingHours)} />
        <StatTile label="Loading hours" value={fmtDuration(utilization.totalLoadingHours)} />
        <StatTile label="Delivering hours" value={fmtDuration(utilization.totalDeliveringHours)} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Suggestions */}
        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Suggestions ({optimizations.length})
          </h2>
          {optimizations.length === 0 ? (
            <p className="text-xs text-emerald-400">
              Fleet is well balanced — no optimizations recommended.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {optimizations.map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-panel-700 bg-panel-900/60 p-3"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-accent">{KIND_ICON[s.kind]}</span>
                    <span className="text-sm font-semibold text-slate-100">{s.title}</span>
                  </div>
                  <p className="text-xs leading-snug text-slate-400">{s.reasoning}</p>
                  <div className="mt-2 flex items-center gap-3 text-[11px]">
                    <span className="chip bg-emerald-600/20 text-emerald-300">
                      +{s.estimatedUtilizationGain} pp util.
                    </span>
                    <span className="chip bg-sky-600/20 text-sky-300">
                      −{fmtDuration(s.estimatedIdleReduction)} idle
                    </span>
                    <div className="flex-1" />
                    {s.applicable ? (
                      <button className="btn-primary !py-1 text-[11px]" onClick={() => apply(s)}>
                        Apply
                      </button>
                    ) : (
                      <span className="text-slate-600">Manual review</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Per-barge idle breakdown */}
        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Idle-time by barge</h2>
          <div className="space-y-3">
            {utilization.perBarge.map((b) => (
              <div key={b.bargeId}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-200">{b.name}</span>
                  <span className="tabular-nums text-slate-400">
                    {pct(b.utilization)} busy · {fmtDuration(b.idleHours)} idle
                  </span>
                </div>
                {/* stacked bar */}
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-panel-900">
                  <Seg value={b.loadingHours} total={b.horizonHours} color="#0ea5e9" />
                  <Seg value={b.sailingHours} total={b.horizonHours} color="#6366f1" />
                  <Seg value={b.deliveringHours} total={b.horizonHours} color="#22c55e" />
                  <Seg value={b.inspectingHours} total={b.horizonHours} color="#64748b" />
                  <Seg value={b.idleHours} total={b.horizonHours} color="#1e293b" />
                </div>
              </div>
            ))}
            <Legend />
          </div>
        </div>
      </div>
    </div>
  );
}

function Seg({ value, total, color }: { value: number; total: number; color: string }) {
  if (value <= 0 || total <= 0) return null;
  return <div style={{ width: `${(value / total) * 100}%`, background: color }} />;
}

function Legend() {
  const items = [
    ['Loading', '#0ea5e9'],
    ['Sailing', '#6366f1'],
    ['Delivering', '#22c55e'],
    ['Inspecting', '#64748b'],
    ['Idle', '#1e293b'],
  ] as const;
  return (
    <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-slate-500">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
