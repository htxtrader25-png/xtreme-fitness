import type { ReactNode } from 'react';
import type { Priority, Severity, StemStatus } from '@/types';

// ---------------------------------------------------------------------------
// Reusable presentational primitives.
// ---------------------------------------------------------------------------

export function Panel({
  title,
  children,
  right,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      {title && (
        <header className="panel-header">
          <span>{title}</span>
          {right}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  icon?: ReactNode;
}) {
  const toneClass = {
    default: 'text-slate-100',
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    bad: 'text-rose-400',
  }[tone];
  return (
    <div className="rounded-lg border border-panel-600 bg-panel-900/60 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {label}
        </div>
        {icon && <div className="text-slate-500">{icon}</div>}
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

/** Horizontal progress / utilization bar. */
export function Meter({
  value,
  max = 1,
  color,
  height = 8,
  label,
  danger,
}: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  label?: ReactNode;
  danger?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0)) * 100;
  const barColor = danger ? '#f43f5e' : color ?? '#38bdf8';
  return (
    <div className="w-full">
      {label && (
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
          {label}
        </div>
      )}
      <div
        className="w-full overflow-hidden rounded-full bg-panel-900"
        style={{ height }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'bg-slate-600/40 text-slate-300',
  normal: 'bg-sky-600/30 text-sky-300',
  high: 'bg-amber-600/30 text-amber-300',
  critical: 'bg-rose-600/40 text-rose-200',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`chip ${PRIORITY_STYLES[priority]}`}>
      <span className="capitalize">{priority}</span>
    </span>
  );
}

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'bg-rose-600/40 text-rose-200 border border-rose-500/40',
  warning: 'bg-amber-600/30 text-amber-200 border border-amber-500/30',
  info: 'bg-sky-600/25 text-sky-200 border border-sky-500/30',
};

export function SeverityDot({ severity }: { severity: Severity }) {
  const c = { critical: 'bg-rose-500', warning: 'bg-amber-400', info: 'bg-sky-400' }[
    severity
  ];
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} />;
}

export function SeverityBadge({
  severity,
  children,
}: {
  severity: Severity;
  children: ReactNode;
}) {
  return <span className={`chip ${SEVERITY_STYLES[severity]}`}>{children}</span>;
}

const STATUS_STYLES: Record<StemStatus, string> = {
  planned: 'bg-slate-600/40 text-slate-300',
  inspecting: 'bg-slate-500/40 text-slate-200',
  loading: 'bg-sky-600/40 text-sky-200',
  'in-transit': 'bg-indigo-600/40 text-indigo-200',
  delivering: 'bg-emerald-600/40 text-emerald-200',
  returning: 'bg-violet-600/40 text-violet-200',
  completed: 'bg-slate-700/60 text-slate-400',
};

export function StatusBadge({ status }: { status: StemStatus }) {
  return (
    <span className={`chip ${STATUS_STYLES[status]}`}>
      <span className="capitalize">{status.replace('-', ' ')}</span>
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

/** Format a volume in m³ with thousands separators. */
export function m3(n: number): string {
  return `${Math.round(n).toLocaleString()} m³`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
