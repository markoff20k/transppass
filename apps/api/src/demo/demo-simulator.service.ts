import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { DemoStatus } from '@app/shared';
import {
  EventOrigin,
  EventStatus,
  FieldOutcome,
  InspectionResult,
  KmSource,
  MaterialRequestStatus,
  ReasonCodeList,
  ReplacementDemandStatus,
  TaskStatus,
  TriageDestination,
  UserRole,
  VehicleStatus,
  WorkOrderStatus,
} from '@prisma/client';
import { FieldStep, type CreateEventInput, type TriageInput, type FieldOutcomeInput, type OdometerEntryInput } from '@app/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OdometerService } from '../odometer/odometer.service';
import { EventsService } from '../events/events.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { MaterialsService } from '../materials/materials.service';
import { OperationsService } from '../operations/operations.service';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const LINES = ['8012', '2290', '3720', '875A-10', '6262', '4111', '8622', '9784', '7021', '8555'] as const;
const PLACES = [
  'Terminal Barra Funda',
  'Av. Marginal Tietê, altura da ponte da Casa Verde',
  'Ponto final da linha',
  'Av. Paulista, 1500',
  'Terminal Lapa',
  'Av. Francisco Matarazzo, 1000',
  'Rod. Anhanguera, km 18',
  'Terminal Pirituba',
] as const;

