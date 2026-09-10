import {
  KmSource,
  PrismaClient,
  ReasonCodeList,
  UserRole,
  VehicleTechnology,
} from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Seed do R0.
 *
 * Traz só o que o PRD já define. O que é questão aberta (seção 12) entra como
 * exemplo marcado, não como verdade: o conteúdo final das cinco listas de
 * códigos e as flags de fast-track/segurança serão fechados por PCM,
 * Manutenção, Estoque e Operação antes do R1.
 */
const prisma = new PrismaClient();

async function main() {
  const garage = await prisma.garage.upsert({
    where: { code: 'G01' },
    update: {},
    create: { code: 'G01', name: 'Garagem Principal' },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@transppass.local' },
    update: {},
    create: {
      name: 'Administrador',
      email: 'admin@transppass.local',
      passwordHash: await argon2.hash('admin123', { type: argon2.argon2id }),
      role: UserRole.ADMIN,
      garageId: garage.id,
    },
  });

  // Perfis das personas da seção 5 do PRD, para o piloto por área.
  const personas: Array<{ email: string; name: string; role: UserRole }> = [
    { email: 'pcm@transppass.local', name: 'PCM', role: UserRole.PCM },
    { email: 'cco@transppass.local', name: 'CCO', role: UserRole.CCO },
    { email: 'plantao@transppass.local', name: 'Plantão', role: UserRole.PLANTAO },
    { email: 'manutencao@transppass.local', name: 'Manutenção', role: UserRole.MANUTENCAO },
    { email: 'estoque@transppass.local', name: 'Estoque', role: UserRole.ESTOQUE },
  ];

  for (const p of personas) {
    await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: {
        name: p.name,
        email: p.email,
        passwordHash: await argon2.hash('transppass123', { type: argon2.argon2id }),
        role: p.role,
        garageId: garage.id,
      },
    });
  }

  const specialties = [
    { code: 'MEC', name: 'Mecânica' },
    { code: 'ELE', name: 'Elétrica' },
    { code: 'FUN', name: 'Funilaria' },
    { code: 'PNE', name: 'Pneus' },
    { code: 'AC', name: 'Ar-condicionado' },
  ];
  for (const s of specialties) {
    await prisma.specialty.upsert({ where: { code: s.code }, update: {}, create: s });
  }

  /**
   * Catálogo de falhas — versão 1 em rascunho, partindo dos campeões do
   * ranking IIO citados na seção 2 do PRD (mitigação do risco "catálogo
   * incompleto no início"). As flags abaixo são PROPOSTA: a definição de quais
   * falhas recebem fast-track e segurança é questão aberta do PRD.
   */
  const version = await prisma.failureCatalogVersion.upsert({
    where: { version: 1 },
    update: {},
    create: { version: 1, notes: 'Rascunho inicial a partir do ranking IIO 2025/2026' },
  });

  const catalogItems = [
    {
      code: 'ELE-ALT-01',
      description: 'Alternador não carrega',
      system: 'Elétrica',
      subsystem: 'Carga',
      isFastTrack: true,
      isSafety: false,
      isDeferrable: false,
      probableCause: 'Alternador ou regulador de tensão',
      estimatedRepairMinutes: 180,
    },
    {
      code: 'PNE-APU-01',
      description: 'Válvula APU com vazamento',
      system: 'Pneumático',
      subsystem: 'Ar',
      isFastTrack: true,
      isSafety: true,
      isDeferrable: false,
      probableCause: 'Válvula APU',
      estimatedRepairMinutes: 120,
    },
    {
      code: 'PNE-CUI-01',
      description: 'Cuíca de freio inoperante',
      system: 'Pneumático',
      subsystem: 'Freio',
      isFastTrack: true,
      isSafety: true,
      isDeferrable: false,
      probableCause: 'Cuíca de freio',
      estimatedRepairMinutes: 150,
    },
    {
      code: 'MEC-MOT-01',
      description: 'Superaquecimento do motor',
      system: 'Motor',
      subsystem: 'Arrefecimento',
      isFastTrack: false,
      isSafety: true,
      isDeferrable: false,
      probableCause: 'Radiador, bomba d’água ou correia',
      estimatedRepairMinutes: 240,
    },
    {
      code: 'AC-CLI-01',
      description: 'Ar-condicionado sem refrigeração',
      system: 'Conforto',
      subsystem: 'Climatização',
      isFastTrack: false,
      isSafety: false,
      isDeferrable: true,
      probableCause: 'Carga de gás ou compressor',
      estimatedRepairMinutes: 120,
    },
    {
      code: 'CAR-POR-01',
      description: 'Porta não fecha completamente',
      system: 'Carroceria',
      subsystem: 'Portas',
      isFastTrack: false,
      isSafety: true,
      isDeferrable: false,
      probableCause: 'Cilindro ou sensor de porta',
      estimatedRepairMinutes: 90,
    },
  ];

  for (const item of catalogItems) {
    await prisma.failureCatalogItem.upsert({
      where: { versionId_code: { versionId: version.id, code: item.code } },
      update: {},
      create: { ...item, versionId: version.id },
    });
  }

  /**
   * As cinco listas do RF-33. Os códigos abaixo são exemplos estruturais para
   * destravar as telas 6.3 e 6.4 em desenvolvimento — o conteúdo definitivo é
   * dependência declarada do PRD (seção 9) e precisa ser carregado antes do R1.
   */
  const reasonCodes: Array<{ list: ReasonCodeList; code: string; description: string }> = [
    { list: ReasonCodeList.QUEUE_PRIORITY, code: 'SEG', description: 'Risco de segurança' },
    { list: ReasonCodeList.QUEUE_PRIORITY, code: 'CONTR', description: 'Exigência contratual' },
    { list: ReasonCodeList.QUEUE_PRIORITY, code: 'DISP', description: 'Disponibilidade da linha' },
    { list: ReasonCodeList.SCHEDULE_RESCHEDULE, code: 'MAT', description: 'Falta de material' },
    { list: ReasonCodeList.SCHEDULE_RESCHEDULE, code: 'EQP', description: 'Equipe indisponível' },
    { list: ReasonCodeList.SCHEDULE_RESCHEDULE, code: 'OPER', description: 'Necessidade da operação' },
    { list: ReasonCodeList.INSPECTION_REJECTION, code: 'FOLGA', description: 'Folga fora de especificação' },
    { list: ReasonCodeList.INSPECTION_REJECTION, code: 'VAZ', description: 'Vazamento constatado' },
    { list: ReasonCodeList.INSPECTION_REJECTION, code: 'ACAB', description: 'Acabamento reprovado' },
    { list: ReasonCodeList.PART_WAITING, code: 'SEMEST', description: 'Sem saldo em estoque' },
    { list: ReasonCodeList.PART_WAITING, code: 'COMPRA', description: 'Aguardando compra' },
    { list: ReasonCodeList.PART_WAITING, code: 'OFIC', description: 'Em recuperação na Oficina' },
    { list: ReasonCodeList.EVENT_DEFERRAL, code: 'BAIXO', description: 'Baixo impacto na operação' },
    { list: ReasonCodeList.EVENT_DEFERRAL, code: 'JANELA', description: 'Cabe na próxima janela preventiva' },
  ];

  for (const rc of reasonCodes) {
    await prisma.reasonCode.upsert({
      where: { list_code: { list: rc.list, code: rc.code } },
      update: {},
      create: rc,
    });
  }

  // Frota de exemplo: as duas tecnologias, com fontes de km diferentes (RF-35).
  const vehicles = [
    { code: '10001', plate: 'ABC1D23', technology: VehicleTechnology.DIESEL, kmSource: KmSource.MANUAL },
    { code: '10002', plate: 'ABC1D24', technology: VehicleTechnology.DIESEL, kmSource: KmSource.MANUAL },
    { code: '10003', plate: 'ABC1D25', technology: VehicleTechnology.DIESEL, kmSource: KmSource.MANUAL },
    { code: '20001', plate: 'EBS1A01', technology: VehicleTechnology.EBUS, kmSource: KmSource.TELEMETRY },
    { code: '20002', plate: 'EBS1A02', technology: VehicleTechnology.EBUS, kmSource: KmSource.TELEMETRY },
  ];

  for (const v of vehicles) {
    await prisma.vehicle.upsert({
      where: { code: v.code },
      update: {},
      create: { ...v, garageId: garage.id },
    });
  }

  // Plano preventivo com as janelas de 7.500 / 15.000 km citadas na seção 2.
  const plan = await prisma.maintenancePlan.upsert({
    where: { code_version: { code: 'PLAN-DIESEL', version: 1 } },
    update: {},
    create: {
      code: 'PLAN-DIESEL',
      name: 'Plano preventivo — frota diesel',
      technology: VehicleTechnology.DIESEL,
      version: 1,
      effectiveFrom: new Date('2026-01-01'),
      controlledDocument: 'IT.MAN-01',
    },
  });

  for (const pkg of [
    { code: 'P1', name: 'Revisão de 7.500 km', intervalKm: 7500 },
    { code: 'P2', name: 'Revisão de 15.000 km', intervalKm: 15000 },
  ]) {
    await prisma.maintenancePackage.upsert({
      where: { planId_code: { planId: plan.id, code: pkg.code } },
      update: {},
      create: { ...pkg, planId: plan.id, toleranceKm: 500 },
    });
  }

  // ---- R2: plano eBUS, kits, materiais, ferramentas, pool, operadores ----

  const ebusPlan = await prisma.maintenancePlan.upsert({
    where: { code_version: { code: 'PLAN-EBUS', version: 1 } },
    update: {},
    create: {
      code: 'PLAN-EBUS',
      name: 'Plano preventivo — eBUS',
      technology: VehicleTechnology.EBUS,
      version: 1,
      effectiveFrom: new Date('2026-01-01'),
      controlledDocument: 'IT.MAN-54',
    },
  });
  const ebusPkg = await prisma.maintenancePackage.upsert({
    where: { planId_code: { planId: ebusPlan.id, code: 'E1' } },
    update: {},
    create: { code: 'E1', name: 'Revisão de 10.000 km', intervalKm: 10000, toleranceKm: 500, planId: ebusPlan.id },
  });

  const specialtyByCode = Object.fromEntries(
    (await prisma.specialty.findMany()).map((s) => [s.code, s.id]),
  ) as Record<string, string>;

  const dieselPkgs = await prisma.maintenancePackage.findMany({ where: { planId: plan.id } });
  const p1 = dieselPkgs.find((p) => p.code === 'P1')!;
  const p2 = dieselPkgs.find((p) => p.code === 'P2')!;

  const tasks: Array<{ packageId: string; code: string; description: string; specialty: string; minutes: number }> = [
    { packageId: p1.id, code: 'T01', description: 'Troca de óleo e filtro do motor', specialty: 'MEC', minutes: 60 },
    { packageId: p1.id, code: 'T02', description: 'Filtro de ar', specialty: 'MEC', minutes: 20 },
    { packageId: p1.id, code: 'T03', description: 'Filtro de combustível', specialty: 'MEC', minutes: 25 },
    { packageId: p1.id, code: 'T04', description: 'Inspeção de freios e cuícas', specialty: 'PNE', minutes: 45 },
    { packageId: p1.id, code: 'T05', description: 'Verificação do sistema de carga', specialty: 'ELE', minutes: 30 },
    { packageId: p1.id, code: 'T06', description: 'Lubrificação de articulações', specialty: 'MEC', minutes: 30 },
    { packageId: p2.id, code: 'T01', description: 'Troca de óleo e filtro do motor', specialty: 'MEC', minutes: 60 },
    { packageId: p2.id, code: 'T02', description: 'Filtros de ar, combustível e cabine', specialty: 'MEC', minutes: 45 },
    { packageId: p2.id, code: 'T03', description: 'Inspeção completa de freios', specialty: 'PNE', minutes: 90 },
    { packageId: p2.id, code: 'T04', description: 'Sistema de carga e baterias', specialty: 'ELE', minutes: 45 },
    { packageId: p2.id, code: 'T05', description: 'Ar-condicionado: carga e filtros', specialty: 'AC', minutes: 60 },
    { packageId: ebusPkg.id, code: 'T01', description: 'Inspeção do pack de baterias', specialty: 'ELE', minutes: 60 },
    { packageId: ebusPkg.id, code: 'T02', description: 'Torque das conexões de alta tensão', specialty: 'ELE', minutes: 40 },
    { packageId: ebusPkg.id, code: 'T03', description: 'Inspeção de freios regenerativos', specialty: 'PNE', minutes: 45 },
  ];
  for (const t of tasks) {
    await prisma.maintenanceTask.upsert({
      where: { packageId_code: { packageId: t.packageId, code: t.code } },
      update: {},
      create: { packageId: t.packageId, code: t.code, description: t.description, specialtyId: specialtyByCode[t.specialty], estimatedMinutes: t.minutes },
    });
  }

  const materials = [
    { code: 'OLEO-15W40', description: 'Óleo motor 15W40', unit: 'L', isSerialized: false },
    { code: 'FIL-OL-01', description: 'Filtro de óleo', unit: 'un', isSerialized: false },
    { code: 'FIL-AR-01', description: 'Filtro de ar motor', unit: 'un', isSerialized: false },
    { code: 'FIL-CB-01', description: 'Filtro de combustível', unit: 'un', isSerialized: false },
    { code: 'FIL-INV-01', description: 'Filtro de ar do inversor', unit: 'un', isSerialized: false },
    { code: 'ALT-24V', description: 'Alternador 24V 110A', unit: 'un', isSerialized: true },
    { code: 'VAL-APU-01', description: 'Válvula APU', unit: 'un', isSerialized: true },
    { code: 'CUI-FR-DT', description: 'Cuíca de freio dianteira 24"', unit: 'un', isSerialized: true },
  ];
  const materialByCode: Record<string, string> = {};
  for (const m of materials) {
    const row = await prisma.material.upsert({ where: { code: m.code }, update: {}, create: m });
    materialByCode[m.code] = row.id;
  }
  const materialId = (code: string): string => {
    const id = materialByCode[code];
    if (!id) throw new Error(`Seed: material ${code} não cadastrado`);
    return id;
  };

  const kit1 = await prisma.kit.upsert({
    where: { code_version: { code: 'KIT-P1', version: 1 } },
    update: {},
    create: { code: 'KIT-P1', name: 'Kit 7.500 km diesel', packageId: p1.id, version: 1, effectiveFrom: new Date('2026-01-01') },
  });
  const kitE1 = await prisma.kit.upsert({
    where: { code_version: { code: 'KIT-E1', version: 1 } },
    update: {},
    create: { code: 'KIT-E1', name: 'Kit 10.000 km eBUS', packageId: ebusPkg.id, version: 1, effectiveFrom: new Date('2026-01-01') },
  });
  for (const [kitId, code, qty] of [
    [kit1.id, 'OLEO-15W40', 28], [kit1.id, 'FIL-OL-01', 1], [kit1.id, 'FIL-AR-01', 1], [kit1.id, 'FIL-CB-01', 2],
    [kitE1.id, 'FIL-INV-01', 1],
  ] as const) {
    await prisma.kitItem.upsert({
      where: { kitId_materialId: { kitId, materialId: materialId(code) } },
      update: {},
      create: { kitId, materialId: materialId(code), quantity: qty },
    });
  }

  for (const t of [
    { code: 'TORQ-01', description: 'Torquímetro 40–200 N·m', calibrationDueAt: new Date(Date.now() + 40 * 86_400_000) },
    { code: 'TORQ-02', description: 'Torquímetro 200–800 N·m', calibrationDueAt: new Date(Date.now() - 5 * 86_400_000) },
    { code: 'MAN-01', description: 'Manômetro de ar 0–12 bar', calibrationDueAt: new Date(Date.now() + 120 * 86_400_000) },
  ]) {
    await prisma.tool.upsert({ where: { code: t.code }, update: {}, create: t });
  }

  for (const [serial, code] of [['ALT-20431', 'ALT-24V'], ['ALT-20432', 'ALT-24V'], ['ALT-20433', 'ALT-24V'], ['APU-77812', 'VAL-APU-01']] as const) {
    await prisma.poolComponent.upsert({
      where: { serialNumber: serial },
      update: {},
      create: { serialNumber: serial, materialId: materialId(code) },
    });
  }

  // Matriz de habilitações: consumida, não administrada (seção 4 do PRD).
  const operators = [
    { registration: '30412', name: 'Operador de reserva A', techs: [VehicleTechnology.DIESEL, VehicleTechnology.EBUS] },
    { registration: '30877', name: 'Operador de reserva B', techs: [VehicleTechnology.DIESEL] },
    { registration: '31105', name: 'Operador de reserva C', techs: [VehicleTechnology.EBUS] },
    { registration: '29980', name: 'Operador de reserva D', techs: [VehicleTechnology.DIESEL] },
  ];
  for (const o of operators) {
    const row = await prisma.operator.upsert({
      where: { registration: o.registration },
      update: {},
      create: { registration: o.registration, name: o.name },
    });
    for (const technology of o.techs) {
      await prisma.operatorQualification.upsert({
        where: { operatorId_technology: { operatorId: row.id, technology } },
        update: {},
        create: { operatorId: row.id, technology },
      });
    }
  }

  console.log('Seed do R0/R1/R2 concluído.');
  console.log(`  admin: admin@transppass.local / admin123 (id ${admin.id})`);
  console.log('  personas: pcm@ cco@ plantao@ manutencao@ estoque@ transppass.local / transppass123');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
