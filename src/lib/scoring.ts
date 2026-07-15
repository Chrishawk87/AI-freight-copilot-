import type { Load, ScoredLoad, Recommendation, Scores } from "./types";

export const DIESEL_PRICE = 3.95; // $/gal, national avg (mock)

// Rough per-mile revenue benchmark by equipment type (mock market data)
const RPM_BENCHMARK: Record<string, number> = {
  "Dry Van": 2.05,
  Reefer: 2.45,
  Flatbed: 2.55,
  "Step Deck": 2.75,
  "Power Only": 1.7,
  "Box Truck": 1.85,
  Hotshot: 1.95,
  "Sprinter Van": 1.6,
  Tanker: 2.9,
  "Auto Transport": 1.15, // per mile per car-equivalent
  Specialized: 3.2,
  "Local & Final-Mile": 3.5,
};

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export function scoreLoad(
  load: Load,
  opts: { mpg: number; fixedCostPerMile: number; diesel?: number }
): ScoredLoad {
  const diesel = opts.diesel ?? DIESEL_PRICE;
  const totalMiles = load.miles + load.deadheadMiles;

  const fuelCost = (totalMiles / opts.mpg) * diesel;
  const fixedCost = totalMiles * opts.fixedCostPerMile;
  const totalCost = fuelCost + fixedCost;
  const netProfit = load.rate - totalCost;

  const rpm = load.rate / load.miles;
  const allInRpm = load.rate / totalMiles;

  const benchmark = RPM_BENCHMARK[load.equipment] ?? 2.0;

  // Profit score: net profit per loaded mile vs a healthy $0.90/mi target
  const profitPerMile = netProfit / load.miles;
  const profit = clamp((profitPerMile / 0.9) * 65 + 20);

  // Deadhead score: penalize deadhead ratio
  const deadheadRatio = load.deadheadMiles / Math.max(load.miles, 1);
  const deadhead = clamp(100 - deadheadRatio * 320);

  // Market score: blend lane demand with rate vs benchmark
  const rateVsBench = (allInRpm / benchmark) * 55;
  const market = clamp(load.demandIndex * 0.45 + rateVsBench);

  // Reload score: from destination reload availability
  const reload = clamp(load.reloadIndex);

  // Fuel impact score: lower fuel share of revenue = better
  const fuelShare = fuelCost / Math.max(load.rate, 1);
  const fuel = clamp(100 - fuelShare * 240);

  const scores: Scores = { profit, deadhead, reload, market, fuel };

  const overall = clamp(
    profit * 0.4 + deadhead * 0.2 + market * 0.15 + reload * 0.15 + fuel * 0.1
  );

  let recommendation: Recommendation = "Consider";
  if (overall >= 72 && netProfit > 0) recommendation = "Accept";
  else if (overall < 48 || netProfit <= 0) recommendation = "Avoid";

  return {
    ...load,
    rpm,
    allInRpm,
    fuelCost,
    fixedCost,
    totalCost,
    netProfit,
    scores,
    overall,
    recommendation,
  };
}
