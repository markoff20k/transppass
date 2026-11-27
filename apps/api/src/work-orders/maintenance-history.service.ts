import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  MAINTENANCE_BREAKDOWN_KINDS,
  paginate,
  type MaintenanceHistoryQuery,
  type MaintenanceHistoryRow,
  type MaintenanceHistorySummary,
  type Paginated,
} from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Histórico das fichas do ERP-JB (`MaintenanceRecord`), importadas das
 * planilhas do cliente. São registros fechados: não são a OS viva do sistema
 * (`WorkOrder`) e não entram nos KPIs da garagem. Só leitura.
 */
@Injectable()
export class MaintenanceHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  private whereOf(q: MaintenanceHistoryQuery, opts?: { ignoreKind?: boolean }): Prisma.MaintenanceRecordWhereInput {
    const where: Prisma.MaintenanceRecordWhereInput = {};

    // from/to chegam como 'AAAA-MM-DD' e são interpretados no dia local do
    // servidor (sem 'Z'), inclusive nas duas pontas: do primeiro instante de
    // `from` ao último milissegundo de `to`.
    if (q.from && q.to && q.from > q.to) throw new BadRequestException('Período inválido');
    if (q.from || q.to) {
      where.openedAt = {
        ...(q.from ? { gte: localDay(q.from, 'T00:00:00') } : {}),
        ...(q.to ? { lte: localDay(q.to, 'T23:59:59.999') } : {}),
      };
    }

    // Tipo e "só quebras" se combinam (AND): com os dois, só vale o tipo escolhido
    // se ele for uma quebra (A/S/T); se não for, a interseção é vazia.
    const kind = q.kind && !opts?.ignoreKind ? q.kind.toUpperCase() : undefined;
    if (kind && q.onlyBreakdowns) where.kind = { in: MAINTENANCE_BREAKDOWN_KINDS.filter((k) => k === kind) };
    else if (kind) where.kind = kind;
    else if (q.onlyBreakdowns) where.kind = { in: [...MAINTENANCE_BREAKDOWN_KINDS] };
    if (q.onlyPreventive) where.isPreventive = true;
    if (q.vehicleId) where.vehicleId = q.vehicleId;

    if (q.search) {
      const contains = { contains: q.search, mode: 'insensitive' as const };
      where.OR = [
        { externalOs: contains },
        { ficha: contains },
        { vehicle: { code: contains } },
        { vehicle: { plate: contains } },
        { allegedText: contains },
        { foundText: contains },
      ];
    }

    return where;
  }

  async list(q: MaintenanceHistoryQuery): Promise<Paginated<MaintenanceHistoryRow>> {
    // (a ordem vem da consulta; ver orderOf)
    const where = this.whereOf(q);
    const [rows, total] = await Promise.all([
      this.prisma.maintenanceRecord.findMany({
        where,
        include: { vehicle: { select: { code: true, plate: true } }, items: true, materials: true },
        orderBy: orderOf(q.sort, q.dir),
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
      }),
      this.prisma.maintenanceRecord.count({ where }),
    ]);

    const data: MaintenanceHistoryRow[] = rows.map((r) => ({
      id: r.id,
      externalOs: r.externalOs,
      ficha: r.ficha,
      vehicleId: r.vehicleId,
      vehicleCode: r.vehicle.code,
      vehiclePlate: r.vehicle.plate,
      openedAt: r.openedAt.toISOString(),
      kind: r.kind,
      kindLabel: r.kindLabel,
      isPreventive: r.isPreventive,
      isBreakdown: MAINTENANCE_BREAKDOWN_KINDS.includes(r.kind),
      allegedCode: r.allegedCode,
      allegedText: r.allegedText,
      allegedDetail: r.allegedDetail,
      foundCode: r.foundCode,
      foundText: r.foundText,
      actions: r.actions,
      fieldActions: r.fieldActions,
      driverName: r.driverName,
      line: r.line,
      lot: r.lot,
      mechanicReg: r.mechanicReg,
      cost: r.cost === null ? null : Number(r.cost),
      partsCost: round2(r.materials.reduce((s, m) => s + Number(m.totalCost), 0)),
      items: r.items.map((i) => ({
        componentCode: i.componentCode,
        componentLabel: i.componentLabel,
        kmAtService: i.kmAtService,
        kmLimit: i.kmLimit,
        note: i.note,
      })),
      materials: r.materials.map((m) => ({
        materialCode: m.materialCode,
        description: m.description,
        quantity: Number(m.quantity),
        unitCost: Number(m.unitCost),
        totalCost: Number(m.totalCost),
      })),
    }));

    return paginate(data, total, { page: q.page, perPage: q.perPage });
  }

  async summary(q: MaintenanceHistoryQuery): Promise<MaintenanceHistorySummary> {
    const where = this.whereOf(q);
    const [total, breakdowns, preventive, range, parts, kinds] = await Promise.all([
      this.prisma.maintenanceRecord.count({ where }),
      this.prisma.maintenanceRecord.count({ where: { AND: [where, { kind: { in: [...MAINTENANCE_BREAKDOWN_KINDS] } }] } }),
      this.prisma.maintenanceRecord.count({ where: { AND: [where, { isPreventive: true }] } }),
      this.prisma.maintenanceRecord.aggregate({ where, _min: { openedAt: true }, _max: { openedAt: true } }),
      this.prisma.maintenanceRecordMaterial.aggregate({ where: { record: where }, _sum: { totalCost: true } }),
      // O filtro de tipo não entra aqui: o dropdown de tipos precisa continuar
      // mostrando todos os tipos do período, não só o que está selecionado.
      this.prisma.maintenanceRecord.groupBy({
        by: ['kind', 'kindLabel'],
        where: this.whereOf(q, { ignoreKind: true }),
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      breakdowns,
      preventive,
      partsCost: round2(Number(parts._sum.totalCost ?? 0)),
      firstAt: range._min.openedAt?.toISOString() ?? null,
      lastAt: range._max.openedAt?.toISOString() ?? null,
      kinds: kinds
        .map((k) => ({ kind: k.kind, label: k.kindLabel ?? k.kind, count: k._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Converte 'AAAA-MM-DD' num instante do dia local do servidor. O schema só
 * garante o formato; aqui barramos o que o regex deixa passar: mês 13, dia 32
 * (viram Invalid Date e derrubariam o Prisma com 500) e datas que o JS "rola"
 * em silêncio, como 30/02, que viraria 02/03.
 */
function localDay(ymd: string, time: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(`${ymd}${time}`);
  const valid = !Number.isNaN(date.getTime()) && date.getFullYear() === y && date.getMonth() + 1 === m && date.getDate() === d;
  if (!valid) throw new BadRequestException(`Data inválida: ${ymd}`);
  return date;
}

/** Ordem pedida pela tela, com a abertura como desempate para a lista não embaralhar entre páginas. */
function orderOf(sort: MaintenanceHistoryQuery['sort'], dir: MaintenanceHistoryQuery['dir']): Prisma.MaintenanceRecordOrderByWithRelationInput[] {
  switch (sort) {
    case 'externalOs':
      return [{ externalOs: dir }];
    case 'vehicleCode':
      return [{ vehicle: { code: dir } }, { openedAt: 'desc' }];
    case 'kind':
      return [{ kind: dir }, { openedAt: 'desc' }];
    case 'mechanicReg':
      return [{ mechanicReg: { sort: dir, nulls: 'last' } }, { openedAt: 'desc' }];
    case 'openedAt':
    default:
      return [{ openedAt: dir }, { externalOs: dir }];
  }
}
