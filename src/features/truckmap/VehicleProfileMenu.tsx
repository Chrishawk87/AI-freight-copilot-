"use client";

// Active-truck chip + slide-over editor for the Truck Map. Lets a driver pick
// which rig they're driving (that profile is what makes routes truck-legal),
// and add / edit / delete truck profiles. Dimensions are stored in inches and
// pounds on the backend; here we show driver-friendly feet + inches.

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, Truck as TruckIcon, X } from "lucide-react";
import type { Truck, TruckInput } from "@/lib/api";
import type { VehicleProfilesState } from "./useVehicleProfiles";

function inToFtIn(inches: number): { ft: number; in: number } {
  const ft = Math.floor(inches / 12);
  return { ft, in: inches - ft * 12 };
}
function ftInToIn(ft: number, inch: number): number {
  return Math.round((Number(ft) || 0) * 12 + (Number(inch) || 0));
}
function fmtDims(t: Truck): string {
  const h = inToFtIn(t.heightIn);
  const l = inToFtIn(t.lengthIn);
  return `${h.ft}'${h.in}" H · ${l.ft}'${l.in}" L · ${t.weightLbs.toLocaleString()} lb`;
}

const HAZMAT_OPTIONS = [
  { value: "", label: "No hazmat" },
  { value: "general", label: "Hazmat (general)" },
  { value: "explosive", label: "Class 1 · Explosive" },
  { value: "gas", label: "Class 2 · Gas" },
  { value: "flammable", label: "Class 3 · Flammable" },
  { value: "corrosive", label: "Class 8 · Corrosive" },
];

type Draft = {
  label: string;
  heightFt: number;
  heightIn: number;
  widthFt: number;
  widthIn: number;
  lengthFt: number;
  lengthIn: number;
  weightLbs: number;
  axles: number;
  hazmatClass: string;
};

function truckToDraft(t?: Truck): Draft {
  const h = inToFtIn(t?.heightIn ?? 162);
  const w = inToFtIn(t?.widthIn ?? 102);
  const l = inToFtIn(t?.lengthIn ?? 636);
  return {
    label: t?.label ?? "My Truck",
    heightFt: h.ft,
    heightIn: h.in,
    widthFt: w.ft,
    widthIn: w.in,
    lengthFt: l.ft,
    lengthIn: l.in,
    weightLbs: t?.weightLbs ?? 80000,
    axles: t?.axles ?? 5,
    hazmatClass: t?.hazmatClass ?? "",
  };
}

function draftToInput(d: Draft): TruckInput {
  return {
    label: d.label.trim() || "My Truck",
    heightIn: ftInToIn(d.heightFt, d.heightIn),
    widthIn: ftInToIn(d.widthFt, d.widthIn),
    lengthIn: ftInToIn(d.lengthFt, d.lengthIn),
    weightLbs: Math.round(Number(d.weightLbs) || 0),
    axles: Math.round(Number(d.axles) || 0),
    hazmatClass: d.hazmatClass || null,
  };
}

