// Small deterministic-ish id helper. Uses crypto.randomUUID when available.
let counter = 0;

export function uid(prefix = 'id'): string {
  counter += 1;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}_${rand}${counter.toString(36)}`;
}

/** Sequential human-readable reference generator for stems. */
export function stemRef(seq: number): string {
  return `STM-${(1000 + seq).toString()}`;
}
