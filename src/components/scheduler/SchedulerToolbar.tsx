import { useState } from 'react';
import {
  addDays,
  addMonths,
  addWeeks,
  parseISO,
} from 'date-fns';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useFleetStore } from '@/store/useFleetStore';
import type { TimeScale } from '@/store/useFleetStore';
import { BARGES, PRODUCTS } from '@/lib/constants';
import type { Priority } from '@/types';
import { fmtDate } from '@/lib/time';

const SCALES: TimeScale[] = ['day', 'week', 'month'];
const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'critical'];

export function SchedulerToolbar({ conflictCount }: { conflictCount: number }) {
  const scale = useFleetStore((s) => s.scale);
  const anchorDate = useFleetStore((s) => s.anchorDate);
  const filters = useFleetStore((s) => s.filters);
  const setScale = useFleetStore((s) => s.setScale);
  const setAnchorDate = useFleetStore((s) => s.setAnchorDate);
  const setSearch = useFleetStore((s) => s.setSearch);
  const toggleBarge = useFleetStore((s) => s.toggleBargeFilter);
  const toggleProduct = useFleetStore((s) => s.toggleProductFilter);
  const togglePriority = useFleetStore((s) => s.togglePriorityFilter);
  const clearFilters = useFleetStore((s) => s.clearFilters);
  const openNewStem = useFleetStore((s) => s.openNewStem);

  const [showFilters, setShowFilters] = useState(false);

  const shift = (dir: number) => {
    const d = parseISO(anchorDate);
    const next =
      scale === 'day'
        ? addDays(d, dir)
        : scale === 'week'
          ? addWeeks(d, dir)
          : addMonths(d, dir);
    setAnchorDate(next.toISOString());
  };

  const goToday = () => setAnchorDate(new Date().toISOString());

  const activeFilterCount =
    (filters.barges.length < BARGES.length ? 1 : 0) +
    filters.products.length +
    filters.priorities.length;

  return (
    <div className="flex flex-col gap-2 border-b border-panel-600 bg-panel-800 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Scale switch */}
        <div className="flex rounded-md border border-panel-600 bg-panel-900 p-0.5">
          {SCALES.map((s) => (
            <button
              key={s}
              onClick={() => setScale(s)}
              className={`rounded px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                scale === s ? 'bg-accent text-panel-900' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Date nav */}
        <div className="flex items-center gap-1">
          <button className="btn-ghost !px-1.5" onClick={() => shift(-1)} title="Previous">
            <ChevronLeft size={16} />
          </button>
          <button className="btn-ghost !px-2 gap-1.5 text-xs" onClick={goToday}>
            <CalendarDays size={14} /> Today
          </button>
          <button className="btn-ghost !px-1.5" onClick={() => shift(1)} title="Next">
            <ChevronRight size={16} />
          </button>
          <span className="ml-1 text-sm font-medium text-slate-300">
            {fmtDate(anchorDate)}
          </span>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            value={filters.search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search stems, vessels…"
            className="input !py-1.5 pl-8 pr-7 w-56"
          />
          {filters.search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Filters toggle */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`btn-ghost text-xs ${showFilters ? '!bg-panel-500' : ''}`}
        >
          <Filter size={14} />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] font-bold text-panel-900">
              {activeFilterCount}
            </span>
          )}
        </button>

        {conflictCount > 0 && (
          <span className="chip bg-rose-600/30 text-rose-200">
            {conflictCount} conflict{conflictCount > 1 ? 's' : ''}
          </span>
        )}

        <button className="btn-primary text-xs" onClick={() => openNewStem()}>
          <Plus size={14} /> New Stem
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-panel-600 bg-panel-900/70 px-3 py-2 text-xs">
          <FilterGroup label="Barges">
            {BARGES.map((b) => (
              <Toggle
                key={b.id}
                active={filters.barges.includes(b.id)}
                color={b.color}
                onClick={() => toggleBarge(b.id)}
              >
                {b.name}
              </Toggle>
            ))}
          </FilterGroup>
          <FilterGroup label="Product">
            {PRODUCTS.map((p) => (
              <Toggle
                key={p.id}
                active={filters.products.length === 0 || filters.products.includes(p.id)}
                color={p.color}
                onClick={() => toggleProduct(p.id)}
              >
                {p.id}
              </Toggle>
            ))}
          </FilterGroup>
          <FilterGroup label="Priority">
            {PRIORITIES.map((p) => (
              <Toggle
                key={p}
                active={filters.priorities.length === 0 || filters.priorities.includes(p)}
                onClick={() => togglePriority(p)}
              >
                <span className="capitalize">{p}</span>
              </Toggle>
            ))}
          </FilterGroup>
          <button className="btn-ghost !py-1 text-xs" onClick={clearFilters}>
            Reset filters
          </button>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Toggle({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 transition-colors ${
        active
          ? 'border-accent/50 bg-panel-600 text-slate-100'
          : 'border-panel-600 bg-transparent text-slate-500'
      }`}
    >
      {color && (
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: active ? color : '#475569' }}
        />
      )}
      {children}
    </button>
  );
}