/** Pseudoaleatório determinístico por chave: o mesmo evento decide sempre igual. */
function rnd(...seeds: (number | string)[]): number {
  let h = 2166136261;
  for (const s of seeds) {
    for (const ch of String(s)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
  }
  return ((h >>> 0) % 10_000) / 10_000;
}
const pick = <T,>(arr: readonly T[], ...seeds: (number | string)[]): T => arr[Math.floor(rnd(...seeds) * arr.length)]!;
/** Minutos decorridos, já acelerados pelo DEMO_SPEED (variável de módulo, para os helpers fora da classe). */
let SPEED = 1;

/** Chave do ajuste persistido: ligado/desligado de dentro do sistema. */
const SETTING_KEY = 'demo.simulator';
const minutesSince = (d: Date | null | undefined, now: Date) => (d ? ((now.getTime() - d.getTime()) / MIN) * SPEED : Infinity);

type Users = Record<'admin' | 'cco' | 'pcm' | 'manut' | 'estoque' | 'plantao', { id: string; role: UserRole }>;

/**
 * Simulador de demonstração — a garagem continua viva sem ninguém operar.
 *
 * Ligado por DEMO_SIMULATOR=true. A cada 5 minutos ele faz, pela própria API
 * de negócio (nunca escrevendo estado direto), o que a operação faria:
 *
 *  - telemetria dos eBUS lança km de hora em hora; o diesel ganha lançamento
 *    manual de manhã (alguns carros atrasam, de propósito, para o alerta existir)
 *  - falhas novas surgem na proporção do MKBF da frota; a triagem decide entre
 *    deferir, socorro e recolher; o socorro chega, atua e dá o desfecho
 *  - na oficina, a OS sai da fila quando há valeta, a sub-OS pede material,
 *    o Estoque separa e entrega (às vezes falta peça), a inspeção aprova, a
 *    limpeza fecha o checklist e a Manutenção libera o carro
 *  - o Plantão abre reposição para a linha e designa reserva habilitada
 *
 * Só toca no que ele mesmo criou (FailureEvent.isSimulated): os cenários
 * montados no seed ficam parados para quem apresenta operar na mão.
 */
@Injectable()
export class DemoSimulatorService implements OnModuleInit {
  private readonly log = new Logger('Simulador');
  private enabled = false;
  private source: DemoStatus['source'] = 'env';
  private allHours = false;
  private busy = false;
  private lastPulseAt: Date | null = null;
  private lastSteps: string[] = [];
  private users: Users | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly odometer: OdometerService,
    private readonly events: EventsService,
    private readonly workOrders: WorkOrdersService,
    private readonly materials: MaterialsService,
    private readonly operations: OperationsService,
  ) {}

  async onModuleInit() {
    this.enabled = this.config.get<string>('DEMO_SIMULATOR') === 'true';
    this.allHours = this.config.get<string>('DEMO_ALL_HOURS') === 'true';
    SPEED = Number(this.config.get('DEMO_SPEED') ?? 1) || 1;

    // O ajuste feito pelo cabeçalho prevalece sobre o .env e sobrevive a reinícios.
    const saved = await this.prisma.appSetting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
    if (saved) {
      this.enabled = saved.value === 'true';
      this.source = 'setting';
    }

    if (this.enabled) {
      this.log.log(`ligado${this.source === 'setting' ? ' pelo sistema' : ''} — a garagem anda sozinha a cada 5 minutos${SPEED !== 1 ? ` (acelerado ${SPEED}×)` : ''}${this.allHours ? ' (sem horário de operação)' : ''}`);
      // Primeiro pulso logo após subir, para a demonstração não esperar o relógio.
      setTimeout(() => void this.pulse(), 20_000);
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  status(): DemoStatus {
    return {
      enabled: this.enabled,
      source: this.source,
      allHours: this.allHours,
      speed: SPEED,
      lastPulseAt: this.lastPulseAt?.toISOString() ?? null,
      lastSteps: this.lastSteps,
    };
  }

  /** Liga ou desliga de dentro do sistema; o estado fica gravado para o próximo reinício. */
  async setEnabled(enabled: boolean, userId?: string): Promise<DemoStatus> {
    await this.prisma.appSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: String(enabled), updatedBy: userId ?? null },
      update: { value: String(enabled), updatedBy: userId ?? null },
    });
    const was = this.enabled;
    this.enabled = enabled;
    this.source = 'setting';
    if (enabled && !was) {
      this.log.log('ligado pelo sistema — primeiro pulso em instantes');
      setTimeout(() => void this.pulse(), 3_000);
    } else if (!enabled && was) {
      this.log.log('desligado pelo sistema');
    }
    return this.status();
  }

  /** Hora "de operação": o simulador respeita a jornada, salvo DEMO_ALL_HOURS. */
  private hour(now: Date): number {
    return this.allHours ? 12 : now.getHours();
  }

  @Cron('*/5 * * * *', { name: 'demo-pulse' })
  async pulse(): Promise<string[]> {
    if (!this.enabled || this.busy) return [];
    this.busy = true;
    const now = new Date();
    const out: string[] = [];
    try {
      const users = await this.loadUsers();
      if (!users) return out;
      await this.step(out, 'telemetria', () => this.telemetry(now, users));
      await this.step(out, 'km manual', () => this.manualReadings(now, users));
      await this.step(out, 'retorno à linha', () => this.backToLine(now));
      await this.step(out, 'falhas novas', () => this.newFailures(now, users));
      await this.step(out, 'triagem', () => this.triage(now, users));
      await this.step(out, 'socorro', () => this.fieldServices(now, users));
      await this.step(out, 'oficina', () => this.workshop(now, users));
      await this.step(out, 'plantão', () => this.reserves(now, users));
      if (out.length) this.log.log(out.join(' · '));
      this.lastPulseAt = now;
      this.lastSteps = out;
      return out;
    } finally {
      this.busy = false;
    }
  }

  private async step(out: string[], name: string, fn: () => Promise<number>) {
    try {
      const n = await fn();
      if (n) out.push(`${name}: ${n}`);
    } catch (err) {
      this.log.warn(`${name} falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async loadUsers(): Promise<Users | null> {
    if (this.users) return this.users;
    const rows = await this.prisma.user.findMany({ where: { isActive: true }, select: { id: true, role: true } });
    const by = (role: UserRole) => rows.find((u) => u.role === role) ?? rows.find((u) => u.role === UserRole.ADMIN);
    const admin = by(UserRole.ADMIN);
    if (!admin) return null;
    this.users = {
      admin,
      cco: by(UserRole.CCO) ?? admin,
      pcm: by(UserRole.PCM) ?? admin,
      manut: by(UserRole.MANUTENCAO) ?? admin,
      estoque: by(UserRole.ESTOQUE) ?? admin,
      plantao: by(UserRole.PLANTAO) ?? admin,
    };
    return this.users;
  }

  // --- Quilometragem ---------------------------------------------------------

  /** eBUS: a telemetria escreve sozinha, de hora em hora, enquanto o carro roda. */
  private async telemetry(now: Date, users: Users): Promise<number> {
    if (this.hour(now) < 4) return 0;
    const rows = await this.prisma.vehicle.findMany({
      where: { isActive: true, kmSource: KmSource.TELEMETRY, status: VehicleStatus.IN_LINE },
      include: { kmProjection: { select: { avgDailyKm: true } } },
    });
    const entries: OdometerEntryInput[] = [];
    for (const v of rows) {
      const minutes = minutesSince(v.lastReadingAt, now);
      if (minutes < 55) continue;
      const avg = Number(v.kmProjection?.avgDailyKm ?? 170);
      const km = Math.round((avg * Math.min(minutes, 180)) / 1440 * (0.75 + rnd(v.code, now.getHours()) * 0.5));
      if (km <= 0) continue;
      entries.push({ vehicleId: v.id, rawKm: v.currentKm + km - v.odometerOffset, readAt: now });
    }
    let accepted = 0;
    for (let i = 0; i < entries.length; i += 100) {
      const r = await this.odometer.registerBatch({ entries: entries.slice(i, i + 100) }, users.admin.id, KmSource.TELEMETRY);
      accepted += r.accepted;
    }
    return accepted;
  }

  /** Diesel: o lançamento da manhã. Uns 7% dos carros ficam para trás — é o alerta do RF-14 acontecendo. */
  private async manualReadings(now: Date, users: Users): Promise<number> {
    const hour = this.hour(now);
    if (hour < 5 || hour > 10) return 0;
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const rows = await this.prisma.vehicle.findMany({
      where: {
        isActive: true,
        kmSource: KmSource.MANUAL,
        status: { in: [VehicleStatus.IN_LINE, VehicleStatus.AVAILABLE] },
        OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: startOfDay } }],
      },
      include: { kmProjection: { select: { avgDailyKm: true } } },
    });
    const dayKey = Math.floor(now.getTime() / DAY);
    const entries: OdometerEntryInput[] = [];
    for (const v of rows) {
      // Quem fica atrasado hoje tende a lançar amanhã: a sorte muda a cada dia.
      if (rnd(v.code, dayKey) < 0.07) continue;
      const days = v.lastReadingAt ? Math.max(0.5, (now.getTime() - v.lastReadingAt.getTime()) / DAY) : 1;
      const avg = Number(v.kmProjection?.avgDailyKm ?? 200);
      const km = Math.round(avg * days * (0.85 + rnd(v.code, dayKey, 'km') * 0.3));
      if (km <= 0) continue;
      entries.push({ vehicleId: v.id, rawKm: v.currentKm + km - v.odometerOffset, readAt: now });
    }
    let accepted = 0;
    for (let i = 0; i < entries.length; i += 100) {
      const r = await this.odometer.registerBatch({ entries: entries.slice(i, i + 100) }, users.pcm.id, KmSource.MANUAL);
      accepted += r.accepted;
    }
    return accepted;
  }

  /** Carro liberado volta para a linha depois de um tempo no pátio. Reserva fica esperando o Plantão. */
  private async backToLine(now: Date): Promise<number> {
    const hour = this.hour(now);
    if (hour < 4 || hour > 22) return 0;
    const r = await this.prisma.vehicle.updateMany({
      where: { isActive: true, status: VehicleStatus.AVAILABLE, fleetRole: 'OPERACIONAL', updatedAt: { lt: new Date(now.getTime() - (25 / SPEED) * MIN) } },
      data: { status: VehicleStatus.IN_LINE },
    });
    return r.count;
  }

  // --- Corretivo -------------------------------------------------------------

  /** Falhas surgem na rua na proporção do MKBF: ~15 por dia numa frota de 450. */
  private async newFailures(now: Date, users: Users): Promise<number> {
    const hour = this.hour(now);
    if (hour < 5 || hour > 23) return 0;
    const inLine = await this.prisma.vehicle.count({ where: { isActive: true, status: VehicleStatus.IN_LINE } });
    // 15 falhas/dia em 18 h de operação, a cada 5 min → ~0,07 por pulso para 400 carros.
    const expected = (inLine / 400) * (15 / 216) * SPEED;
    let n = 0;
    while (Math.random() < expected - n) n += 1;
    if (n === 0) return 0;

    const catalog = await this.prisma.failureCatalogItem.findMany({ where: { isActive: true } });
    if (!catalog.length) return 0;
    const weights: Record<string, number> = { 'AC-CLI-01': 30, 'CAR-POR-01': 20, 'ELE-ALT-01': 15, 'PNE-APU-01': 13, 'MEC-MOT-01': 10, 'PNE-CUI-01': 7 };
    const weighted = catalog.flatMap((c) => Array.from({ length: weights[c.code] ?? 5 }, () => c));
    const operators = await this.prisma.operator.findMany({ where: { isActive: true, function: 'MOTORISTA' }, select: { id: true }, take: 300 });

    let created = 0;
    for (let i = 0; i < n; i += 1) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { isActive: true, status: VehicleStatus.IN_LINE },
        skip: Math.floor(Math.random() * inLine),
      });
      if (!vehicle) break;
      const item = weighted[Math.floor(Math.random() * weighted.length)]!;
      const origin = Math.random() < 0.65 ? EventOrigin.OPERATOR : EventOrigin.CCO;
      const input: CreateEventInput = {
        vehicleId: vehicle.id,
        catalogItemId: item.id,
        origin,
        lineCode: LINES[Math.floor(Math.random() * LINES.length)],
        locationDescription: PLACES[Math.floor(Math.random() * PLACES.length)],
        operatorId: operators.length ? operators[Math.floor(Math.random() * operators.length)]!.id : undefined,
      };
      const ev = await this.events.create(input, origin === EventOrigin.CCO ? users.cco.id : users.plantao.id);
      await this.prisma.failureEvent.update({ where: { id: ev.id }, data: { isSimulated: true } });
      created += 1;
      // Linha sem carro: o Plantão abre a janela de reposição na hora.
      if (Math.random() < 0.6) {
        await this.operations.createDemand({ lineCode: input.lineCode!, originVehicleId: vehicle.id, windowMinutes: 40 }, users.cco.id);
      }
    }
    return created;
  }

  /** PCM decide em 8–25 min: deferir quando cabe na parada, socorro quando resolve na rua, recolher no resto. */
  private async triage(now: Date, users: Users): Promise<number> {
    const pending = await this.prisma.failureEvent.findMany({
      where: { isSimulated: true, status: EventStatus.REGISTERED, triage: null },
      include: { catalogItem: true },
      orderBy: { reportedAt: 'asc' },
      take: 6,
    });
    const deferral = await this.prisma.reasonCode.findMany({ where: { list: ReasonCodeList.EVENT_DEFERRAL, isActive: true } });
    let done = 0;
    for (const ev of pending) {
      const wait = 8 + rnd(ev.id, 'sla') * 17;
      if (minutesSince(ev.reportedAt, now) < wait) continue;
      const item = ev.catalogItem;
      const r = rnd(ev.id, 'dest');
      let input: TriageInput;
      if (item && !item.isSafety && item.isDeferrable && r < 0.3 && deferral.length) {
        input = { destination: TriageDestination.DEFER, reasonCodeId: pick(deferral, ev.id).id, note: 'Cabe na próxima parada programada' };
      } else if (r < 0.55 + (Number(item?.fieldResolutionRate ?? 0.3) - 0.3)) {
        input = { destination: TriageDestination.FIELD };
      } else {
        input = { destination: TriageDestination.RECALL };
      }
      await this.events.triage(ev.id, input, users.pcm.id);
      done += 1;
    }
    return done;
  }

  /** Socorro: despacho, chegada, atuação e desfecho — cada passo no seu tempo. */
  private async fieldServices(now: Date, users: Users): Promise<number> {
    const rows = await this.prisma.failureEvent.findMany({
      where: { isSimulated: true, status: EventStatus.FIELD_SERVICE, fieldService: { outcome: null } },
      include: { fieldService: true, triage: true, catalogItem: true },
      take: 8,
    });
    let moved = 0;
    for (const ev of rows) {
      const fs = ev.fieldService!;
      const t0 = ev.triage?.decidedAt ?? ev.reportedAt;
      if (!fs.technicianId) {
        await this.events.dispatch(ev.id, { supportVehicleCode: pick(['APOIO-1', 'APOIO-2', 'APOIO-3'], ev.id) }, users.plantao.id);
        moved += 1;
      } else if (!fs.arrivedAt) {
        if (minutesSince(t0, now) >= 20 + rnd(ev.id, 'arr') * 25) {
          await this.events.fieldStep(ev.id, { step: FieldStep.ARRIVED }, users.plantao.id);
          moved += 1;
        }
      } else if (!fs.startedAt) {
        if (minutesSince(fs.arrivedAt, now) >= 5) {
          await this.events.fieldStep(ev.id, { step: FieldStep.STARTED }, users.plantao.id);
          moved += 1;
        }
      } else if (!fs.finishedAt) {
        if (minutesSince(fs.startedAt, now) >= 25 + rnd(ev.id, 'fix') * 45) {
          await this.events.fieldStep(ev.id, { step: FieldStep.FINISHED }, users.plantao.id);
          moved += 1;
        }
      } else {
        const safety = Boolean(ev.isSafety || ev.catalogItem?.isSafety);
        const r = rnd(ev.id, 'out');
        const outcome = safety
          ? r < 0.7 ? FieldOutcome.TOWED : FieldOutcome.RETURNED_UNDER_OWN_POWER
          : r < 0.75 ? FieldOutcome.RESOLVED_IN_FIELD : FieldOutcome.RETURNED_UNDER_OWN_POWER;
        const input: FieldOutcomeInput = { outcome, materials: [], note: outcome === FieldOutcome.RESOLVED_IN_FIELD ? 'Resolvido na rua, carro segue na linha' : undefined };
        await this.events.fieldOutcome(ev.id, input, users.plantao.id);
        moved += 1;
      }
    }
    return moved;
  }

  /** A oficina: fila → valeta → material → encerramento → inspeção → limpeza → liberação. */
  private async workshop(now: Date, users: Users): Promise<number> {
    const rows = await this.prisma.workOrder.findMany({
      where: { status: { notIn: [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED] }, event: { isSimulated: true } },
      include: {
        event: { include: { catalogItem: true } },
        tasks: { where: { status: { not: TaskStatus.CANCELLED } }, include: { checklistItems: true, inspections: { orderBy: { inspectedAt: 'desc' }, take: 1 }, materialRequests: true } },
        cleaning: { include: { checklistItems: true } },
      },
      orderBy: { openedAt: 'asc' },
      take: 40,
    });
    const inProgress = await this.prisma.workOrder.count({ where: { status: WorkOrderStatus.IN_PROGRESS } });
    const BAYS = 14;
    let busyBays = inProgress;
    let moved = 0;

    const specialties = await this.prisma.specialty.findMany();
    const specialtyFor = (system: string | null | undefined) => {
      const code = { Elétrica: 'ELE', Pneumático: 'MEC', Motor: 'MEC', Conforto: 'AC', Carroceria: 'FUN' }[system ?? ''] ?? 'MEC';
      return specialties.find((s) => s.code === code) ?? specialties[0]!;
    };
    const rejection = await this.prisma.reasonCode.findMany({ where: { list: ReasonCodeList.INSPECTION_REJECTION, isActive: true } });
    const partWaiting = await this.prisma.reasonCode.findMany({ where: { list: ReasonCodeList.PART_WAITING, isActive: true } });

    for (const wo of rows) {
      if (moved >= 12) break;
      const item = wo.event?.catalogItem ?? null;
      const execMinutes = (item?.estimatedRepairMinutes ?? 150) * (0.8 + rnd(wo.id, 'exec') * 0.7);

      // 1. Na fila: entra na valeta quando há vaga e já esperou o seu tempo.
      if (wo.status === WorkOrderStatus.OPEN) {
        if (wo.tasks.length) continue;
        const queueDwell = 15 + rnd(wo.id, 'queue') * 150;
        if (busyBays >= BAYS || minutesSince(wo.openedAt, now) < queueDwell) continue;
        const spec = specialtyFor(item?.system);
        const detail = await this.workOrders.addTask(
          wo.id,
          {
            specialtyId: spec.id,
            description: item ? `Corrigir: ${item.description.toLowerCase()}` : 'Diagnóstico e correção',
            checklist: [{ description: 'Diagnóstico confirmado' }, { description: 'Componente substituído/reparado' }, { description: 'Teste funcional' }],
          },
          users.manut.id,
        );
        const task = detail.tasks[0];
        if (task) await this.workOrders.startTask(task.id, users.manut.id);
        busyBays += 1;
        moved += 1;
        continue;
      }

      // 2. Em execução (ou parada por material).
      if (wo.status === WorkOrderStatus.IN_PROGRESS || wo.status === WorkOrderStatus.WAITING_PART) {
        const task = wo.tasks.find((t) => t.status === TaskStatus.IN_PROGRESS || t.status === TaskStatus.BLOCKED_BY_MATERIAL || t.status === TaskStatus.PENDING);
        if (!task) {
          // Todas concluídas: portão 1.
          if (wo.tasks.length && wo.tasks.every((t) => t.status === TaskStatus.DONE || t.status === TaskStatus.APPROVED)) {
            await this.workOrders.techClose(wo.id, users.manut.id);
            moved += 1;
          }
          continue;
        }
        if (task.status === TaskStatus.PENDING) {
          await this.workOrders.startTask(task.id, users.manut.id);
          moved += 1;
          continue;
        }
        const started = task.startedAt ?? wo.openedAt;
        const elapsed = minutesSince(started, now);
        const items = [...task.checklistItems].sort((a, b) => a.sequence - b.sequence);
        const open = task.materialRequests.filter((m) => ([MaterialRequestStatus.REQUESTED, MaterialRequestStatus.SEPARATED, MaterialRequestStatus.WAITING_PART] as string[]).includes(m.status));

        // 2a. Diagnóstico feito nos primeiros minutos; às vezes precisa de peça.
        if (items[0] && !items[0].isChecked && elapsed >= Math.min(20, execMinutes * 0.2)) {
          await this.workOrders.toggleChecklistItem(items[0].id, { isChecked: true });
          moved += 1;
          if (!task.materialRequests.length && rnd(wo.id, 'needs-part') < 0.4) {
            const material = await this.pickMaterial(item?.system);
            if (material) await this.materials.request({ workOrderTaskId: task.id, materialId: material.id, quantity: 1, blocksTask: true }, users.manut.id);
          }
          continue;
        }

        // 2b. O Estoque atende o pedido: separa e entrega — ou declara falta de peça.
        const req = open[0];
        if (req) {
          const age = minutesSince(req.requestedAt, now);
          if (req.status === MaterialRequestStatus.REQUESTED && age >= 8) {
            if (rnd(req.id, 'missing') < 0.18 && partWaiting.length) {
              await this.materials.waitForPart(req.id, { reasonCodeId: pick(partWaiting, req.id).id, expectedAt: new Date(now.getTime() + ((4 + rnd(req.id, 'eta') * 20) / SPEED) * HOUR) }, users.estoque.id);
            } else {
              await this.materials.separate(req.id, {}, users.estoque.id);
            }
            moved += 1;
          } else if (req.status === MaterialRequestStatus.SEPARATED && minutesSince(req.separatedAt, now) >= 6) {
            await this.materials.deliver(req.id, { receivedByName: pick(['Carlos (valeta 3)', 'Edson (valeta 1)', 'Marcos (valeta 5)'], req.id) }, users.estoque.id);
            moved += 1;
          } else if (req.status === MaterialRequestStatus.WAITING_PART) {
            const pw = await this.prisma.partWaiting.findUnique({ where: { materialRequestId: req.id } });
            if (pw && pw.expectedAt <= now) {
              await this.materials.separate(req.id, {}, users.estoque.id);
              moved += 1;
            }
          }
          continue;
        }
        if (task.status === TaskStatus.BLOCKED_BY_MATERIAL) continue;

        // 2c. Serviço feito: fecha o checklist e conclui com a causa constatada.
        if (elapsed >= execMinutes) {
          for (const it of items) if (!it.isChecked) await this.workOrders.toggleChecklistItem(it.id, { isChecked: true });
          await this.workOrders.finishTask(task.id, item ? { confirmedCatalogItemId: item.id } : { confirmedFailureModeCode: 'IN', confirmedSubsystemCode: '030-001' }, users.manut.id);
          moved += 1;
        }
        continue;
      }

      // 3. Encerrada tecnicamente: inspeção por sub-OS, depois limpeza, depois liberação.
      if (wo.status === WorkOrderStatus.TECH_CLOSED || wo.status === WorkOrderStatus.IN_INSPECTION || wo.status === WorkOrderStatus.IN_CLEANING) {
        const uninspected = wo.tasks.filter((t) => t.status === TaskStatus.DONE && t.inspections.length === 0);
        if (uninspected.length) {
          if (minutesSince(wo.techClosedAt, now) < 10 + rnd(wo.id, 'insp') * 25) continue;
          const task = uninspected[0]!;
          const rejected = rnd(task.id, 'reject') < 0.06 && rejection.length;
          await this.workOrders.inspect(
            task.id,
            rejected
              ? { result: InspectionResult.REJECTED, reasonCodeId: pick(rejection, task.id).id, note: 'Reaberta para acerto', measurements: [] }
              : { result: InspectionResult.APPROVED, measurements: [] },
            users.admin.id,
          );
          moved += 1;
          continue;
        }
        const cleaning = wo.cleaning;
        if (!cleaning) continue;
        if (cleaning.status === 'PENDING') {
          await this.workOrders.startCleaning(wo.id, users.admin.id);
          moved += 1;
        } else if (cleaning.status === 'IN_PROGRESS') {
          const pendingItems = cleaning.checklistItems.filter((i) => !i.isChecked);
          if (pendingItems.length) {
            if (minutesSince(cleaning.startedAt, now) < 12) continue;
            for (const it of pendingItems) await this.workOrders.toggleCleaningItem(it.id, true);
            await this.workOrders.finishCleaning(wo.id, users.admin.id);
          } else {
            await this.workOrders.finishCleaning(wo.id, users.admin.id);
          }
          moved += 1;
        } else if (cleaning.status === 'DONE') {
          await this.workOrders.release(wo.id, users.manut.id, UserRole.MANUTENCAO);
          moved += 1;
        }
      }
    }
    return moved;
  }

  private async pickMaterial(system: string | null | undefined) {
    const term = { Elétrica: 'ALTERNADOR', Pneumático: 'VALVULA', Motor: 'CORREIA', Conforto: 'FILTRO ANTI POLEN', Carroceria: 'CILINDRO PORTA' }[system ?? ''] ?? 'FILTRO';
    const candidates = await this.prisma.material.findMany({
      where: { isActive: true, isSerialized: false, stockQty: { gt: 0 }, description: { contains: term, mode: 'insensitive' } },
      take: 20,
    });
    if (!candidates.length) return this.prisma.material.findFirst({ where: { isActive: true, isSerialized: false, stockQty: { gt: 0 } } });
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  }

  /** Plantão: designa reserva habilitada para a linha e recolhe quando o titular volta. */
  private async reserves(now: Date, users: Users): Promise<number> {
    let moved = 0;
    // Só as demandas que nasceram de uma falha simulada: as do seed ficam para o apresentador.
    const simulatedOrigin = { originVehicle: { failureEvents: { some: { isSimulated: true, status: { notIn: [EventStatus.CLOSED, EventStatus.CANCELLED] } } } } };
    const open = await this.prisma.replacementDemand.findMany({
      where: { status: ReplacementDemandStatus.OPEN, windowEndsAt: { gt: now }, ...simulatedOrigin },
      include: { originVehicle: true },
      take: 5,
    });
    for (const d of open) {
      if (minutesSince(d.requestedAt, now) < 4 + rnd(d.id, 'assign') * 14) continue;
      const reserve = await this.prisma.vehicle.findFirst({
        where: {
          isActive: true,
          status: VehicleStatus.AVAILABLE,
          fleetRole: 'RESERVA',
          ...(d.originVehicle ? { technology: d.originVehicle.technology, vehicleClass: d.originVehicle.vehicleClass ?? undefined } : {}),
        },
      });
      if (!reserve) continue;
      const candidates = await this.operations.operatorCandidates(reserve.id);
      if (!candidates.length) continue;
      const op = candidates[Math.floor(Math.random() * candidates.length)]!;
      await this.operations.assignReserve(d.id, { vehicleId: reserve.id, operatorId: op.operatorId }, users.plantao.id);
      moved += 1;
    }
    // Titular voltou (ou o turno acabou): recolhe a reserva.
    const onStreet = await this.prisma.replacementDemand.findMany({
      where: { status: ReplacementDemandStatus.ASSIGNED, assignments: { some: { returnedAt: null } }, originVehicle: { failureEvents: { some: { isSimulated: true } } } },
      include: { originVehicle: { select: { status: true } }, assignments: { where: { returnedAt: null }, take: 1 } },
      take: 10,
    });
    for (const d of onStreet) {
      const a = d.assignments[0];
      if (!a) continue;
      const titularBack = d.originVehicle ? ([VehicleStatus.IN_LINE, VehicleStatus.AVAILABLE] as string[]).includes(d.originVehicle.status) : false;
      const hours = ((now.getTime() - a.assignedAt.getTime()) / HOUR) * SPEED;
      if ((titularBack && hours >= 1) || hours >= 9) {
        await this.operations.returnReserve(d.id, users.plantao.id);
        moved += 1;
      }
    }
    return moved;
  }
}
