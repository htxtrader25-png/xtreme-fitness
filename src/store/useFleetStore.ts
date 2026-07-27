import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Activity,
  MaintenanceBlock,
  PlanState,
  Priority,
  ProductId,
  Scenario,
  Stem,
} from '@/types';
import { BARGES, bargeById } from '@/lib/constants';
import { stemRef, uid } from '@/lib/id';
import { addH } from '@/lib/time';
import {
  generateActivities,
  reassignStemBarge,
  recalcChain,
} from '@/domain/activities';
import { buildSeedPlan, todayMidnightISO } from '@/domain/seed';

export type TimeScale = 'day' | 'week' | 'month';
export type ModalKind = 'new' | 'edit' | null;

export interface StemInput {
  customer: string;
  vessel: string;
  product: ProductId;
  volume: number;
  windowStart: string;
  windowEnd: string;
  priority: Priority;
  bargeId: string;
  notes: string;
}

export interface Filters {
  barges: string[]; // visible barge ids
  products: ProductId[]; // visible products ([] = all)
  priorities: Priority[]; // visible priorities ([] = all)
  search: string;
}

export interface ReplayState {
  active: boolean;
  atMs: number;
  playing: boolean;
  /** Simulated hours advanced per real second while playing. */
  speed: number;
}

interface FleetState {
  // --- Live plan ---
  stems: Stem[];
  activities: Activity[];
  maintenance: MaintenanceBlock[];

  // --- Scenarios ---
  scenarios: Scenario[];
  activeScenarioId: string | null;

  // --- Clock ---
  clockMs: number;

  // --- UI state ---
  selectedStemId: string | null;
  focusActivityIds: string[];
  modal: ModalKind;
  pendingDraft: { bargeId: string; windowStart: string; windowEnd: string } | null;
  editingStemId: string | null;

  // --- Scheduler view ---
  scale: TimeScale;
  anchorDate: string; // ISO date the scheduler starts from
  filters: Filters;

  // --- Replay ---
  replay: ReplayState;

  // --- Actions ---
  setClock: (ms: number) => void;
  effectivePlan: () => PlanState;
  isScenario: () => boolean;

  addStem: (input: StemInput) => string;
  updateStem: (id: string, input: StemInput) => void;
  deleteStem: (id: string) => void;
  duplicateStem: (id: string) => void;

  moveActivity: (activityId: string, newStart: string, newBargeId?: string) => void;
  resizeActivity: (activityId: string, newStart: string, newEnd: string) => void;

  reassignStem: (stemId: string, toBargeId: string) => void;
  shiftStem: (stemId: string, newStart: string) => void;

  addMaintenance: (m: Omit<MaintenanceBlock, 'id'>) => void;
  deleteMaintenance: (id: string) => void;

  // UI
  selectStem: (id: string | null) => void;
  setFocus: (ids: string[]) => void;
  openNewStem: (draft?: { bargeId: string; windowStart: string; windowEnd: string }) => void;
  openEditStem: (id: string) => void;
  closeModal: () => void;

  setScale: (s: TimeScale) => void;
  setAnchorDate: (iso: string) => void;
  toggleBargeFilter: (id: string) => void;
  toggleProductFilter: (p: ProductId) => void;
  togglePriorityFilter: (p: Priority) => void;
  setSearch: (q: string) => void;
  clearFilters: () => void;

  // Replay
  setReplayActive: (active: boolean) => void;
  setReplayTime: (ms: number) => void;
  setReplayPlaying: (playing: boolean) => void;
  setReplaySpeed: (speed: number) => void;

  // Scenarios
  createScenario: (name: string) => string;
  enterScenario: (id: string) => void;
  exitScenario: () => void;
  deleteScenario: (id: string) => void;
  resetScenarioDraft: (id: string) => void;
  applyScenarioToLive: (id: string) => void;

  // Data ops
  resetToSeed: () => void;
  importPlan: (plan: PlanState) => void;
}

const seed = buildSeedPlan();

function defaultFilters(): Filters {
  return { barges: BARGES.map((b) => b.id), products: [], priorities: [], search: '' };
}

