import { Load } from '@prisma/client';

export const DIESEL_PRICE = 3.95;

const RPM_BENCHMARK: Record<string, number> = {
  'Dry Van': 2.05,
  Reefer: 2.45,
  Flatbed: 2.55,
  'Step Deck': 2.75,
  'Power Only': 1.7,
  'Box Truck': 1.85,
  Hotshot: 1.95,
  'Sprinter Van': 1.6,
  Tanker: 2.9,
  'Auto Transport': 1.15,
  Specialized: 3.2,
  'Local & Final-Mile': 3.5,
};

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export interface Scores {
  profit: number;
  deadhead: number;
  reload: number;
  market: number;
  fuel: number;
}

export interface ScoredLoad extends Load {
  rpm: number;
  allInRpm: number;
  fuelCost: number;
  fixedCost: number;
  totalCost: number;
  netProfit: number;
  scores: Scores;
  overall: number;
  recommendation: 'Accept' | 'Consider' | 'Avoid';
}

export function scoreLoad(
  load: Load,
  opts: { mpg: number; fixedCostPerMile: number; diesel?: number },
): ScoredLoad {
  const diesel = opts.diesel ?? DIESEL_PRICE;
  const totalMiles = load.miles + load.deadheadMiles;

  const fuelCost = (totalMiles / opts.mpg) * diesel;
  const fixedCost = totalMiles * opts.fixedCostPerMile;
  const totalCost = fuelCost + fixedCost;
  const netProfit = load.rate - totalCost;

  // Guard every per-mile figure: a load can arrive with 0/blank miles (e.g. a
  // carrier-originated Rate Con before it's routed, or a sparse board record).
  // Dividing by zero yields Infinity, which JSON-serializes to null and would
  // crash any client that formats the number. Keep them finite.
  const rpm = load.miles > 0 ? load.rate / load.miles : 0;
  const allInRpm = totalMiles > 0 ? load.rate / totalMiles : 0;

  const benchmark = RPM_BENCHMARK[load.equipment] ?? 2.0;

  const profitPerMile = load.miles > 0 ? netProfit / load.miles : 0;
  const profit = clamp((profitPerMile / 0.9) * 65 + 20);

  const deadheadRatio = load.deadheadMiles / Math.max(load.miles, 1);
  const deadhead = clamp(100 - deadheadRatio * 320);

  const rateVsBench = (allInRpm / benchmark) * 55;
  const market = clamp(load.demandIndex * 0.45 + rateVsBench);

  const reload = clamp(load.reloadIndex);

  const fuelShare = fuelCost / Math.max(load.rate, 1);
  const fuel = clamp(100 - fuelShare * 240);

  const scores: Scores = { profit, deadhead, reload, market, fuel };

  const overall = clamp(
    profit * 0.4 + deadhead * 0.2 + market * 0.15 + reload * 0.15 + fuel * 0.1,
  );

  let recommendation: 'Accept' | 'Consider' | 'Avoid' = 'Consider';
  if (overall >= 72 && netProfit > 0) recommendation = 'Accept';
  else if (overall < 48 || netProfit <= 0) recommendation = 'Avoid';

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
