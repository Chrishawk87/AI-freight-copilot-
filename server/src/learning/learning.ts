import { Load } from '@prisma/client';
import { ScoredLoad } from '../scoring/scoring';

// ── The learning loop ────────────────────────────────────────────────────────
// The data moat. Every load a carrier actually BOOKS is a revealed preference:
// which brokers they trust, which lanes they run, which equipment they pull, and
// whether the reloads we promised near a drop actually materialized. We distill
// that history into a per-carrier LearningProfile and use it to nudge the score
// of new loads — so the longer a carrier runs on the platform, the sharper the
// recommendations get, tuned to THEIR business and nobody else's.
//
// Everything here is pure and per-carrier. Cold start is safe: with little
// history the confidence factor is near zero, so scores are untouched until the
// carrier has actually booked enough freight to learn from.

export interface BookingLike {
  bookedAt: Date;
  load: Load;
}

export interface LearningProfile {
  sampleSize: number; // total bookings learned from
  confidence: number; // 0..1, how much to trust the signal (scales all nudges)
  // Revealed preferences — normalized 0..1 weights (most-booked = 1).
  brokerWeight: Record<string, number>;
  destStateWeight: Record<string, number>;
  laneWeight: Record<string, number>; // "ORIG>DEST" state pair
  equipmentWeight: Record<string, number>;
  // How often a booked drop was actually followed by a reload booked from that
  // same state — calibrates how much we trust a load's reloadIndex. null until
  // there's at least one reload opportunity in the history.
  reloadRealization: number | null; // 0..1
}

function normalize(counts: Record<string, number>): Record<string, number> {
  const max = Math.max(1, ...Object.values(counts));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) out[k] = v / max;
  return out;
}

export function buildLearningProfile(bookings: BookingLike[]): LearningProfile {
  const broker: Record<string, number> = {};
  const destState: Record<string, number> = {};
  const lane: Record<string, number> = {};
  const equipment: Record<string, number> = {};

  for (const b of bookings) {
    const l = b.load;
    if (l.broker) broker[l.broker] = (broker[l.broker] ?? 0) + 1;
    if (l.destState) destState[l.destState] = (destState[l.destState] ?? 0) + 1;
    if (l.originState && l.destState) {
      const key = `${l.originState}>${l.destState}`;
      lane[key] = (lane[key] ?? 0) + 1;
    }
    if (l.equipment) equipment[l.equipment] = (equipment[l.equipment] ?? 0) + 1;
  }

  // Reload realization: walk the bookings in chronological order and count how
  // often the NEXT booking started in the state where the previous one dropped.
  const chrono = [...bookings].sort(
    (a, b) => a.bookedAt.getTime() - b.bookedAt.getTime(),
  );
  let opportunities = 0;
  let realized = 0;
  for (let i = 0; i < chrono.length - 1; i++) {
    const drop = chrono[i].load.destState;
    if (!drop) continue;
    opportunities++;
    if (chrono[i + 1].load.originState === drop) realized++;
  }
  const reloadRealization = opportunities > 0 ? realized / opportunities : null;

  const sampleSize = bookings.length;
  // Confidence ramps in over the first ~8 booked loads, so a brand-new carrier
  // gets essentially no nudge and a seasoned one gets the full signal.
  const confidence = Math.max(0, Math.min(1, sampleSize / 8));

  return {
    sampleSize,
    confidence,
    brokerWeight: normalize(broker),
    destStateWeight: normalize(destState),
    laneWeight: normalize(lane),
    equipmentWeight: normalize(equipment),
    reloadRealization,
  };
}

// The empty profile — used before a carrier has any history. Leaves scores
// untouched (confidence 0).
export const EMPTY_PROFILE: LearningProfile = {
  sampleSize: 0,
  confidence: 0,
  brokerWeight: {},
  destStateWeight: {},
  laneWeight: {},
  equipmentWeight: {},
  reloadRealization: null,
};

// Max points the learning loop can add to (or subtract from) a load's overall
// score at full confidence. Kept modest so the true-cost model stays dominant —
// learning refines the ranking, it doesn't override the economics.
const MAX_BROKER_BOOST = 6;
const MAX_LANE_BOOST = 5;
const MAX_EQUIP_BOOST = 3;
const MAX_RELOAD_ADJ = 4;

// Apply a carrier's learned preferences to a freshly scored load. Returns a new
// ScoredLoad with an adjusted `overall`, plus `learnedBoost` and human-readable
// `learnedReasons` for explainability (the Daily Plan and Co-Pilot can surface
// "you run this broker a lot"). Recommendation is re-derived from the new score.
export function applyLearning(
  scored: ScoredLoad,
  profile: LearningProfile,
): ScoredLoad {
  if (profile.confidence <= 0) return scored;

  const reasons: string[] = [];
  let boost = 0;

  const bw = profile.brokerWeight[scored.broker] ?? 0;
  if (bw > 0) {
    boost += MAX_BROKER_BOOST * bw;
    if (bw >= 0.75) reasons.push(`you book ${scored.broker} often`);
  }

  const laneKey = `${scored.originState}>${scored.destState}`;
  const lw = profile.laneWeight[laneKey] ?? 0;
  const dw = profile.destStateWeight[scored.destState] ?? 0;
  const laneSignal = Math.max(lw, dw * 0.6);
  if (laneSignal > 0) {
    boost += MAX_LANE_BOOST * laneSignal;
    if (lw >= 0.75) reasons.push(`a lane you run`);
    else if (dw >= 0.75) reasons.push(`into ${scored.destState}, where you haul a lot`);
  }

  const ew = profile.equipmentWeight[scored.equipment] ?? 0;
  if (ew > 0) {
    boost += MAX_EQUIP_BOOST * ew;
    if (ew >= 0.75) reasons.push(`your usual ${scored.equipment}`);
  }

  // Reload calibration: if this carrier's real reload realization runs below the
  // board's optimistic reloadIndex, trim loads that lean on a strong reload; if
  // it runs high, reward them. Centered at 0.5 so a neutral history does nothing.
  if (profile.reloadRealization != null) {
    const reloadLean = scored.scores.reload / 100; // 0..1 how reload-dependent
    const delta = (profile.reloadRealization - 0.5) * 2; // -1..1
    boost += MAX_RELOAD_ADJ * delta * reloadLean;
  }

  boost *= profile.confidence;

  const overall = Math.max(0, Math.min(100, Math.round(scored.overall + boost)));
  let recommendation = scored.recommendation;
  if (overall >= 72 && scored.netProfit > 0) recommendation = 'Accept';
  else if (overall < 48 || scored.netProfit <= 0) recommendation = 'Avoid';
  else recommendation = 'Consider';

  return {
    ...scored,
    overall,
    recommendation,
    learnedBoost: Math.round(boost * 10) / 10,
    learnedReasons: reasons,
  };
}
