import { scoredLoads, reloadLoads, fuelStations, weekly } from "./data";
import { money } from "@/components/ui";
import type { ScoredLoad } from "./types";

export interface Answer {
  text: string;
  loads?: ScoredLoad[];
}

function best(list: ScoredLoad[], n = 3) {
  return [...list].sort((a, b) => b.overall - a.overall).slice(0, n);
}

export function askDispatcher(qRaw: string): Answer {
  const q = qRaw.toLowerCase();

  // Equipment-specific highest paying
  const eqMap: [string, string][] = [
    ["reefer", "Reefer"],
    ["flatbed", "Flatbed"],
    ["dry van", "Dry Van"],
    ["step deck", "Step Deck"],
    ["power only", "Power Only"],
    ["box truck", "Box Truck"],
    ["hotshot", "Hotshot"],
    ["tanker", "Tanker"],
    ["auto", "Auto Transport"],
  ];
  const eqHit = eqMap.find(([k]) => q.includes(k));

  if (q.includes("reload") || q.includes("deadhead") || q.includes("backhaul")) {
    const top = best(reloadLoads, 3);
    return {
      text: `I found ${reloadLoads.length} reloads near your delivery. The strongest is ${top[0].originCity} → ${top[0].destCity} at ${money(top[0].rate)} (net ${money(top[0].netProfit)}). Booking it keeps your deadhead under ${top[0].deadheadMiles} miles.`,
      loads: top,
    };
  }

  if (q.includes("fuel") || q.includes("diesel") || q.includes("gas")) {
    const onRoute = [...fuelStations].filter((f) => f.onRoute).sort((a, b) => a.price - b.price)[0];
    const nearby = [...fuelStations].sort((a, b) => a.distanceMi - b.distanceMi)[0];
    return {
      text: `Cheapest on-route diesel is ${onRoute.name} in ${onRoute.city}, ${onRoute.state} at $${onRoute.price.toFixed(
        2
      )}/gal (${onRoute.distanceMi} mi out). Closest pump is ${nearby.name} at $${nearby.price.toFixed(
        2
      )}/gal. Filling 150 gal on-route vs. the nearest station saves about ${money(
        Math.max(0, (nearby.price - onRoute.price) * 150)
      )}.`,
    };
  }

  if (
    q.includes("make") ||
    q.includes("earn") ||
    q.includes("revenue") ||
    q.includes("profit this week") ||
    q.includes("how much")
  ) {
    return {
      text: `This week you ran ${weekly.miles.toLocaleString()} miles across ${weekly.loadsCompleted} loads. Revenue ${money(
        weekly.revenue
      )}, net profit ${money(weekly.netProfit)} — a ${(
        (weekly.netProfit / weekly.revenue) *
        100
      ).toFixed(0)}% margin. Deadhead was ${weekly.deadheadMiles} miles (${(
        (weekly.deadheadMiles / weekly.miles) *
        100
      ).toFixed(0)}% of your miles).`,
    };
  }

  if (eqHit) {
    const list = best(scoredLoads.filter((l) => l.equipment === eqHit[1]), 3);
    if (list.length === 0) return { text: `I don't see any ${eqHit[1]} loads on the connected boards right now.` };
    const t = list[0];
    return {
      text: `Highest-scoring ${eqHit[1]} load: ${t.originCity}, ${t.originState} → ${t.destCity}, ${t.destState} at ${money(
        t.rate
      )} ($${t.allInRpm.toFixed(2)}/mi all-in, net ${money(t.netProfit)}). I rate it ${t.recommendation} (${t.overall}/100).`,
      loads: list,
    };
  }

  if (q.includes("bid") || q.includes("negotiate") || q.includes("counter")) {
    const t = best(scoredLoads, 1)[0];
    const target = Math.round((t.rate * 1.08) / 5) * 5;
    return {
      text: `For ${t.id} (${t.originCity} → ${t.destCity}), the board rate is ${money(
        t.rate
      )}. Market supports more — I'd open at ${money(target)} and hold at ${money(
        Math.round((t.rate * 1.04) / 5) * 5
      )}. Draft bid: "Can do this today with a clean MC and 24/7 tracking. Rate confirm at ${money(
        target
      )}?" Want me to submit it?`,
      loads: [t],
    };
  }

  if (q.includes("best") || q.includes("top") || q.includes("find") || q.includes("load")) {
    const list = best(scoredLoads, 3);
    return {
      text: `Top 3 opportunities right now, ranked by true profit after fuel and fixed cost:`,
      loads: list,
    };
  }

  return {
    text: `I can find loads, score profitability, hunt reloads, locate cheap diesel, draft bids, and report your earnings. Try: "Find the highest paying reefer load" or "How much did I make this week?"`,
  };
}
