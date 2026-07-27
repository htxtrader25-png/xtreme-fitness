import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { useFleetStore } from '@/store/useFleetStore';
import type { StemInput } from '@/store/useFleetStore';
import { usePlan } from '@/store/useDerived';
import { BARGES, PRODUCTS, SHORE_TANK, bargeById } from '@/lib/constants';
import type { Priority, ProductId, Stem } from '@/types';
import { generateActivities } from '@/domain/activities';
import { previewImpact } from '@/domain/inventory';
import { Meter, m3, pct } from '@/components/common/ui';
import { addH, fmtDateTime } from '@/lib/time';

const toLocalInput = (isoStr: string): string =>
  format(parseISO(isoStr), "yyyy-MM-dd'T'HH:mm");
const fromLocalInput = (v: string): string => parseISO(v).toISOString();

const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'critical'];

function defaultInput(draft: {
  bargeId: string;
  windowStart: string;
  windowEnd: string;
} | null): StemInput {
  const start = draft?.windowStart ?? addH(new Date().toISOString(), 2);
  return {
    customer: '',
    vessel: '',
    product: 'VLSFO',
    volume: 1500,
    windowStart: start,
    windowEnd: draft?.windowEnd ?? addH(start, 4),
    priority: 'normal',
    bargeId: draft?.bargeId ?? BARGES[0].id,
    notes: '',
  };
}

