import { useEffect, useMemo } from 'react';
import { Gauge, Pause, Play, SkipBack } from 'lucide-react';
import { useFleetStore } from '@/store/useFleetStore';
import { useDerived, usePlan } from '@/store/useDerived';
import { BARGES, SHORE_TANK, bargeById, ACTIVITY_COLORS } from '@/lib/constants';
import { planHorizon } from '@/domain/optimization';
import { Meter, StatTile, m3, pct } from '@/components/common/ui';
import { fmtDateTime, iso } from '@/lib/time';

const SPEEDS = [0.5, 1.5, 4, 12];

export function ReplayView() {
  const plan = usePlan();
  const replay = useFleetStore((s) => s.replay);
  const setReplayActive = useFleetStore((s) => s.setReplayActive);
  const setReplayTime = useFleetStore((s) => s.setReplayTime);
  const setReplayPlaying = useFleetStore((s) => s.setReplayPlaying);
  const setReplaySpeed = useFleetStore((s) => s.setReplaySpeed);

  const horizon = useMemo(() => planHorizon(plan), [plan]);
  const startMs = iso(horizon.start).getTime();
  const endMs = iso(horizon.end).getTime();

  // Activate replay mode while this view is mounted.
  useEffect(() => {
    setReplayActive(true);
    // Clamp current replay time into the horizon.
    const cur = useFleetStore.getState().replay.atMs;
    if (cur < startMs || cur > endMs) setReplayTime(startMs);
    return () => {
      setReplayActive(false);
      setReplayPlaying(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Playback loop.
  useEffect(() => {
    if (!replay.playing) return;
    const tick = 100; // ms
    const id = setInterval(() => {
      const state = useFleetStore.getState();
      const next = state.replay.atMs + state.replay.speed * (tick / 1000) * 3_600_000;
      if (next >= endMs) {
        setReplayTime(endMs);
        setReplayPlaying(false);
      } else {
        setReplayTime(next);
      }
    }, tick);
    return () => clearInterval(id);
  }, [replay.playing, endMs, setReplayTime, setReplayPlaying]);

  const { snapshot, now } = useDerived();
  const progress = endMs > startMs ? (replay.atMs - startMs) / (endMs - startMs) : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-panel-600 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Gauge size={18} className="text-accent" />
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Replay &amp; Timeline</h1>
            <p className="text-xs text-slate-500">
              Scrub through the plan to see inventory and fleet state evolve over time.
            </p>
          </div>
          <div className="ml-auto font-mono text-sm text-accent">{fmtDateTime(now)}</div>
        </div>

        {/* Transport controls */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-ghost"
            onClick={() => {
              setReplayTime(startMs);
              setReplayPlaying(false);
            }}
            title="Restart"
          >
            <SkipBack size={16} />
          </button>
          <button
            className="btn-primary"
            onClick={() => setReplayPlaying(!replay.playing)}
          >
            {replay.playing ? <Pause size={16} /> : <Play size={16} />}
            {replay.playing ? 'Pause' : 'Play'}
          </button>

          <input
            type="range"
            min={startMs}
            max={endMs}
            step={60_000}
            value={replay.atMs}
            onChange={(e) => setReplayTime(Number(e.target.value))}
            className="h-1.5 min-w-[140px] flex-1 cursor-pointer accent-sky-400"
          />

          <div className="flex rounded-md border border-panel-600 bg-panel-900 p-0.5">
            {SPEEDS.map((sp) => (
              <button
                key={sp}
                onClick={() => setReplaySpeed(sp)}
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  replay.speed === sp ? 'bg-accent text-panel-900' : 'text-slate-400'
                }`}
              >
                {sp}×
              </button>
            ))}
          </div>
        </div>

        {/* Timeline strip */}
        <div className="mt-3">
          <TimelineStrip startMs={startMs} endMs={endMs} progress={progress} />
        </div>
      </div>

      {/* State at playhead */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Inventory at playhead</h2>
            <div className="space-y-3">
              <InvRow name={SHORE_TANK.name} level={snapshot.tank.level} cap={snapshot.tank.capacity} color={SHORE_TANK.color} />
              {snapshot.barges.map((b) => (
                <InvRow
                  key={b.id}
                  name={b.name}
                  level={b.level}
                  cap={b.capacity}
                  color={bargeById(b.id)?.color ?? '#38bdf8'}
                />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <StatTile label="Fleet inventory" value={m3(snapshot.fleetLevel)} />
              <StatTile label="Fleet utilization" value={pct(snapshot.fleetUtilization)} />
            </div>
          </div>

          <div className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Fleet activity at playhead</h2>
            <div className="space-y-2">
              {BARGES.map((b) => {
                const act = plan.activities.find(
                  (a) =>
                    a.bargeId === b.id &&
                    replay.atMs >= iso(a.start).getTime() &&
                    replay.atMs < iso(a.end).getTime(),
                );
                const stem = act ? plan.stems.find((s) => s.id === act.stemId) : undefined;
                return (
                  <div
                    key={b.id}
                    className="flex items-center gap-3 rounded-md bg-panel-900/60 px-3 py-2"
                  >
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ background: b.color }}
                    />
                    <span className="w-16 text-sm font-medium text-slate-200">{b.name}</span>
                    {act ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span
                          className="rounded px-1.5 py-0.5 font-semibold text-white"
                          style={{ background: ACTIVITY_COLORS[act.type]?.bar }}
                        >
                          {act.type}
                        </span>
                        <span className="text-slate-400">
                          {stem?.ref} · {stem?.customer}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">Idle</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineStrip({
  startMs,
  endMs,
  progress,
}: {
  startMs: number;
  endMs: number;
  progress: number;
}) {
  const plan = usePlan();
  const span = Math.max(1, endMs - startMs);
  return (
    <div className="relative h-16 w-full rounded-md border border-panel-700 bg-panel-900/60">
      {BARGES.map((b, rowIdx) => (
        <div key={b.id} className="absolute inset-x-0" style={{ top: rowIdx * 20 + 2, height: 16 }}>
          {plan.activities
            .filter((a) => a.bargeId === b.id)
            .map((a) => {
              const l = ((iso(a.start).getTime() - startMs) / span) * 100;
              const w = ((iso(a.end).getTime() - iso(a.start).getTime()) / span) * 100;
              return (
                <div
                  key={a.id}
                  className="absolute rounded-sm"
                  style={{
                    left: `${l}%`,
                    width: `${Math.max(0.4, w)}%`,
                    height: 14,
                    background: ACTIVITY_COLORS[a.type]?.bar,
                    opacity: 0.85,
                  }}
                  title={`${a.type}`}
                />
              );
            })}
        </div>
      ))}
      {/* playhead */}
      <div
        className="absolute top-0 h-full w-0.5 bg-rose-500"
        style={{ left: `${Math.max(0, Math.min(100, progress * 100))}%` }}
      >
        <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-rose-500" />
      </div>
    </div>
  );
}

function InvRow({
  name,
  level,
  cap,
  color,
}: {
  name: string;
  level: number;
  cap: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-300">{name}</span>
        <span className="tabular-nums text-slate-400">
          {m3(level)} · {pct(level / cap)}
        </span>
      </div>
      <Meter value={level} max={cap} color={color} />
    </div>
  );
}
