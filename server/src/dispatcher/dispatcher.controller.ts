import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { LoadsService } from '../loads/loads.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { ScoredLoad } from '../scoring/scoring';

class AskDto {
  @IsString()
  message: string;
}

function money(n: number) {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

@UseGuards(JwtAuthGuard)
@Controller('dispatcher')
export class DispatcherController {
  constructor(
    private readonly loads: LoadsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('ask')
  async ask(@CurrentUser() user: AuthUser, @Body() dto: AskDto) {
    const q = (dto.message || '').toLowerCase();
    const all = await this.loads.list(user);

    const eqMap: [string, string][] = [
      ['reefer', 'Reefer'],
      ['flatbed', 'Flatbed'],
      ['dry van', 'Dry Van'],
      ['step deck', 'Step Deck'],
      ['power only', 'Power Only'],
      ['box truck', 'Box Truck'],
      ['hotshot', 'Hotshot'],
      ['tanker', 'Tanker'],
      ['auto', 'Auto Transport'],
    ];
    const eqHit = eqMap.find(([k]) => q.includes(k));

    const top = (list: ScoredLoad[], n = 3) => list.slice(0, n);

    if (q.includes('reload') || q.includes('deadhead') || q.includes('backhaul')) {
      const reloads = await this.loads.reloads(user, 200);
      const t = reloads[0];
      return {
        text: t
          ? `I found ${reloads.length} reloads near your delivery. The strongest is ${t.originCity} → ${t.destCity} at ${money(t.rate)} (net ${money(t.netProfit)}), keeping deadhead under ${t.deadheadMiles} miles.`
          : 'No reloads available near your delivery right now.',
        loads: top(reloads),
      };
    }

    if (q.includes('fuel') || q.includes('diesel')) {
      const stations = await this.prisma.fuelStation.findMany({
        orderBy: { price: 'asc' },
      });
      const onRoute = stations.filter((s) => s.onRoute)[0];
      return {
        text: onRoute
          ? `Cheapest on-route diesel is ${onRoute.name} in ${onRoute.city}, ${onRoute.state} at $${onRoute.price.toFixed(2)}/gal (${onRoute.distanceMi} mi out).`
          : 'No fuel data available.',
        loads: [],
      };
    }

    if (q.includes('make') || q.includes('earn') || q.includes('revenue') || q.includes('how much')) {
      const dash = await this.loads.dashboard(user);
      const w = dash.weekly;
      if (w.loadsCompleted === 0) {
        return {
          text: `You haven't booked any loads yet, so there's nothing to report. Book a load and I'll start tracking your revenue, net profit, and margin here.`,
          loads: [],
        };
      }
      return {
        text: `So far you've booked ${w.loadsCompleted} loads: ${money(w.revenue)} revenue, ${money(w.netProfit)} net profit — a ${((w.netProfit / w.revenue) * 100).toFixed(0)}% margin over ${w.miles.toLocaleString()} miles.`,
        loads: [],
      };
    }

    if (eqHit) {
      const list = top(all.filter((l) => l.equipment === eqHit[1]));
      const t = list[0];
      return {
        text: t
          ? `Highest-scoring ${eqHit[1]} load: ${t.originCity}, ${t.originState} → ${t.destCity}, ${t.destState} at ${money(t.rate)} ($${t.allInRpm.toFixed(2)}/mi all-in, net ${money(t.netProfit)}). I rate it ${t.recommendation} (${t.overall}/100).`
          : `No ${eqHit[1]} loads on the connected boards right now.`,
        loads: list,
      };
    }

    if (q.includes('bid') || q.includes('negotiate') || q.includes('counter')) {
      const t = all[0];
      const target = Math.round((t.rate * 1.08) / 5) * 5;
      return {
        text: `For ${t.externalId} (${t.originCity} → ${t.destCity}), board rate is ${money(t.rate)}. Market supports more — open at ${money(target)}, hold at ${money(Math.round((t.rate * 1.04) / 5) * 5)}. Want me to submit the bid?`,
        loads: [t],
      };
    }

    if (q.includes('best') || q.includes('top') || q.includes('find') || q.includes('load')) {
      return {
        text: 'Top opportunities right now, ranked by true profit after fuel and fixed cost:',
        loads: top(all),
      };
    }

    return {
      text: 'I can find loads, score profitability, hunt reloads, locate cheap diesel, draft bids, and report earnings. Try: "Find the highest paying reefer load" or "How much did I make this week?"',
      loads: [],
    };
  }
}
