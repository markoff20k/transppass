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

  console.log('Seed do R0 concluído.');
  console.log(`  admin: admin@transppass.local / admin123 (id ${admin.id})`);
  console.log('  personas: pcm@ cco@ plantao@ manutencao@ estoque@ transppass.local / transppass123');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
