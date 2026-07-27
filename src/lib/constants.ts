import type { Barge, Product, ProductId, ShoreTank } from '@/types';

// ---------------------------------------------------------------------------
// Fleet definition (from the spec): three barges + one shore tank.
// ---------------------------------------------------------------------------

export const BARGES: Barge[] = [
  { id: 'atlas', name: 'Atlas', capacity: 6000, loadRate: 900, pumpRate: 700, color: '#3b82f6' },
  { id: 'titan', name: 'Titan', capacity: 8000, loadRate: 1100, pumpRate: 800, color: '#a855f7' },
  { id: 'orion', name: 'Orion', capacity: 4500, loadRate: 750, pumpRate: 600, color: '#f59e0b' },
];

export const SHORE_TANK: ShoreTank = {
  id: 'hofti-101',
  name: 'HOFTI Tank 101',
  capacity: 40000,
  openingInventory: 28000,
  color: '#10b981',
};

export const PRODUCTS: Product[] = [
  { id: 'VLSFO', name: 'VLSFO (0.5%)', color: '#38bdf8' },
  { id: 'HSFO', name: 'HSFO (3.5%)', color: '#f472b6' },
  { id: 'MGO', name: 'MGO', color: '#34d399' },
  { id: 'LSMGO', name: 'LSMGO (0.1%)', color: '#fbbf24' },
];

export const bargeById = (id: string): Barge | undefined =>
  BARGES.find((b) => b.id === id);

export const productById = (id: ProductId): Product | undefined =>
  PRODUCTS.find((p) => p.id === id);

// ---------------------------------------------------------------------------
// Activity timing model.
// Durations are derived from volume & barge rates where relevant, with fixed
// components for inspection and transit legs. Documented in DECISIONS.md.
// ---------------------------------------------------------------------------

export const TIMING = {
  inspectionHours: 1, // pre-loading survey / meter check
  transitHours: 2.5, // shore → customer vessel (Houston ship channel avg)
  returnTransitHours: 2.5, // customer vessel → shore
  availableBufferHours: 1, // post-return availability / reset buffer
  /** Minimum realistic transit hours; below this a leg is "impossible". */
  minTransitHours: 0.75,
} as const;

// ---------------------------------------------------------------------------
// Inventory & risk thresholds.
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  /** Shore tank low-inventory alert level (fraction of capacity). */
  tankLowFraction: 0.15,
  /** Barge considered "nearly full" above this utilization. */
  bargeHighFraction: 0.95,
  /** Fleet utilization target for optimization messaging. */
  fleetUtilizationTarget: 0.7,
} as const;

/** Palette per activity type for the scheduler bars. */
export const ACTIVITY_COLORS: Record<string, { bar: string; text: string }> = {
  Inspection: { bar: '#64748b', text: '#ffffff' },
  Loading: { bar: '#0ea5e9', text: '#ffffff' },
  Transit: { bar: '#6366f1', text: '#ffffff' },
  Delivery: { bar: '#22c55e', text: '#ffffff' },
  ReturnTransit: { bar: '#8b5cf6', text: '#ffffff' },
  Available: { bar: '#334155', text: '#cbd5e1' },
};
