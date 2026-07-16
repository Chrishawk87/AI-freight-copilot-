"use client";

import { useState } from "react";
import { ArrowRight, MapPin, Package, Star, Check, Loader2, X } from "lucide-react";
import type { ScoredLoad } from "@/lib/types";
import { api } from "@/lib/api";
import { RecBadge, ScoreRing, money } from "./ui";

export default function LoadCard({
  load,
  onBooked,
}: {
  load: ScoredLoad;
  onBooked?: (load: ScoredLoad) => void;
}) {
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [bidOpen, setBidOpen] = useState(false);
  const [error, setError] = useState("");

  async function book() {
    setBooking(true);
    setError("");
    try {
      await api.book(load.id);
      setBooked(true);
      onBooked?.(load);
    } catch (e: any) {
      setError(e.message || "Could not book");
    } finally {
      setBooking(false);
    }
  }

  return (
    <div className="card p-5 transition hover:ring-1 hover:ring-electric/30">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-white/40">
            <span className="chip bg-white/5">{load.equipment}</span>
            <span>{load.source}</span>
            <span>·</span>
            <span>{load.externalId ?? load.id}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-base font-semibold">
            <MapPin className="h-4 w-4 text-electric" />
            {load.originCity}, {load.originState}
            <ArrowRight className="h-4 w-4 text-white/30" />
            {load.destCity}, {load.destState}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/50">
            <span>{(load.miles ?? 0).toLocaleString()} mi loaded</span>
            <span>{load.deadheadMiles ?? 0} mi deadhead</span>
            <span className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5" />
              {((load.weightLbs ?? 0) / 1000).toFixed(0)}k lbs
            </span>
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 text-warning" />
              {load.brokerRating} · {load.broker}
            </span>
          </div>
        </div>
        <ScoreRing value={load.overall} label="Overall" />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
        <div className="flex gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-white/40">Rate</div>
            <div className="text-lg font-bold">{money(load.rate)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-white/40">All-in RPM</div>
            <div className="text-lg font-bold">${(load.allInRpm ?? 0).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-white/40">Net Profit</div>
            <div
              className="text-lg font-bold"
              style={{ color: load.netProfit >= 0 ? "#16C784" : "#EF4444" }}
            >
              {money(load.netProfit)}
            </div>
          </div>
        </div>
        <RecBadge rec={load.recommendation} />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={book}
          disabled={booking || booked}
          className="btn-primary flex-1 justify-center !py-2 text-sm"
        >
          {booked ? (
            <>
              <Check className="h-4 w-4" /> Booked
            </>
          ) : booking ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Book load"
          )}
        </button>
        <button onClick={() => setBidOpen(true)} className="btn-ghost !py-2 text-sm">
          Place bid
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-danger">{error}</div>}

      {bidOpen && <BidModal load={load} onClose={() => setBidOpen(false)} />}
    </div>
  );
}

function BidModal({ load, onClose }: { load: ScoredLoad; onClose: () => void }) {
  const suggested = Math.round((load.rate * 1.08) / 5) * 5;
  const [amount, setAmount] = useState(suggested);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api.bid(load.id, amount, message);
      setDone(true);
    } catch (e: any) {
      setError(e.message || "Could not submit bid");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-bold">Place a bid</div>
            <div className="text-xs text-white/50">
              {load.originCity}, {load.originState} → {load.destCity}, {load.destState}
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="mt-6 flex flex-col items-center gap-2 py-4 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-success/15">
              <Check className="h-6 w-6 text-success" />
            </div>
            <div className="text-sm font-semibold">Bid submitted for {money(amount)}</div>
            <button onClick={onClose} className="btn-ghost mt-2 text-sm">
              Close
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg bg-white/5 p-3 text-xs text-white/60">
              Board rate {money(load.rate)} · suggested open {money(suggested)}
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/40">
                Your bid ($)
              </span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="input"
                min={1}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/40">
                Message (optional)
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                className="input resize-none"
                placeholder="Can pick up today, empty nearby…"
              />
            </label>
            {error && <div className="text-xs text-danger">{error}</div>}
            <button onClick={submit} disabled={busy} className="btn-primary w-full justify-center">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit bid"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
