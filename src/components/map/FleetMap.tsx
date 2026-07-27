import { useMemo } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { useDerived } from '@/store/useDerived';
import { BARGES, SHORE_TANK } from '@/lib/constants';
import { WeatherWidget } from '@/components/weather/WeatherWidget';
import { StatusBadge } from '@/components/common/ui';
import { deriveStemStatus } from '@/domain/activities';
import { iso } from '@/lib/time';
import type { ActivityType } from '@/types';

// Channel waypoints: shore berth → channel → turning basin → sea buoy.
const CHANNEL: Array<[number, number]> = [
  [110, 250],
  [280, 235],
  [470, 190],
  [700, 120],
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Position (x,y) at fraction t (0..1) along the channel polyline. */
function posAt(t: number): [number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const segs = CHANNEL.length - 1;
  const scaled = clamped * segs;
  const i = Math.min(segs - 1, Math.floor(scaled));
  const local = scaled - i;
  return [
    lerp(CHANNEL[i][0], CHANNEL[i + 1][0], local),
    lerp(CHANNEL[i][1], CHANNEL[i + 1][1], local),
  ];
}

/** Map an activity type + progress to a channel position fraction. */
function positionFraction(type: ActivityType | 'idle', progress: number): number {
  switch (type) {
    case 'Transit':
      return lerp(0.08, 0.95, progress);
    case 'Delivery':
      return 0.97;
    case 'ReturnTransit':
      return lerp(0.95, 0.08, progress);
    case 'Inspection':
    case 'Loading':
    case 'Available':
    case 'idle':
    default:
      return 0.03;
  }
}

export function FleetMap() {
  const { plan, now } = useDerived();
  const t = now.getTime();

  const bargePositions = useMemo(() => {
    return BARGES.map((b, idx) => {
      const act = plan.activities.find(
        (a) =>
          a.bargeId === b.id &&
          t >= iso(a.start).getTime() &&
          t < iso(a.end).getTime(),
      );
      let frac = 0.03;
      let type: ActivityType | 'idle' = 'idle';
      let stemRef: string | undefined;
      if (act) {
        const s = iso(act.start).getTime();
        const e = iso(act.end).getTime();
        const progress = e > s ? (t - s) / (e - s) : 0;
        frac = positionFraction(act.type, progress);
        type = act.type;
        stemRef = plan.stems.find((st) => st.id === act.stemId)?.ref;
      }
      const [x, y0] = posAt(frac);
      // Stagger barges into parallel lanes so co-located markers don't overlap.
      const y = y0 + (idx - 1) * 18;
      const status = deriveStemStatus(
        plan.activities.filter((a) => a.stemId === act?.stemId),
        now,
      );
      return { barge: b, x, y, type, stemRef, status };
    });
  }, [plan, t, now]);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center gap-2">
        <MapIcon size={18} className="text-accent" />
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Map Integration</h1>
          <p className="text-xs text-slate-500">
            Schematic Houston Ship Channel — barge positions derived live from the schedule.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="panel p-3 lg:col-span-2">
          <svg viewBox="0 0 780 320" className="h-auto w-full">
            <defs>
              <linearGradient id="water" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0e2033" />
                <stop offset="100%" stopColor="#0a3350" />
              </linearGradient>
              <linearGradient id="land" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#14251c" />
                <stop offset="100%" stopColor="#0e1a14" />
              </linearGradient>
            </defs>

            {/* water */}
            <rect x="0" y="0" width="780" height="320" fill="url(#water)" />
            {/* land mass (shore) */}
            <path d="M0,0 L780,0 L780,60 C560,90 380,110 220,160 C150,185 70,230 0,250 Z" fill="url(#land)" opacity="0.85" />
            <path d="M0,320 L0,285 C120,270 220,255 300,235 L780,150 L780,320 Z" fill="url(#land)" opacity="0.7" />

            {/* channel centerline */}
            <polyline
              points={CHANNEL.map((p) => p.join(',')).join(' ')}
              fill="none"
              stroke="#1e3a52"
              strokeWidth="26"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={CHANNEL.map((p) => p.join(',')).join(' ')}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.5"
              strokeDasharray="6 8"
              opacity="0.5"
            />

            {/* HOFTI tank at shore */}
            <g transform="translate(70,250)">
              <circle r="22" fill="#0b3b2e" stroke={SHORE_TANK.color} strokeWidth="2.5" />
              <circle r="14" fill={SHORE_TANK.color} opacity="0.25" />
              <text y="42" textAnchor="middle" fontSize="11" fill="#94a3b8">
                HOFTI 101
              </text>
            </g>

            {/* sea buoy */}
            <g transform="translate(720,120)">
              <circle r="5" fill="#f59e0b" />
              <text y="-12" textAnchor="middle" fontSize="10" fill="#94a3b8">
                Sea buoy
              </text>
            </g>

            {/* barges */}
            {bargePositions.map(({ barge, x, y, type, stemRef }) => (
              <g key={barge.id} transform={`translate(${x},${y})`}>
                <rect
                  x={-13}
                  y={-8}
                  width={26}
                  height={16}
                  rx={3}
                  fill={barge.color}
                  stroke="#0b1220"
                  strokeWidth="1.5"
                />
                <text y="-13" textAnchor="middle" fontSize="10" fontWeight="700" fill={barge.color}>
                  {barge.name}
                </text>
                <text y="24" textAnchor="middle" fontSize="9" fill="#94a3b8">
                  {type === 'idle' ? 'idle' : type}
                  {stemRef ? ` · ${stemRef}` : ''}
                </text>
              </g>
            ))}
          </svg>
          <p className="mt-1 text-[10px] text-slate-600">
            Schematic view (no external tiles). Designed for later drop-in of an AIS/marine chart
            layer via the same position model.
          </p>
        </div>

        <div className="space-y-4">
          <WeatherWidget />
          <div className="panel p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Fleet positions</h2>
            <div className="space-y-2">
              {bargePositions.map(({ barge, type, status }) => (
                <div
                  key={barge.id}
                  className="flex items-center justify-between rounded-md bg-panel-900/60 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: barge.color }}
                    />
                    <span className="text-xs font-medium text-slate-200">{barge.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">
                      {type === 'idle' ? 'Idle' : type}
                    </span>
                    <StatusBadge status={status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
