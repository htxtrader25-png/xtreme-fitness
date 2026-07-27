import {
  format,
  getDaysInMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { TimeScale } from '@/store/useFleetStore';

// ---------------------------------------------------------------------------
// DayPilot time bridging.
//
// The app stores absolute ISO timestamps (UTC). DayPilot works in timezone-less
// wall-clock. These helpers convert between the two using the browser's local
// zone so the timeline reads in local operational time and round-trips cleanly.
// ---------------------------------------------------------------------------

/** ISO (absolute) → DayPilot local wall-clock string "yyyy-MM-ddTHH:mm:ss". */
export const toDp = (isoStr: string): string =>
  format(parseISO(isoStr), "yyyy-MM-dd'T'HH:mm:ss");

/** DayPilot local wall-clock string → absolute ISO string. */
export const fromDp = (dp: string): string => parseISO(dp).toISOString();

export interface DpConfig {
  startDate: string;
  days: number;
  scale: 'Hour' | 'Day';
  cellWidth: number;
  timeHeaders: Array<{ groupBy: string; format?: string }>;
}

/** Build a DayPilot scheduler configuration for the given view scale. */
export function schedulerConfig(scale: TimeScale, anchorISO: string): DpConfig {
  const anchor = parseISO(anchorISO);
  switch (scale) {
    case 'day':
      return {
        startDate: format(anchor, 'yyyy-MM-dd'),
        days: 1,
        scale: 'Hour',
        cellWidth: 80,
        timeHeaders: [
          { groupBy: 'Day', format: 'dddd, MMMM d' },
          { groupBy: 'Hour', format: 'h tt' },
        ],
      };
    case 'week': {
      const s = startOfWeek(anchor, { weekStartsOn: 1 });
      return {
        startDate: format(s, 'yyyy-MM-dd'),
        days: 7,
        scale: 'Hour',
        cellWidth: 34,
        timeHeaders: [
          { groupBy: 'Day', format: 'ddd M/d' },
          { groupBy: 'Hour', format: 'H' },
        ],
      };
    }
    case 'month':
    default: {
      const s = startOfMonth(anchor);
      return {
        startDate: format(s, 'yyyy-MM-dd'),
        days: getDaysInMonth(anchor),
        scale: 'Day',
        cellWidth: 54,
        timeHeaders: [
          { groupBy: 'Month', format: 'MMMM yyyy' },
          { groupBy: 'Day', format: 'd' },
        ],
      };
    }
  }
}
