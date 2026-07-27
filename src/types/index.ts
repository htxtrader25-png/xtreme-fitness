// ---------------------------------------------------------------------------
// Houston Bunker Fleet Scheduler — Domain Types
// ---------------------------------------------------------------------------
// Central, framework-agnostic domain model. All engines (inventory, constraint,
// optimization, recommendation, analytics) operate on these types so the model
// stays portable if the scheduler is later migrated to Bryntum Pro.
// ---------------------------------------------------------------------------

/** Fuel/product grades handled by the operation. */
export type ProductId = 'VLSFO' | 'HSFO' | 'MGO' | 'LSMGO';

export interface Product {
  id: ProductId;
  name: string;
  /** UI accent color. */
  color: string;
}

/** A movable asset that carries inventory: one of the three barges. */
export interface Barge {
  id: string;
  name: string;
  /** Cargo capacity in cubic meters. */
  capacity: number;
  /** Loading pump rate m³/h (shore → barge). */
  loadRate: number;
  /** Delivery pump rate m³/h (barge → customer vessel). */
  pumpRate: number;
  /** Average sailing speed used to schematically position the barge. */
  color: string;
}

/** The shore tank (HOFTI Tank 101). */
export interface ShoreTank {
  id: string;
  name: string;
  capacity: number;
  /** Opening inventory at the start of the planning horizon. */
  openingInventory: number;
  /** Replenishment deliveries into the tank (e.g. terminal receipts). */
  color: string;
}

/** Priority ranking for a stem (commercial urgency). */
export type Priority = 'low' | 'normal' | 'high' | 'critical';

/** Lifecycle activity types generated for every stem, in order. */
export type ActivityType =
  | 'Inspection'
  | 'Loading'
  | 'Transit'
  | 'Delivery'
  | 'ReturnTransit'
  | 'Available';

export const ACTIVITY_ORDER: ActivityType[] = [
  'Inspection',
  'Loading',
  'Transit',
  'Delivery',
  'ReturnTransit',
  'Available',
];

/** A single scheduled activity on a barge timeline. */
export interface Activity {
  id: string;
  stemId: string;
  bargeId: string;
  type: ActivityType;
  /** ISO strings — serializable for persistence. */
  start: string;
  end: string;
  /** Whether this activity has been manually pinned (won't auto-recalc). */
  locked?: boolean;
}

/** A bunker stem — the core commercial order. */
export interface Stem {
  id: string;
  /** Human-readable reference, e.g. STM-1042. */
  ref: string;
  customer: string;
  vessel: string;
  product: ProductId;
  /** Ordered volume in m³. */
  volume: number;
  /** Delivery window (customer-agreed laycan). */
  windowStart: string;
  windowEnd: string;
  priority: Priority;
  bargeId: string;
  notes: string;
  createdAt: string;
  /** Current derived lifecycle status. */
  status: StemStatus;
}

export type StemStatus =
  | 'planned'
  | 'inspecting'
  | 'loading'
  | 'in-transit'
  | 'delivering'
  | 'returning'
  | 'completed';

/** A maintenance / out-of-service block on a barge. */
export interface MaintenanceBlock {
  id: string;
  bargeId: string;
  start: string;
  end: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Constraint / conflict engine
// ---------------------------------------------------------------------------

export type ConflictType =
  | 'overlap'
  | 'low-inventory'
  | 'capacity-exceeded'
  | 'window-violation'
  | 'maintenance-conflict'
  | 'impossible-transit';

export type Severity = 'critical' | 'warning' | 'info';

export interface Conflict {
  id: string;
  type: ConflictType;
  severity: Severity;
  message: string;
  /** Activities / stems / resources implicated. */
  stemId?: string;
  activityIds: string[];
  bargeId?: string;
  /** When in the timeline the problem occurs. */
  at?: string;
  /** Concrete suggested fix (human readable). */
  suggestion?: string;
}

// ---------------------------------------------------------------------------
// Inventory engine
// ---------------------------------------------------------------------------

/** Snapshot of the whole operation's inventory at a moment in time. */
export interface InventorySnapshot {
  at: string;
  tank: {
    id: string;
    level: number;
    capacity: number;
    utilization: number;
  };
  barges: Array<{
    id: string;
    name: string;
    level: number;
    capacity: number;
    remaining: number;
    utilization: number;
  }>;
  fleetLevel: number;
  fleetCapacity: number;
  fleetRemaining: number;
  fleetUtilization: number;
}

/** A discrete inventory-changing event on the timeline. */
export interface InventoryEvent {
  at: string;
  tankDelta: number;
  bargeId: string;
  bargeDelta: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Optimization engine
// ---------------------------------------------------------------------------

export interface BargeUtilization {
  bargeId: string;
  name: string;
  horizonHours: number;
  idleHours: number;
  waitingHours: number;
  sailingHours: number;
  loadingHours: number;
  deliveringHours: number;
  inspectingHours: number;
  utilization: number; // busy / horizon
}

export interface FleetUtilization {
  horizonStart: string;
  horizonEnd: string;
  horizonHours: number;
  perBarge: BargeUtilization[];
  fleetUtilization: number;
  totalIdleHours: number;
  totalWaitingHours: number;
  totalSailingHours: number;
  totalLoadingHours: number;
  totalDeliveringHours: number;
}

export type OptimizationKind =
  | 'swap-barge'
  | 'shift-departure'
  | 'consolidate'
  | 'reduce-idle';

export interface OptimizationSuggestion {
  id: string;
  kind: OptimizationKind;
  title: string;
  reasoning: string;
  /** Estimated improvement in fleet utilization (percentage points). */
  estimatedUtilizationGain: number;
  /** Estimated idle hours removed. */
  estimatedIdleReduction: number;
  stemId?: string;
  fromBargeId?: string;
  toBargeId?: string;
  /** Proposed new start (ISO) for a shift suggestion. */
  proposedStart?: string;
  /** Whether the app can apply this automatically. */
  applicable: boolean;
}

// ---------------------------------------------------------------------------
// AI recommendation engine
// ---------------------------------------------------------------------------

export type RecommendationCategory =
  | 'barge-assignment'
  | 'inventory-risk'
  | 'conflict-resolution'
  | 'commercial-impact'
  | 'utilization';

export interface Recommendation {
  id: string;
  category: RecommendationCategory;
  severity: Severity;
  title: string;
  /** The always-required reasoning. */
  reasoning: string;
  /** Optional structured action the UI can apply. */
  action?: {
    label: string;
    kind: 'reassign-barge' | 'shift-stem' | 'resolve-conflict' | 'none';
    stemId?: string;
    toBargeId?: string;
    proposedStart?: string;
  };
  stemId?: string;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface AnalyticsKpis {
  deliveriesToday: number;
  tankUtilization: number;
  fleetUtilization: number;
  idleHours: number;
  conflictCount: number;
  atRiskDeliveries: number;
  totalStems: number;
  volumeScheduled: number;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export interface WeatherState {
  at: string;
  windKts: number;
  gustKts: number;
  waveFt: number;
  visibilityNm: number;
  condition: 'calm' | 'moderate' | 'rough' | 'restricted';
  /** Whether ops are advised to hold. */
  advisory: string | null;
}

// ---------------------------------------------------------------------------
// Scenario / what-if
// ---------------------------------------------------------------------------

/** A serializable snapshot of the plan used for scenarios & replay. */
export interface PlanState {
  stems: Stem[];
  activities: Activity[];
  maintenance: MaintenanceBlock[];
}

export interface Scenario {
  id: string;
  name: string;
  createdAt: string;
  base: PlanState;
  draft: PlanState;
}
