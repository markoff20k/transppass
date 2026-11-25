import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OdometerStatus, VehicleTechnology } from '@prisma/client';
import {
  CONSUMPTION_MAX_DAYS,
  ConsumptionFlag,
  consumptionComparisonWindow,
  consumptionDeviation,
  consumptionFlagOf,
  type ConsumptionFleet,
  type ConsumptionMonthPoint,
  type ConsumptionQuery,
  type ConsumptionVehicleDetail,
  type ConsumptionVehicleQuery,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, compareVehicles, dailySeries, daysBetween, isoDay, mergeCarDays, monthPoint, totalsOf, type CarDay, type VehicleInfo } from './consumption.calc';

/** Quanto tempo um resultado da frota vale na memória: a planilha chega uma vez por dia, não muda de minuto em minuto. */
const FLEET_TTL_MS = 60_000;
/** Meses fechados não mudam até a próxima carga; o corrente é sempre recalculado. */
const MONTH_TTL_MS = 6 * 3_600_000;

/** Tecnologia de fallback quando o carro não tem registro na planilha: a classe do cadastro. */
const CLASS_TECH: Record<string, string> = {
  BASICO_12M: 'Básico', PADRON_13M: 'Padron AC', PADRON_15M: 'Padron 15m', ARTICULADO_18M: 'Articulado AC', ARTICULADO_23M: 'Articulado 23m AC',
  EPADRON_13M: 'ePadron AC', EPADRON_15M: 'ePadron 15m AC', EARTICULADO_23M: 'eArticulado AC',
};

/**
 * Consumo de diesel (km/l) e de energia (kWh/km) — frota e carro.
 *
 * O consumo vem da planilha (`ConsumptionReading`); o km do mesmo carro e dia
 * vem do odômetro (`OdometerReading.deltaKm`, uma leitura por dia na base
 * real). A conta fica em `consumption.calc.ts`; aqui é só leitura do banco,
 * janela de datas (qualquer intervalo até CONSUMPTION_MAX_DAYS; a comparação
 * segue `consumptionComparisonWindow`) e cache.
 */
@Injectable()
export class ConsumptionService {
  private readonly fleetCache = new Map<string, { at: number; value: ConsumptionFleet }>();
  private readonly monthCache = new Map<string, { at: number; value: ConsumptionMonthPoint }>();

  constructor(private readonly prisma: PrismaService) {}

  async fleet(q: ConsumptionQuery): Promise<ConsumptionFleet> {
    const { from, to } = this.window(q.from, q.to);
    const key = `${q.energy}|${from}|${to}`;
    const hit = this.fleetCache.get(key);
    if (hit && Date.now() - hit.at < FLEET_TTL_MS) return hit.value;

    const energy = q.energy;
    const { from: prevFrom, to: prevTo } = consumptionComparisonWindow(from, to);

    const vehicles = await this.vehiclesOf(energy);
    const [days, source, monthly] = await Promise.all([
      this.carDays(energy, vehicles.map((v) => v.id), prevFrom, to),
      this.source(),
      this.monthly(energy, vehicles, to),
    ]);
    const inCurrent = [...days.values()].filter((d) => d.date >= from && d.date <= to);
    const inPrevious = [...days.values()].filter((d) => d.date >= prevFrom && d.date <= prevTo);
    const cmp = compareVehicles(energy, vehicles, inCurrent, (v) => CLASS_TECH[v.vehicleClass ?? ''] ?? 'Sem classe');

    const value: ConsumptionFleet = {
      energy,
      from,
      to,
      source,
      current: totalsOf(energy, inCurrent),
      previous: totalsOf(energy, inPrevious),
      previousFrom: prevFrom,
      previousTo: prevTo,
      fleetVehicles: vehicles.length,
      daily: dailySeries(energy, inCurrent, from, to),
      monthly,
      byTech: cmp.byTech,
      vehicles: cmp.rows,
      quality: cmp.quality,
    };
    this.fleetCache.set(key, { at: Date.now(), value });
    return value;
  }

