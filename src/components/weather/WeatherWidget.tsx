import { Cloud, Eye, Waves, Wind } from 'lucide-react';
import { useDerived } from '@/store/useDerived';
import { weatherProvider } from '@/domain/weather';
import type { WeatherState } from '@/types';

const CONDITION_TONE: Record<WeatherState['condition'], string> = {
  calm: 'text-emerald-400',
  moderate: 'text-sky-400',
  rough: 'text-rose-400',
  restricted: 'text-amber-400',
};

export function WeatherWidget({ compact = false }: { compact?: boolean }) {
  const { now } = useDerived();
  const w = weatherProvider.at(now);

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Wind size={14} className={CONDITION_TONE[w.condition]} />
        <span className="tabular-nums">{w.windKts} kts</span>
        <span className={`capitalize ${CONDITION_TONE[w.condition]}`}>{w.condition}</span>
      </div>
    );
  }

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Cloud size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-slate-200">Weather &amp; Tides</h2>
        <span className={`ml-auto text-xs font-semibold capitalize ${CONDITION_TONE[w.condition]}`}>
          {w.condition}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Metric icon={<Wind size={14} />} label="Wind" value={`${w.windKts} kts`} />
        <Metric icon={<Wind size={14} />} label="Gusts" value={`${w.gustKts} kts`} />
        <Metric icon={<Waves size={14} />} label="Wave" value={`${w.waveFt} ft`} />
        <Metric icon={<Eye size={14} />} label="Visibility" value={`${w.visibilityNm} nm`} />
      </div>
      {w.advisory ? (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-950/30 px-2.5 py-2 text-xs text-amber-200">
          {w.advisory}
        </p>
      ) : (
        <p className="mt-3 text-xs text-emerald-400">Conditions within operating limits.</p>
      )}
      <p className="mt-2 text-[10px] text-slate-600">
        Source: {weatherProvider.name} · pluggable via WeatherProvider hook.
      </p>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-panel-900/60 px-2.5 py-1.5">
      <span className="text-slate-500">{icon}</span>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
        <div className="tabular-nums text-slate-200">{value}</div>
      </div>
    </div>
  );
}