export function VehicleProfileMenu({ vp }: { vp: VehicleProfilesState }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Truck | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(truckToDraft());
  const [saving, setSaving] = useState(false);

  const startNew = () => {
    setDraft(truckToDraft());
    setEditing("new");
  };
  const startEdit = (t: Truck) => {
    setDraft(truckToDraft(t));
    setEditing(t);
  };
  const cancelEdit = () => setEditing(null);

  const save = async () => {
    setSaving(true);
    const input = draftToInput(draft);
    if (editing === "new") await vp.create(input);
    else if (editing) await vp.update(editing.id, input);
    setSaving(false);
    setEditing(null);
  };

  return (
    <>
      {/* Active-truck chip */}
      <button
        onClick={() => setOpen(true)}
        className="chip flex items-center gap-1.5 bg-white/5 text-white/80"
        title="Choose the truck you're driving"
      >
        <TruckIcon className="h-3.5 w-3.5 text-electric" />
        {vp.active ? vp.active.label : vp.loading ? "Loading…" : "Add truck"}
      </button>

      {!open ? null : (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/50">
          <div className="flex h-full w-full max-w-sm flex-col bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <h2 className="text-base font-bold text-white">Your trucks</h2>
              <button
                onClick={() => {
                  setOpen(false);
                  setEditing(null);
                }}
                aria-label="Close"
                className="rounded-full p-1 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {vp.error && (
                <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {vp.error}
                </p>
              )}

              {editing ? (
                <TruckEditor
                  draft={draft}
                  setDraft={setDraft}
                  saving={saving}
                  onSave={save}
                  onCancel={cancelEdit}
                  isNew={editing === "new"}
                />
              ) : (
                <>
                  <ul className="space-y-2">
                    {vp.trucks.map((t) => {
                      const isActive = vp.active?.id === t.id;
                      return (
                        <li
                          key={t.id}
                          className={`rounded-xl border p-3 ${
                            isActive
                              ? "border-electric/60 bg-electric/10"
                              : "border-slate-800 bg-slate-800/40"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              onClick={() => vp.setActiveId(t.id)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <span
                                className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border ${
                                  isActive
                                    ? "border-electric bg-electric text-[#0B1220]"
                                    : "border-slate-600"
                                }`}
                              >
                                {isActive && <Check className="h-3 w-3" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-white">
                                  {t.label}
                                  {t.isDefault && (
                                    <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">
                                      default
                                    </span>
                                  )}
                                </span>
                                <span className="block truncate text-xs text-slate-400">
                                  {fmtDims(t)}
                                </span>
                              </span>
                            </button>
                            <div className="flex flex-none items-center gap-1">
                              <button
                                onClick={() => startEdit(t)}
                                aria-label="Edit"
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => vp.remove(t.id)}
                                aria-label="Delete"
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                    {!vp.trucks.length && !vp.loading && (
                      <li className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-400">
                        No trucks yet. Add one so routes come back legal for your
                        rig.
                      </li>
                    )}
                  </ul>

                  <button
                    onClick={startNew}
                    className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-electric/40 bg-electric/10 text-sm font-semibold text-electric"
                  >
                    <Plus className="h-4 w-4" /> Add a truck
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function num(
  label: string,
  value: number,
  onChange: (n: number) => void,
  props?: { min?: number; max?: number; step?: number; suffix?: string },
) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          min={props?.min}
          max={props?.max}
          step={props?.step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-electric"
        />
        {props?.suffix && (
          <span className="text-xs text-slate-500">{props.suffix}</span>
        )}
      </div>
    </label>
  );
}

function TruckEditor({
  draft,
  setDraft,
  saving,
  onSave,
  onCancel,
  isNew,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-400">
          Name
        </span>
        <input
          value={draft.label}
          onChange={(e) => set({ label: e.target.value })}
          placeholder="e.g. Truck 12 — reefer"
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-electric"
        />
      </label>

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-400">
          Height
        </span>
        <div className="flex items-center gap-2">
          {num("", draft.heightFt, (n) => set({ heightFt: n }), {
            min: 0,
            max: 20,
            suffix: "ft",
          })}
          {num("", draft.heightIn, (n) => set({ heightIn: n }), {
            min: 0,
            max: 11,
            suffix: "in",
          })}
        </div>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-400">
          Width
        </span>
        <div className="flex items-center gap-2">
          {num("", draft.widthFt, (n) => set({ widthFt: n }), {
            min: 0,
            max: 12,
            suffix: "ft",
          })}
          {num("", draft.widthIn, (n) => set({ widthIn: n }), {
            min: 0,
            max: 11,
            suffix: "in",
          })}
        </div>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-slate-400">
          Length
        </span>
        <div className="flex items-center gap-2">
          {num("", draft.lengthFt, (n) => set({ lengthFt: n }), {
            min: 0,
            max: 80,
            suffix: "ft",
          })}
          {num("", draft.lengthIn, (n) => set({ lengthIn: n }), {
            min: 0,
            max: 11,
            suffix: "in",
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {num("Weight", draft.weightLbs, (n) => set({ weightLbs: n }), {
          min: 0,
          step: 500,
          suffix: "lb",
        })}
        {num("Axles", draft.axles, (n) => set({ axles: n }), {
          min: 2,
          max: 12,
        })}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-400">
          Hazmat
        </span>
        <select
          value={draft.hazmatClass}
          onChange={(e) => set({ hazmatClass: e.target.value })}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-electric"
        >
          {HAZMAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2 pt-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="min-h-11 flex-1 rounded-xl border border-slate-700 text-sm font-semibold text-slate-300"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="min-h-11 flex-1 rounded-xl bg-electric text-sm font-semibold text-[#0B1220] disabled:opacity-60"
        >
          {saving ? "Saving…" : isNew ? "Add truck" : "Save"}
        </button>
      </div>
    </div>
  );
}