  async vehicle(id: string, q: ConsumptionVehicleQuery): Promise<ConsumptionVehicleDetail> {
    const v = await this.prisma.vehicle.findUnique({ where: { id }, select: { id: true, code: true, plate: true, manufacturer: true, model: true, vehicleClass: true, technology: true, lot: true } });
    if (!v) throw new NotFoundException('Carro não encontrado');
    const energy = v.technology;
    const { from, to } = this.window(q.from, q.to);
    const { from: prevFrom, to: prevTo } = consumptionComparisonWindow(from, to);

    const [days, fleet] = await Promise.all([this.carDays(energy, [v.id], prevFrom, to), this.fleet({ energy, from, to })]);
    const inCurrent = [...days.values()].filter((d) => d.date >= from && d.date <= to);
    const inPrevious = [...days.values()].filter((d) => d.date >= prevFrom && d.date <= prevTo);
    const current = totalsOf(energy, inCurrent);
    const row = fleet.vehicles.find((r) => r.vehicleId === v.id) ?? null;
    const tech = row?.tech ?? inCurrent.find((d) => d.tech)?.tech ?? CLASS_TECH[v.vehicleClass ?? ''] ?? null;
    const reference = row?.reference ?? fleet.byTech.find((g) => g.tech === tech)?.reference ?? null;
    const deviation = row?.deviation ?? consumptionDeviation(energy, current.ratio, reference);
    const flag = row?.flag ?? consumptionFlagOf(deviation, current.days, current.km > 0);

    // Posição no grupo, do melhor para o pior rendimento, só entre carros comparáveis
    // (com pelo menos CONSUMPTION_MIN_DAYS dias); quem tem poucos dias fica fora do ranking.
    const comparable = (f: ConsumptionFlag) => f === ConsumptionFlag.OK || f === ConsumptionFlag.WATCH || f === ConsumptionFlag.HIGH;
    let rank: ConsumptionVehicleDetail['rank'] = null;
    if (row && row.ratio !== null && row.deviation !== null && comparable(row.flag)) {
      const peers = fleet.vehicles.filter((r) => r.tech === row.tech && r.deviation !== null && comparable(r.flag)).sort((a, b) => (a.deviation as number) - (b.deviation as number));
      const position = peers.findIndex((r) => r.vehicleId === v.id) + 1;
      if (position > 0) rank = { position, of: peers.length };
    }

    // Série mensal do carro: 12 meses, direto das leituras (um carro só, cabe numa consulta).
    const monthFrom = `${addDays(to, -365).slice(0, 7)}-01`;
    const allDays = await this.carDays(energy, [v.id], monthFrom, to);
    const months = new Map<string, CarDay[]>();
    for (const d of allDays.values()) {
      const m = d.date.slice(0, 7);
      const list = months.get(m) ?? [];
      list.push(d);
      months.set(m, list);
    }
    const monthly: ConsumptionMonthPoint[] = this.lastMonths(to).map((m) => monthPoint(energy, m, months.get(m) ?? []));

    return {
      vehicle: { id: v.id, code: v.code, plate: v.plate, manufacturer: v.manufacturer, model: v.model, vehicleClass: v.vehicleClass, technology: v.technology, lot: v.lot },
      energy,
      tech,
      from,
      to,
      current,
      previous: totalsOf(energy, inPrevious),
      previousFrom: prevFrom,
      previousTo: prevTo,
      reference,
      deviation,
      flag,
      rank,
      daily: dailySeries(energy, inCurrent, from, to, false),
      monthly,
      daysKmWithoutFuel: row?.daysKmWithoutFuel ?? inCurrent.filter((d) => d.km > 0 && !(d.amount && d.amount > 0)).length,
    };
  }

  // --- Leitura do banco ----------------------------------------------------------

  /** Período válido: `to` nunca depois de hoje; `from` nunca depois de `to`. */
  private window(from: string, to: string): { from: string; to: string } {
    const today = isoDay(new Date());
    const end = to > today ? today : to;
    if (from > end) throw new BadRequestException('Período inválido');
    if (daysBetween(from, end) > CONSUMPTION_MAX_DAYS) throw new BadRequestException(`Período máximo de ${CONSUMPTION_MAX_DAYS} dias`);
    return { from, to: end };
  }

  private vehiclesOf(energy: VehicleTechnology): Promise<(VehicleInfo & { manufacturer: string | null })[]> {
    return this.prisma.vehicle.findMany({
      where: { technology: energy, application: 'FROTA', isActive: true },
      select: { id: true, code: true, plate: true, model: true, manufacturer: true, vehicleClass: true },
      orderBy: { code: 'asc' },
    });
  }