export function StemModal() {
  const modal = useFleetStore((s) => s.modal);
  const pendingDraft = useFleetStore((s) => s.pendingDraft);
  const editingStemId = useFleetStore((s) => s.editingStemId);
  const closeModal = useFleetStore((s) => s.closeModal);
  const addStem = useFleetStore((s) => s.addStem);
  const updateStem = useFleetStore((s) => s.updateStem);
  const deleteStem = useFleetStore((s) => s.deleteStem);
  const plan = usePlan();

  const editingStem = editingStemId
    ? plan.stems.find((s) => s.id === editingStemId)
    : undefined;

  const [input, setInput] = useState<StemInput>(() =>
    editingStem
      ? {
          customer: editingStem.customer,
          vessel: editingStem.vessel,
          product: editingStem.product,
          volume: editingStem.volume,
          windowStart: editingStem.windowStart,
          windowEnd: editingStem.windowEnd,
          priority: editingStem.priority,
          bargeId: editingStem.bargeId,
          notes: editingStem.notes,
        }
      : defaultInput(pendingDraft),
  );

  const barge = bargeById(input.bargeId);
  const set = <K extends keyof StemInput>(key: K, value: StemInput[K]) =>
    setInput((prev) => ({ ...prev, [key]: value }));

  // --- Live inventory-impact preview ---
  const preview = useMemo(() => {
    const candidate: Stem = {
      id: editingStem?.id ?? 'preview',
      ref: editingStem?.ref ?? 'PREVIEW',
      ...input,
      createdAt: new Date().toISOString(),
      status: 'planned',
    };
    const acts = generateActivities(candidate);
    // Compare against the plan WITHOUT the stem being edited.
    const basePlan = editingStem
      ? {
          ...plan,
          stems: plan.stems.filter((s) => s.id !== editingStem.id),
          activities: plan.activities.filter((a) => a.stemId !== editingStem.id),
        }
      : plan;
    return previewImpact(basePlan, candidate, acts, BARGES, SHORE_TANK);
  }, [input, editingStem, plan]);

  const errors: string[] = [];
  if (!input.customer.trim()) errors.push('Customer is required.');
  if (!input.vessel.trim()) errors.push('Vessel is required.');
  if (input.volume <= 0) errors.push('Volume must be greater than zero.');
  if (parseISO(input.windowEnd) <= parseISO(input.windowStart))
    errors.push('Delivery window end must be after its start.');
  if (barge && input.volume > barge.capacity)
    errors.push(`Volume exceeds ${barge.name} capacity (${m3(barge.capacity)}).`);

  const valid = errors.length === 0;

  const submit = () => {
    if (!valid) return;
    if (editingStem) updateStem(editingStem.id, input);
    else addStem(input);
  };

  if (modal !== 'new' && modal !== 'edit') return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={closeModal}
    >
      <div
        className="panel w-full max-w-3xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-panel-600 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              {editingStem ? `Edit ${editingStem.ref}` : 'New Stem'}
            </h2>
            <p className="text-xs text-slate-500">
              Bunker order — generates the full Inspection → Delivery lifecycle.
            </p>
          </div>
          <button className="text-slate-400 hover:text-slate-200" onClick={closeModal}>
            <X size={18} />
          </button>
        </header>

        <div className="grid max-h-[70vh] grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
          {/* Left: fields */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">Customer</label>
                <input
                  className="input"
                  value={input.customer}
                  onChange={(e) => set('customer', e.target.value)}
                  placeholder="e.g. Maersk Line"
                />
              </div>
              <div>
                <label className="field-label">Vessel</label>
                <input
                  className="input"
                  value={input.vessel}
                  onChange={(e) => set('vessel', e.target.value)}
                  placeholder="e.g. Maersk Halifax"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">Product</label>
                <select
                  className="input"
                  value={input.product}
                  onChange={(e) => set('product', e.target.value as ProductId)}
                >
                  {PRODUCTS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Volume (m³)</label>
                <input
                  type="number"
                  min={0}
                  step={50}
                  className="input"
                  value={input.volume}
                  onChange={(e) => set('volume', Number(e.target.value))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">Window start</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={toLocalInput(input.windowStart)}
                  onChange={(e) => set('windowStart', fromLocalInput(e.target.value))}
                />
              </div>
              <div>
                <label className="field-label">Window end</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={toLocalInput(input.windowEnd)}
                  onChange={(e) => set('windowEnd', fromLocalInput(e.target.value))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">Priority</label>
                <select
                  className="input capitalize"
                  value={input.priority}
                  onChange={(e) => set('priority', e.target.value as Priority)}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p} className="capitalize">
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Assigned barge</label>
                <select
                  className="input"
                  value={input.bargeId}
                  onChange={(e) => set('bargeId', e.target.value)}
                >
                  {BARGES.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({m3(b.capacity)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="field-label">Notes</label>
              <textarea
                className="input min-h-[60px] resize-y"
                value={input.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Berth, pilot, meter witness, special instructions…"
              />
            </div>
          </div>

          {/* Right: inventory impact preview */}
          <div className="space-y-3">
            <div className="rounded-lg border border-panel-600 bg-panel-900/60 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Inventory impact preview
              </h3>
              <p className="mb-3 text-[11px] text-slate-500">
                Evaluated at loading completion ({fmtDateTime(preview.atLoadingComplete)}).
              </p>

              <div className="space-y-3 text-sm">
                <ImpactRow
                  label={SHORE_TANK.name}
                  before={preview.tankBefore}
                  after={preview.tankAfter}
                  capacity={preview.tankCapacity}
                  color={SHORE_TANK.color}
                />
                <ImpactRow
                  label={barge?.name ?? 'Barge'}
                  before={preview.bargeBefore}
                  after={preview.bargeAfter}
                  capacity={preview.bargeCapacity}
                  color={barge?.color ?? '#38bdf8'}
                />
              </div>

              {(preview.wouldExceedBarge || preview.wouldEmptyTank) && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-950/40 px-2.5 py-2 text-xs text-rose-200">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    {preview.wouldExceedBarge && <div>Barge capacity would be exceeded.</div>}
                    {preview.wouldEmptyTank && <div>Shore tank would be drawn below zero.</div>}
                  </div>
                </div>
              )}
            </div>

            {errors.length > 0 && (
              <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                {errors.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-panel-600 px-4 py-3">
          <div>
            {editingStem && (
              <button
                className="btn-danger text-xs"
                onClick={() => deleteStem(editingStem.id)}
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost text-sm" onClick={closeModal}>
              Cancel
            </button>
            <button className="btn-primary text-sm" disabled={!valid} onClick={submit}>
              {editingStem ? 'Save changes' : 'Create stem'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ImpactRow({
  label,
  before,
  after,
  capacity,
  color,
}: {
  label: string;
  before: number;
  after: number;
  capacity: number;
  color: string;
}) {
  const delta = after - before;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-slate-200">{label}</span>
        <span className="tabular-nums text-slate-400">
          {m3(before)} →{' '}
          <span className={delta < 0 ? 'text-rose-300' : 'text-emerald-300'}>
            {m3(after)}
          </span>
        </span>
      </div>
      <Meter value={after} max={capacity} color={color} danger={after > capacity || after < 0} />
      <div className="mt-0.5 text-right text-[10px] text-slate-500">
        {pct(Math.max(0, after) / capacity)} of {m3(capacity)}
      </div>
    </div>
  );
}
