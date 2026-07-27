import { useDerived } from '@/store/useDerived';
import { deliveriesByDay, volumeByProduct } from '@/domain/analytics';
import { PRODUCTS } from '@/lib/constants';
import { StatTile, m3, pct } from '@/components/common/ui';
import { fmtDuration } from '@/lib/time';
import { format, parseISO } from 'date-fns';

export function AnalyticsView() {
  const { kpis, utilization, plan } = useDerived();
  const byDay = deliveriesByDay(plan);
  const byProduct = volumeByProduct(plan);
  const maxDayVol = Math.max(1, ...byDay.map((d) => d.volume));
  const totalProductVol = Math.max(1, byProduct.reduce((s, p) => s + p.volume, 0));

  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="mb-1 text-lg font-semibold text-slate-100">Analytics</h1>
      <p className="mb-4 text-xs text-slate-500">
        Operational KPIs and productivity breakdown across the planning horizon.
      </p>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Deliveries today" value={kpis.deliveriesToday} />
        <StatTile
          label="Tank utilization"
          value={pct(kpis.tankUtilization)}
          tone={kpis.tankUtilization < 0.15 ? 'bad' : 'default'}
        />
        <StatTile
          label="Fleet utilization"
          value={pct(kpis.fleetUtilization)}
          tone={kpis.fleetUtilization >= 0.7 ? 'good' : 'warn'}
        />
        <StatTile label="Idle hours" value={fmtDuration(kpis.idleHours)} />
        <StatTile
          label="Conflicts"
          value={kpis.conflictCount}
          tone={kpis.conflictCount > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label="At-risk deliveries"
          value={kpis.atRiskDeliveries}
          tone={kpis.atRiskDeliveries > 0 ? 'warn' : 'good'}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Deliveries by day */}
        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">
            Deliveries by day (volume)
          </h2>
          {byDay.length === 0 ? (
            <p className="text-xs text-slate-500">No deliveries scheduled.</p>
          ) : (
            <div className="flex h-48 items-end gap-3">
              {byDay.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[11px] tabular-nums text-slate-400">{d.count}</span>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t bg-accent/80"
                      style={{ height: `${(d.volume / maxDayVol) * 100}%` }}
                      title={m3(d.volume)}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {format(parseISO(d.day), 'EEE d')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Volume by product */}
        <div className="panel p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Volume by product</h2>
          <div className="space-y-2.5">
            {PRODUCTS.map((p) => {
              const v = byProduct.find((x) => x.product === p.id)?.volume ?? 0;
              return (
                <div key={p.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-300">{p.name}</span>
                    <span className="tabular-nums text-slate-400">
                      {m3(v)} · {pct(v / totalProductVol)}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-panel-900">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(v / totalProductVol) * 100}%`, background: p.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Per-barge productivity */}
      <div className="panel mt-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">
          Per-barge time breakdown ({fmtDuration(utilization.horizonHours)} horizon)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-3 font-medium">Barge</th>
                <th className="pb-2 pr-3 font-medium">Loading</th>
                <th className="pb-2 pr-3 font-medium">Sailing</th>
                <th className="pb-2 pr-3 font-medium">Delivering</th>
                <th className="pb-2 pr-3 font-medium">Inspecting</th>
                <th className="pb-2 pr-3 font-medium">Waiting</th>
                <th className="pb-2 pr-3 font-medium">Idle</th>
                <th className="pb-2 font-medium">Utilization</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-slate-300">
              {utilization.perBarge.map((b) => (
                <tr key={b.bargeId} className="border-t border-panel-700">
                  <td className="py-2 pr-3 font-medium text-slate-100">{b.name}</td>
                  <td className="py-2 pr-3">{fmtDuration(b.loadingHours)}</td>
                  <td className="py-2 pr-3">{fmtDuration(b.sailingHours)}</td>
                  <td className="py-2 pr-3">{fmtDuration(b.deliveringHours)}</td>
                  <td className="py-2 pr-3">{fmtDuration(b.inspectingHours)}</td>
                  <td className="py-2 pr-3">{fmtDuration(b.waitingHours)}</td>
                  <td className="py-2 pr-3">{fmtDuration(b.idleHours)}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-900">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${b.utilization * 100}%` }}
                        />
                      </div>
                      <span className="text-xs">{pct(b.utilization)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
