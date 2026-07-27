import { useEffect, useMemo, useRef } from 'react';
import { DayPilot, DayPilotScheduler } from '@daypilot/daypilot-lite-react';
import { useFleetStore } from '@/store/useFleetStore';
import { useDerived } from '@/store/useDerived';
import { BARGES } from '@/lib/constants';
import { ACTIVITY_COLORS } from '@/lib/constants';
import type { Activity, Stem } from '@/types';
import { fromDp, schedulerConfig, toDp } from './dp';

// ---------------------------------------------------------------------------
// Fleet Scheduler — resource timeline built on the DayPilot Scheduler.
// Supports drag/move (incl. cross-barge reassignment), resize, drag-to-create,
// context-menu copy/delete/edit, day/week/month scales, a current-time cell
// marker, filters, search dimming and conflict highlighting.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = any;

function withAlpha(hex: string, alpha: string): string {
  return hex.length === 7 ? `${hex}${alpha}` : hex;
}

export function FleetScheduler() {
  const schedRef = useRef<DayPilotScheduler>(null);
  const { plan, conflictActivityIds, now } = useDerived();

  const scale = useFleetStore((s) => s.scale);
  const anchorDate = useFleetStore((s) => s.anchorDate);
  const filters = useFleetStore((s) => s.filters);
  const selectedStemId = useFleetStore((s) => s.selectedStemId);
  const focusActivityIds = useFleetStore((s) => s.focusActivityIds);

  const selectStem = useFleetStore((s) => s.selectStem);
  const moveActivity = useFleetStore((s) => s.moveActivity);
  const resizeActivity = useFleetStore((s) => s.resizeActivity);
  const openNewStem = useFleetStore((s) => s.openNewStem);
  const openEditStem = useFleetStore((s) => s.openEditStem);
  const duplicateStem = useFleetStore((s) => s.duplicateStem);
  const deleteStem = useFleetStore((s) => s.deleteStem);

  const config = useMemo(() => schedulerConfig(scale, anchorDate), [scale, anchorDate]);

  const stemById = useMemo(() => {
    const m = new Map<string, Stem>();
    for (const s of plan.stems) m.set(s.id, s);
    return m;
  }, [plan.stems]);

  // --- Resources (barges), filtered by visibility ---
  const resources = useMemo(
    () =>
      BARGES.filter((b) => filters.barges.includes(b.id)).map((b) => ({
        id: b.id,
        name: `${b.name}  ·  ${b.capacity.toLocaleString()} m³`,
      })),
    [filters.barges],
  );

  // --- Events (activities + maintenance) ---
  const events = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const matchesSearch = (stem: Stem | undefined): boolean => {
      if (!search) return true;
      if (!stem) return false;
      return (
        stem.ref.toLowerCase().includes(search) ||
        stem.customer.toLowerCase().includes(search) ||
        stem.vessel.toLowerCase().includes(search) ||
        stem.product.toLowerCase().includes(search)
      );
    };

    const activityEvents = plan.activities
      .filter((a) => filters.barges.includes(a.bargeId))
      .filter((a) => {
        const stem = stemById.get(a.stemId);
        if (!stem) return false;
        if (filters.products.length && !filters.products.includes(stem.product))
          return false;
        if (filters.priorities.length && !filters.priorities.includes(stem.priority))
          return false;
        return true;
      })
      .map((a) => buildEvent(a, stemById.get(a.stemId), {
        conflicted: conflictActivityIds.has(a.id),
        selected: selectedStemId === a.stemId,
        focused: focusActivityIds.includes(a.id),
        dimmed: !!search && !matchesSearch(stemById.get(a.stemId)),
      }));

    const maintenanceEvents = plan.maintenance
      .filter((m) => filters.barges.includes(m.bargeId))
      .map((m) => ({
        id: m.id,
        text: `⚙ ${m.reason}`,
        start: toDp(m.start),
        end: toDp(m.end),
        resource: m.bargeId,
        backColor: '#3f3f46',
        barColor: '#71717a',
        fontColor: '#e4e4e7',
        borderColor: '#52525b',
        cssClass: 'dp-maintenance',
        moveDisabled: true,
        resizeDisabled: true,
        tags: { kind: 'maintenance' },
      }));

    return [...activityEvents, ...maintenanceEvents];
  }, [
    plan.activities,
    plan.maintenance,
    stemById,
    filters,
    conflictActivityIds,
    selectedStemId,
    focusActivityIds,
  ]);

  // --- Current-time marker + initial scroll ---
  const nowLocal = useMemo(() => toDp(now.toISOString()), [now]);

  useEffect(() => {
    const control = schedRef.current?.control;
    if (!control) return;
    try {
      control.scrollTo(nowLocal);
    } catch {
      /* scrollTo not critical */
    }
    // Only scroll on scale/anchor change, not every clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, anchorDate]);

  const onBeforeCellRender = (args: Args) => {
    try {
      const cellStart = fromDp(args.cell.start.toString());
      const cellEnd = fromDp(args.cell.end.toString());
      const t = now.getTime();
      if (t >= new Date(cellStart).getTime() && t < new Date(cellEnd).getTime()) {
        args.cell.properties.backColor = 'rgba(244,63,94,0.14)';
        args.cell.properties.cssClass = 'dp-now-cell';
      }
    } catch {
      /* ignore */
    }
  };

  const onEventMoved = (args: Args) => {
    const id = args.e.id() as string;
    const newStart = fromDp(args.newStart.toString());
    const newResource = args.newResource as string | undefined;
    if (args.e.data?.tags?.kind === 'maintenance') return;
    moveActivity(id, newStart, newResource);
  };

  const onEventResized = (args: Args) => {
    const id = args.e.id() as string;
    if (args.e.data?.tags?.kind === 'maintenance') return;
    resizeActivity(id, fromDp(args.newStart.toString()), fromDp(args.newEnd.toString()));
  };

  const onEventClicked = (args: Args) => {
    const stemId = args.e.data?.tags?.stemId as string | undefined;
    if (stemId) selectStem(stemId);
  };

  const onTimeRangeSelected = (args: Args) => {
    const control = args.control ?? schedRef.current?.control;
    control?.clearSelection?.();
    openNewStem({
      bargeId: args.resource as string,
      windowStart: fromDp(args.start.toString()),
      windowEnd: fromDp(args.end.toString()),
    });
  };

  const contextMenu = useMemo(
    () =>
      new DayPilot.Menu({
        items: [
          {
            text: 'Edit stem…',
            onClick: (args: Args) => {
              const stemId = args.source.data?.tags?.stemId;
              if (stemId) openEditStem(stemId);
            },
          },
          {
            text: 'Duplicate stem (+24h)',
            onClick: (args: Args) => {
              const stemId = args.source.data?.tags?.stemId;
              if (stemId) duplicateStem(stemId);
            },
          },
          { text: '-' },
          {
            text: 'Delete stem',
            onClick: (args: Args) => {
              const stemId = args.source.data?.tags?.stemId;
              if (stemId) deleteStem(stemId);
            },
          },
        ],
      }),
    [openEditStem, duplicateStem, deleteStem],
  );

  return (
    <div className="dp-dark h-full overflow-auto">
      <DayPilotScheduler
        ref={schedRef}
        startDate={config.startDate}
        days={config.days}
        scale={config.scale}
        cellWidth={config.cellWidth}
        timeHeaders={config.timeHeaders as never}
        eventHeight={34}
        headerHeight={34}
        rowHeaderWidth={160}
        durationBarVisible
        resources={resources}
        events={events}
        contextMenu={contextMenu}
        eventMoveHandling="Update"
        eventResizeHandling="Update"
        timeRangeSelectedHandling="Enabled"
        eventClickHandling="Enabled"
        onBeforeCellRender={onBeforeCellRender}
        onEventMoved={onEventMoved}
        onEventResized={onEventResized}
        onEventClicked={onEventClicked}
        onTimeRangeSelected={onTimeRangeSelected}
      />
    </div>
  );
}

function buildEvent(
  a: Activity,
  stem: Stem | undefined,
  state: { conflicted: boolean; selected: boolean; focused: boolean; dimmed: boolean },
) {
  const colors = ACTIVITY_COLORS[a.type] ?? { bar: '#38bdf8', text: '#fff' };
  const classes: string[] = [];
  if (state.conflicted) classes.push('dp-conflict');
  if (state.selected) classes.push('dp-selected-stem');
  if (state.focused) classes.push('dp-focused');
  if (state.dimmed) classes.push('dp-dimmed');

  const label = stem ? `${stem.ref} · ${a.type}` : a.type;

  return {
    id: a.id,
    text: label,
    start: toDp(a.start),
    end: toDp(a.end),
    resource: a.bargeId,
    backColor: withAlpha(colors.bar, state.dimmed ? '33' : 'e6'),
    barColor: colors.bar,
    fontColor: '#ffffff',
    borderColor: state.conflicted ? '#f43f5e' : 'rgba(255,255,255,0.15)',
    cssClass: classes.join(' '),
    tags: {
      stemId: a.stemId,
      type: a.type,
      kind: 'activity',
      priority: stem?.priority,
    },
  };
}