  /** Carro-dias de km (odômetro) e consumo (planilha) na janela, para os carros dados. */
  private async carDays(energy: VehicleTechnology, vehicleIds: string[], from: string, to: string): Promise<Map<string, CarDay>> {
    if (vehicleIds.length === 0) return new Map();
    const [fuel, km] = await Promise.all([
      this.prisma.consumptionReading.findMany({
        where: { energy, vehicleId: { in: vehicleIds }, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
        select: { vehicleId: true, date: true, amount: true, tech: true },
      }),
      this.prisma.odometerReading.findMany({
        where: {
          vehicleId: { in: vehicleIds },
          readAt: { gte: new Date(`${from}T00:00:00`), lt: new Date(`${addDays(to, 1)}T00:00:00`) },
          status: { not: OdometerStatus.REJECTED },
          deltaKm: { gt: 0 },
        },
        select: { vehicleId: true, readAt: true, deltaKm: true },
      }),
    ]);
    return mergeCarDays(
      km.map((r) => ({ vehicleId: r.vehicleId, date: isoDay(r.readAt), km: r.deltaKm ?? 0 })),
      fuel.map((f) => ({ vehicleId: f.vehicleId, date: f.date.toISOString().slice(0, 10), amount: Number(f.amount), tech: f.tech })),
    );
  }

  private async source(): Promise<string | null> {
    const last = await this.prisma.consumptionReading.findFirst({ orderBy: { createdAt: 'desc' }, select: { source: true } });
    return last?.source ?? null;
  }

  /** Os 12 meses até o mês de `to`, "AAAA-MM". */
  private lastMonths(to: string): string[] {
    const out: string[] = [];
    const [y, m] = to.split('-').map(Number) as [number, number];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(y, m - 1 - i, 1);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return out;
  }

  /**
   * Série mensal da frota: um ponto por mês, pelos totais por carro (só carros
   * com consumo no mês entram no km). Meses fechados ficam em cache.
   */
  private async monthly(energy: VehicleTechnology, vehicles: VehicleInfo[], to: string): Promise<ConsumptionMonthPoint[]> {
    const ids = vehicles.map((v) => v.id);
    const current = to.slice(0, 7);
    return Promise.all(
      this.lastMonths(to).map(async (month) => {
        const key = `${energy}|${month}`;
        const hit = this.monthCache.get(key);
        if (month !== current && hit && Date.now() - hit.at < MONTH_TTL_MS) return hit.value;
        const first = `${month}-01`;
        const last = month === current ? to : addDays(`${month}-01`, 31).slice(0, 7) === month ? `${month}-31` : addDays(`${addDays(first, 32).slice(0, 7)}-01`, -1);
        const point = await this.monthTotals(energy, ids, month, first, last);
        if (month !== current) this.monthCache.set(key, { at: Date.now(), value: point });
        return point;
      }),
    );
  }

  private async monthTotals(energy: VehicleTechnology, ids: string[], month: string, from: string, to: string): Promise<ConsumptionMonthPoint> {
    if (ids.length === 0) return { month, km: 0, amount: 0, ratio: null, vehicles: 0 };
    const fuel = await this.prisma.consumptionReading.groupBy({
      by: ['vehicleId'],
      where: { energy, vehicleId: { in: ids }, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
      _sum: { amount: true },
    });
    const withFuel = fuel.map((f) => f.vehicleId);
    if (withFuel.length === 0) return { month, km: 0, amount: 0, ratio: null, vehicles: 0 };
    const km = await this.prisma.odometerReading.groupBy({
      by: ['vehicleId'],
      where: { vehicleId: { in: withFuel }, readAt: { gte: new Date(`${from}T00:00:00`), lt: new Date(`${addDays(to, 1)}T00:00:00`) }, status: { not: OdometerStatus.REJECTED }, deltaKm: { gt: 0 } },
      _sum: { deltaKm: true },
    });
    const kmById = new Map(km.map((k) => [k.vehicleId, k._sum.deltaKm ?? 0]));
    const days: CarDay[] = fuel.map((f) => ({ vehicleId: f.vehicleId, date: from, km: kmById.get(f.vehicleId) ?? 0, amount: Number(f._sum.amount ?? 0), tech: null }));
    return monthPoint(energy, month, days);
  }
}
