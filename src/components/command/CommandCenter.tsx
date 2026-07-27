import {
  Activity as ActivityIcon,
  AlertOctagon,
  Anchor,
  Brain,
  Droplet,
  Gauge as GaugeIcon,
  Ship,
  Target,
  X,
} from 'lucide-react';
import { useFleetStore } from '@/store/useFleetStore';
import { useDerived } from '@/store/useDerived';
import { BARGES, SHORE_TANK, bargeById, productById } from '@/lib/constants';
import { deriveStemStatus, orderChain } from '@/domain/activities';
import { weatherProvider } from '@/domain/weather';
import {
  Meter,
  PriorityBadge,
  SeverityDot,
  StatTile,
  StatusBadge,
  m3,
  pct,
} from '@/components/common/ui';
import { ACTIVITY_COLORS } from '@/lib/constants';
import { fmtDuration, fmtTime, hoursBetween } from '@/lib/time';
import type { Recommendation } from '@/types';

export function CommandCenter({
  open = false,
  onClose,
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  const { snapshot, conflicts, recommendations, kpis, utilization, now, plan } =
    useDerived();
  const selectedStemId = useFleetStore((s) => s.selectedStemId);
  const selectStem = useFleetStore((s) => s.selectStem);
  const setFocus = useFleetStore((s) => s.setFocus);
  const reassignStem = useFleetStore((s) => s.reassignStem);

  const selectedStem = plan.stems.find((s) => s.id === selectedStemId);
  const weather = weatherProvider.at(now);

  const criticalAlerts = conflicts.filter((c) => c.severity === 'critical');
  const warnAlerts = conflicts.filter((c) => c.severity === 'warning');

  const focusConflict = (activityIds: string[]) => setFocus(activityIds);

  const applyRec = (rec: Recommendation) => {
    if (!rec.action) return;
    if (rec.action.kind === 'reassign-barge' && rec.action.stemId && rec.action.toBargeId) {
      reassignStem(rec.action.stemId, rec.action.toBargeId);
      selectStem(rec.action.stemId);
    } else if (rec.action.kind === 'resolve-conflict' && rec.stemId) {
      selectStem(rec.stemId);
      const acts = plan.activities.filter((a) => a.stemId === rec.stemId).map((a) => a.id);
      setFocus(acts);
    }
  };

  return (
    <aside
      className={`fixed inset-y-0 right-0 z-40 flex h-full w-[86%] max-w-sm shrink-0 transform flex-col border-l border-panel-600 bg-panel-900 shadow-2xl transition-transform duration-200 lg:static lg:z-0 lg:w-[340px] lg:max-w-none lg:translate-x-0 lg:shadow-none ${
        open ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
      }`}
    >
      <div className="flex items-center gap-2 border-b border-panel-600 px-4 py-3">
        <Target size={18} className="text-accent" />
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Command Center</h2>
          <p className="text-[11px] text-slate-500">Live operational status</p>
        </div>
        <button
          className="ml-auto rounded-md p-1 text-slate-400 hover:bg-panel-700 hover:text-slate-200 lg:hidden"
          onClick={onClose}
          aria-label="Close command center"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* KPIs */}
        <Section title="KPIs" icon={<GaugeIcon size={13} />}>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Deliveries today" value={kpis.deliveriesToday} />
            <StatTile
              label="Fleet util."
              value={pct(kpis.fleetUtilization)}
              tone={kpis.fleetUtilization >= 0.7 ? 'good' : 'warn'}
            />
            <StatTile label="Tank util." value={pct(kpis.tankUtilization)} />
            <StatTile
              label="Idle hours"
              value={fmtDuration(kpis.idleHours)}
              tone={kpis.idleHours > 24 ? 'warn' : 'default'}
            />
            <StatTile
              label="Conflicts"
              value={kpis.conflictCount}
              tone={kpis.conflictCount > 0 ? 'bad' : 'good'}
            />
            <StatTile
              label="At-risk"
              value={kpis.atRiskDeliveries}
              tone={kpis.atRiskDeliveries > 0 ? 'warn' : 'good'}
            />
          </div>
        </Section>

        {/* Alerts + weather */}
        <Section title="Alerts" icon={<AlertOctagon size={13} />}>
          {criticalAlerts.length === 0 && warnAlerts.length === 0 && !weather.advisory ? (
            <p className="text-xs text-emerald-400">All clear — no active alerts.</p>
          ) : (
            <ul className="space-y-1.5">
              {weather.advisory && (
                <li className="flex items-start gap-2 rounded-md bg-amber-950/40 px-2 py-1.5 text-xs text-amber-200">
                  <SeverityDot severity="warning" />
                  <span>
                    <span className="font-semibold">Weather · </span>
                    {weather.advisory}
                  </span>
                </li>
              )}
              {[...criticalAlerts, ...warnAlerts].slice(0, 6).map((c) => (
                <li
                  key={c.id}
                  onClick={() => focusConflict(c.activityIds)}
                  className="flex cursor-pointer items-start gap-2 rounded-md bg-panel-800 px-2 py-1.5 text-xs text-slate-300 hover:bg-panel-700"
                >
                  <SeverityDot severity={c.severity} />
                  <span>{c.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Inventory */}
        <Section title="Inventory" icon={<Droplet size={13} />}>
          <div className="space-y-2.5">
            <InventoryRow
              name={SHORE_TANK.name}
              level={snapshot.tank.level}
              capacity={snapshot.tank.capacity}
              color={SHORE_TANK.color}
            />
            {snapshot.barges.map((b) => (
              <InventoryRow
                key={b.id}
                name={b.name}
                level={b.level}
                capacity={b.capacity}
                color={bargeById(b.id)?.color ?? '#38bdf8'}
              />
            ))}
            <div className="mt-1 flex items-center justify-between border-t border-panel-700 pt-2 text-xs">
              <span className="text-slate-400">Total fleet inventory</span>
              <span className="font-semibold tabular-nums text-slate-100">
                {m3(snapshot.fleetLevel)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Remaining capacity</span>
              <span className="font-semibold tabular-nums text-slate-100">
                {m3(snapshot.fleetRemaining)}
              </span>
            </div>
          </div>
        </Section>

        {/* Fleet status */}
        <Section title="Fleet status" icon={<Ship size={13} />}>
          <div className="space-y-1.5">
            {BARGES.map((b) => {
              const acts = plan.activities.filter((a) => a.bargeId === b.id);
              const status = acts.length ? deriveStemStatus(currentStemActs(plan, b.id, now), now) : 'planned';
              const u = utilization.perBarge.find((x) => x.bargeId === b.id);
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between rounded-md bg-panel-800 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: b.color }}
                    />
                    <span className="text-xs font-medium text-slate-200">{b.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status} />
                    <span className="w-10 text-right text-[11px] tabular-nums text-slate-400">
                      {pct(u?.utilization ?? 0)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Active stem */}
        <Section title="Active stem" icon={<ActivityIcon size={13} />}>
          {!selectedStem ? (
            <p className="text-xs text-slate-500">
              Select a stem on the timeline to inspect it here.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-100">{selectedStem.ref}</span>
                <PriorityBadge priority={selectedStem.priority} />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-400">
                <Info label="Customer" value={selectedStem.customer} />
                <Info label="Vessel" value={selectedStem.vessel} />
                <Info
                  label="Product"
                  value={productById(selectedStem.product)?.name ?? selectedStem.product}
                />
                <Info label="Volume" value={m3(selectedStem.volume)} />
                <Info label="Barge" value={bargeById(selectedStem.bargeId)?.name ?? ''} />
                <Info
                  label="Window"
                  value={`${fmtTime(selectedStem.windowStart)}–${fmtTime(selectedStem.windowEnd)}`}
                />
              </div>
              {/* mini lifecycle */}
              <div className="mt-1 space-y-1">
                {orderChain(
                  plan.activities.filter((a) => a.stemId === selectedStem.id),
                ).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-[11px]">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: ACTIVITY_COLORS[a.type]?.bar }}
                    />
                    <span className="w-24 text-slate-300">{a.type}</span>
                    <span className="tabular-nums text-slate-500">
                      {fmtTime(a.start)}–{fmtTime(a.end)}
                    </span>
                    <span className="ml-auto tabular-nums text-slate-600">
                      {fmtDuration(hoursBetween(a.start, a.end))}
                    </span>
                  </div>
                ))}
              </div>
              {selectedStem.notes && (
                <p className="rounded-md bg-panel-800 px-2 py-1.5 text-[11px] italic text-slate-400">
                  {selectedStem.notes}
                </p>
              )}
            </div>
          )}
        </Section>

        {/* Recommendations */}
        <Section title="AI Recommendations" icon={<Brain size={13} />}>
          {recommendations.length === 0 ? (
            <p className="text-xs text-emerald-400">
              No recommendations — the plan looks healthy.
            </p>
          ) : (
            <ul className="space-y-2">
              {recommendations.slice(0, 5).map((rec) => (
                <li
                  key={rec.id}
                  className="rounded-md border border-panel-700 bg-panel-800 px-2.5 py-2"
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <SeverityDot severity={rec.severity} />
                    <span className="text-xs font-semibold text-slate-100">{rec.title}</span>
                  </div>
                  <p className="text-[11px] leading-snug text-slate-400">{rec.reasoning}</p>
                  {rec.action && rec.action.kind !== 'none' && (
                    <button
                      className="btn-ghost mt-1.5 !py-1 text-[11px]"
                      onClick={() => applyRec(rec)}
                    >
                      {rec.action.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Conflicts */}
        <Section title="Conflicts" icon={<Anchor size={13} />}>
          {conflicts.length === 0 ? (
            <p className="text-xs text-emerald-400">No conflicts detected.</p>
          ) : (
            <ul className="space-y-1.5">
              {conflicts.map((c) => (
                <li
                  key={c.id}
                  onClick={() => focusConflict(c.activityIds)}
                  className="cursor-pointer rounded-md bg-panel-800 px-2.5 py-1.5 hover:bg-panel-700"
                >
                  <div className="flex items-center gap-1.5">
                    <SeverityDot severity={c.severity} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                      {c.type.replace(/-/g, ' ')}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">{c.message}</p>
                  {c.suggestion && (
                    <p className="mt-0.5 text-[11px] italic text-sky-300/80">→ {c.suggestion}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </aside>
  );
}

// Helper: activities of whichever stem is currently active on a barge at `now`.
function currentStemActs(
  plan: ReturnType<typeof useDerived>['plan'],
  bargeId: string,
  now: Date,
) {
  const t = now.getTime();
  const acts = plan.activities.filter((a) => a.bargeId === bargeId);
  const active = acts.find(
    (a) => t >= new Date(a.start).getTime() && t < new Date(a.end).getTime(),
  );
  if (active) return acts.filter((a) => a.stemId === active.stemId);
  return acts;
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-panel-600 bg-panel-800/70">
      <header className="flex items-center gap-1.5 border-b border-panel-700 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span className="text-slate-500">{icon}</span>
        {title}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function InventoryRow({
  name,
  level,
  capacity,
  color,
}: {
  name: string;
  level: number;
  capacity: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px]">
        <span className="text-slate-300">{name}</span>
        <span className="tabular-nums text-slate-400">
          {m3(level)} <span className="text-slate-600">/ {pct(level / capacity)}</span>
        </span>
      </div>
      <Meter value={level} max={capacity} color={color} height={6} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-slate-600">{label}: </span>
      <span className="text-slate-300">{value}</span>
    </div>
  );
}