/** Build a stem + its generated activities from raw input. */
function makeStem(input: StemInput, seq: number): { stem: Stem; activities: Activity[] } {
  const stem: Stem = {
    id: uid('stem'),
    ref: stemRef(seq),
    customer: input.customer,
    vessel: input.vessel,
    product: input.product,
    volume: input.volume,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    priority: input.priority,
    bargeId: input.bargeId,
    notes: input.notes,
    createdAt: new Date().toISOString(),
    status: 'planned',
  };
  return { stem, activities: generateActivities(stem) };
}

export const useFleetStore = create<FleetState>()(
  persist(
    (set, get) => {
      /**
       * Apply a pure transform to whichever plan is active (live or scenario
       * draft) and write it back to the correct place.
       */
      const mutatePlan = (fn: (plan: PlanState) => PlanState) => {
        const state = get();
        if (state.activeScenarioId) {
          set({
            scenarios: state.scenarios.map((sc) =>
              sc.id === state.activeScenarioId
                ? { ...sc, draft: fn(sc.draft) }
                : sc,
            ),
          });
        } else {
          const next = fn({
            stems: state.stems,
            activities: state.activities,
            maintenance: state.maintenance,
          });
          set({
            stems: next.stems,
            activities: next.activities,
            maintenance: next.maintenance,
          });
        }
      };

      return {
        stems: seed.stems,
        activities: seed.activities,
        maintenance: seed.maintenance,
        scenarios: [],
        activeScenarioId: null,
        clockMs: Date.now(),
        selectedStemId: null,
        focusActivityIds: [],
        modal: null,
        pendingDraft: null,
        editingStemId: null,
        scale: 'day',
        anchorDate: todayMidnightISO(),
        filters: defaultFilters(),
        replay: {
          active: false,
          atMs: Date.now(),
          playing: false,
          speed: 1.5,
        },

        setClock: (ms) => set({ clockMs: ms }),

        effectivePlan: () => {
          const s = get();
          if (s.activeScenarioId) {
            const sc = s.scenarios.find((x) => x.id === s.activeScenarioId);
            if (sc) return sc.draft;
          }
          return { stems: s.stems, activities: s.activities, maintenance: s.maintenance };
        },

        isScenario: () => get().activeScenarioId !== null,

        addStem: (input) => {
          const seq = seedSeq(get());
          const { stem, activities } = makeStem(input, seq);
          mutatePlan((plan) => ({
            ...plan,
            stems: [...plan.stems, stem],
            activities: [...plan.activities, ...activities],
          }));
          set({ selectedStemId: stem.id, modal: null, pendingDraft: null });
          return stem.id;
        },

        updateStem: (id, input) => {
          mutatePlan((plan) => {
            const existing = plan.stems.find((s) => s.id === id);
            if (!existing) return plan;
            const updated: Stem = { ...existing, ...input };
            // Regenerate activities from scratch to honor new volume/barge/window.
            const others = plan.activities.filter((a) => a.stemId !== id);
            const newActs = generateActivities(updated);
            return {
              ...plan,
              stems: plan.stems.map((s) => (s.id === id ? updated : s)),
              activities: [...others, ...newActs],
            };
          });
          set({ modal: null, editingStemId: null });
        },

        deleteStem: (id) => {
          mutatePlan((plan) => ({
            ...plan,
            stems: plan.stems.filter((s) => s.id !== id),
            activities: plan.activities.filter((a) => a.stemId !== id),
          }));
          set((s) => ({
            selectedStemId: s.selectedStemId === id ? null : s.selectedStemId,
            modal: null,
            editingStemId: null,
          }));
        },

        duplicateStem: (id) => {
          const seq = seedSeq(get());
          let newId = '';
          mutatePlan((plan) => {
            const src = plan.stems.find((s) => s.id === id);
            if (!src) return plan;
            const copy: Stem = {
              ...src,
              id: uid('stem'),
              ref: stemRef(seq),
              windowStart: addH(src.windowStart, 24),
              windowEnd: addH(src.windowEnd, 24),
              createdAt: new Date().toISOString(),
              status: 'planned',
            };
            newId = copy.id;
            return {
              ...plan,
              stems: [...plan.stems, copy],
              activities: [...plan.activities, ...generateActivities(copy)],
            };
          });
          if (newId) set({ selectedStemId: newId });
        },

        moveActivity: (activityId, newStart, newBargeId) => {
          mutatePlan((plan) => {
            const act = plan.activities.find((a) => a.id === activityId);
            if (!act) return plan;

            // Cross-row drag → reassign the whole stem to the new barge.
            if (newBargeId && newBargeId !== act.bargeId) {
              const newBarge = bargeById(newBargeId);
              const stem = plan.stems.find((s) => s.id === act.stemId);
              if (newBarge && stem) {
                const chain = plan.activities.filter((a) => a.stemId === act.stemId);
                const reassigned = reassignStemBarge(chain, stem, newBarge);
                const others = plan.activities.filter((a) => a.stemId !== act.stemId);
                return {
                  ...plan,
                  stems: plan.stems.map((s) =>
                    s.id === stem.id ? { ...s, bargeId: newBarge.id } : s,
                  ),
                  activities: [...others, ...reassigned],
                };
              }
            }

            const chain = plan.activities.filter((a) => a.stemId === act.stemId);
            const recalced = recalcChain(chain, activityId, newStart);
            const others = plan.activities.filter((a) => a.stemId !== act.stemId);
            return { ...plan, activities: [...others, ...recalced] };
          });
        },

        resizeActivity: (activityId, newStart, newEnd) => {
          mutatePlan((plan) => {
            const act = plan.activities.find((a) => a.id === activityId);
            if (!act) return plan;
            const chain = plan.activities.filter((a) => a.stemId === act.stemId);
            const recalced = recalcChain(chain, activityId, newStart, newEnd);
            const others = plan.activities.filter((a) => a.stemId !== act.stemId);
            return { ...plan, activities: [...others, ...recalced] };
          });
        },

        reassignStem: (stemId, toBargeId) => {
          mutatePlan((plan) => {
            const stem = plan.stems.find((s) => s.id === stemId);
            const newBarge = bargeById(toBargeId);
            if (!stem || !newBarge) return plan;
            const chain = plan.activities.filter((a) => a.stemId === stemId);
            const reassigned = reassignStemBarge(chain, stem, newBarge);
            const others = plan.activities.filter((a) => a.stemId !== stemId);
            return {
              ...plan,
              stems: plan.stems.map((s) =>
                s.id === stemId ? { ...s, bargeId: toBargeId } : s,
              ),
              activities: [...others, ...reassigned],
            };
          });
        },

        shiftStem: (stemId, newStart) => {
          mutatePlan((plan) => {
            const chain = plan.activities.filter((a) => a.stemId === stemId);
            if (chain.length === 0) return plan;
            const firstId = [...chain].sort(
              (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
            )[0].id;
            const recalced = recalcChain(chain, firstId, newStart);
            const others = plan.activities.filter((a) => a.stemId !== stemId);
            return { ...plan, activities: [...others, ...recalced] };
          });
        },

        addMaintenance: (m) =>
          mutatePlan((plan) => ({
            ...plan,
            maintenance: [...plan.maintenance, { ...m, id: uid('mnt') }],
          })),

        deleteMaintenance: (id) =>
          mutatePlan((plan) => ({
            ...plan,
            maintenance: plan.maintenance.filter((m) => m.id !== id),
          })),

        selectStem: (id) => set({ selectedStemId: id }),
        setFocus: (ids) => set({ focusActivityIds: ids }),

        openNewStem: (draft) =>
          set({ modal: 'new', pendingDraft: draft ?? null }),
        openEditStem: (id) => set({ modal: 'edit', editingStemId: id }),
        closeModal: () => set({ modal: null, pendingDraft: null, editingStemId: null }),

        setScale: (scale) => set({ scale }),
        setAnchorDate: (anchorDate) => set({ anchorDate }),
        toggleBargeFilter: (id) =>
          set((s) => ({
            filters: {
              ...s.filters,
              barges: s.filters.barges.includes(id)
                ? s.filters.barges.filter((b) => b !== id)
                : [...s.filters.barges, id],
            },
          })),
        toggleProductFilter: (p) =>
          set((s) => ({
            filters: {
              ...s.filters,
              products: s.filters.products.includes(p)
                ? s.filters.products.filter((x) => x !== p)
                : [...s.filters.products, p],
            },
          })),
        togglePriorityFilter: (p) =>
          set((s) => ({
            filters: {
              ...s.filters,
              priorities: s.filters.priorities.includes(p)
                ? s.filters.priorities.filter((x) => x !== p)
                : [...s.filters.priorities, p],
            },
          })),
        setSearch: (q) => set((s) => ({ filters: { ...s.filters, search: q } })),
        clearFilters: () => set({ filters: defaultFilters() }),

        setReplayActive: (active) =>
          set((s) => ({
            replay: { ...s.replay, active, playing: active ? s.replay.playing : false },
          })),
        setReplayTime: (atMs) => set((s) => ({ replay: { ...s.replay, atMs } })),
        setReplayPlaying: (playing) =>
          set((s) => ({ replay: { ...s.replay, playing } })),
        setReplaySpeed: (speed) => set((s) => ({ replay: { ...s.replay, speed } })),

        createScenario: (name) => {
          const s = get();
          const base: PlanState = {
            stems: s.stems,
            activities: s.activities,
            maintenance: s.maintenance,
          };
          const scenario: Scenario = {
            id: uid('scn'),
            name,
            createdAt: new Date().toISOString(),
            base: structuredClone(base),
            draft: structuredClone(base),
          };
          set({ scenarios: [...s.scenarios, scenario], activeScenarioId: scenario.id });
          return scenario.id;
        },
        enterScenario: (id) => set({ activeScenarioId: id }),
        exitScenario: () => set({ activeScenarioId: null }),
        deleteScenario: (id) =>
          set((s) => ({
            scenarios: s.scenarios.filter((x) => x.id !== id),
            activeScenarioId: s.activeScenarioId === id ? null : s.activeScenarioId,
          })),
        resetScenarioDraft: (id) =>
          set((s) => ({
            scenarios: s.scenarios.map((sc) =>
              sc.id === id ? { ...sc, draft: structuredClone(sc.base) } : sc,
            ),
          })),
        applyScenarioToLive: (id) => {
          const s = get();
          const sc = s.scenarios.find((x) => x.id === id);
          if (!sc) return;
          const draft = structuredClone(sc.draft);
          set({
            stems: draft.stems,
            activities: draft.activities,
            maintenance: draft.maintenance,
            activeScenarioId: null,
          });
        },

        resetToSeed: () => {
          const fresh = buildSeedPlan();
          set({
            stems: fresh.stems,
            activities: fresh.activities,
            maintenance: fresh.maintenance,
            scenarios: [],
            activeScenarioId: null,
            selectedStemId: null,
            filters: defaultFilters(),
            anchorDate: todayMidnightISO(),
          });
        },

        importPlan: (plan) =>
          set({
            stems: plan.stems,
            activities: plan.activities,
            maintenance: plan.maintenance,
            activeScenarioId: null,
            selectedStemId: null,
          }),
      };
    },
    {
      name: 'houston-bunker-fleet-scheduler:v1',
      version: 1,
      partialize: (s) => ({
        stems: s.stems,
        activities: s.activities,
        maintenance: s.maintenance,
        scenarios: s.scenarios,
        scale: s.scale,
        anchorDate: s.anchorDate,
        filters: s.filters,
      }),
    },
  ),
);

/** Next sequence number for a new stem ref, across live + scenarios. */
function seedSeq(state: FleetState): number {
  const all = [
    ...state.stems,
    ...state.scenarios.flatMap((sc) => [...sc.base.stems, ...sc.draft.stems]),
  ];
  let max = -1;
  for (const s of all) {
    const n = parseInt(s.ref.replace('STM-', ''), 10);
    if (!Number.isNaN(n)) max = Math.max(max, n - 1000);
  }
  return max + 1;
}
