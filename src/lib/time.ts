import {
  addHours,
  addMinutes,
  differenceInMinutes,
  format,
  isWithinInterval,
  parseISO,
} from 'date-fns';

/** Parse an ISO string to a Date. */
export const iso = (d: string): Date => parseISO(d);

/** Serialize a Date to ISO string (stable, storage-friendly). */
export const toISO = (d: Date): string => d.toISOString();

export const fmtTime = (d: string | Date): string =>
  format(typeof d === 'string' ? parseISO(d) : d, 'HH:mm');

export const fmtDateTime = (d: string | Date): string =>
  format(typeof d === 'string' ? parseISO(d) : d, 'MMM d, HH:mm');

export const fmtDate = (d: string | Date): string =>
  format(typeof d === 'string' ? parseISO(d) : d, 'EEE, MMM d');

export const fmtDay = (d: string | Date): string =>
  format(typeof d === 'string' ? parseISO(d) : d, 'yyyy-MM-dd');

/** Duration in hours between two ISO timestamps. */
export const hoursBetween = (a: string, b: string): number =>
  differenceInMinutes(parseISO(b), parseISO(a)) / 60;

/** Minutes between two ISO timestamps. */
export const minutesBetween = (a: string, b: string): number =>
  differenceInMinutes(parseISO(b), parseISO(a));

export const addH = (d: string, h: number): string =>
  addHours(parseISO(d), h).toISOString();

export const addMin = (d: string, m: number): string =>
  addMinutes(parseISO(d), m).toISOString();

/** True if two [start,end) intervals overlap. */
export function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return parseISO(aStart) < parseISO(bEnd) && parseISO(bStart) < parseISO(aEnd);
}

/** Number of overlapping minutes between two intervals (0 if none). */
export function overlapMinutes(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): number {
  const start = Math.max(parseISO(aStart).getTime(), parseISO(bStart).getTime());
  const end = Math.min(parseISO(aEnd).getTime(), parseISO(bEnd).getTime());
  return Math.max(0, (end - start) / 60000);
}

export function withinInterval(t: string, start: string, end: string): boolean {
  return isWithinInterval(parseISO(t), {
    start: parseISO(start),
    end: parseISO(end),
  });
}

/** Round a Date down to the start of its day. */
export function startOfDayISO(d: Date): string {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.toISOString();
}

/** Human duration formatter, e.g. 2h 30m. */
export function fmtDuration(hours: number): string {
  const sign = hours < 0 ? '-' : '';
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}
