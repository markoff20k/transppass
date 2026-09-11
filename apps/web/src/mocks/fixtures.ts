import {
  KmSource,
  ReasonCodeList,
  UserRole,
  VehicleStatus,
  VehicleTechnology,
  type FailureCatalogItem,
  type PublicUser,
  type ReasonCode,
  type Vehicle,
} from '@app/shared';

/**
 * Estado em memória do modo mock, espelhando o seed do banco.
 *
 * Existe para destravar o desenvolvimento do front sem depender de Postgres.
 * Não é uma segunda fonte de verdade do domínio: as regras de negócio
 * continuam em @app/shared e em apps/api — aqui só há armazenamento.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export interface MockUser extends PublicUser {
  password: string;
}

const baseUser = {
  registration: null,
  garageId: null,
  phone: null,
  avatarUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
};

export const users: MockUser[] = [
  { ...baseUser, id: uuid(1), name: 'Administrador', email: 'admin@transppass.local', role: UserRole.ADMIN, password: 'admin123' },
  { ...baseUser, id: uuid(2), name: 'Analista PCM', email: 'pcm@transppass.local', role: UserRole.PCM, password: 'transppass123' },
  { ...baseUser, id: uuid(3), name: 'CCO', email: 'cco@transppass.local', role: UserRole.CCO, password: 'transppass123' },
  { ...baseUser, id: uuid(4), name: 'Plantão', email: 'plantao@transppass.local', role: UserRole.PLANTAO, password: 'transppass123' },
  { ...baseUser, id: uuid(5), name: 'Encarregado de Manutenção', email: 'manutencao@transppass.local', role: UserRole.MANUTENCAO, password: 'transppass123' },
  { ...baseUser, id: uuid(6), name: 'Estoque', email: 'estoque@transppass.local', role: UserRole.ESTOQUE, password: 'transppass123' },
];

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/**
 * Cinco carros como no seed, mas com histórico já povoado para o painel ter o
 * que mostrar. O carro 10003 está sem leitura há 5 dias de propósito: é o caso
 * de projeção degradada do RF-14, que a tela precisa saber destacar.
 */
export const vehicles: Vehicle[] = [
  { id: uuid(101), code: '10001', plate: 'ABC1D23', technology: VehicleTechnology.DIESEL, kmSource: KmSource.MANUAL, odometerOffset: 0, manufacturer: 'Scania', model: 'K270', modelYear: 2021, garageId: null, status: VehicleStatus.IN_LINE, currentKm: 184_320, lastReadingAt: daysAgo(1), isActive: true },
  { id: uuid(102), code: '10002', plate: 'ABC1D24', technology: VehicleTechnology.DIESEL, kmSource: KmSource.MANUAL, odometerOffset: 12_500, manufacturer: 'Scania', model: 'K270', modelYear: 2020, garageId: null, status: VehicleStatus.IN_MAINTENANCE, currentKm: 241_870, lastReadingAt: daysAgo(1), isActive: true },
  { id: uuid(103), code: '10003', plate: 'ABC1D25', technology: VehicleTechnology.DIESEL, kmSource: KmSource.MANUAL, odometerOffset: 0, manufacturer: 'Mercedes-Benz', model: 'O500U', modelYear: 2019, garageId: null, status: VehicleStatus.AWAITING_PART, currentKm: 312_045, lastReadingAt: daysAgo(5), isActive: true },
  { id: uuid(104), code: '20001', plate: 'EBS1A01', technology: VehicleTechnology.EBUS, kmSource: KmSource.TELEMETRY, odometerOffset: 0, manufacturer: 'VW', model: 'e-Delivery', modelYear: 2025, garageId: null, status: VehicleStatus.AVAILABLE, currentKm: 42_180, lastReadingAt: daysAgo(0), isActive: true },
  { id: uuid(105), code: '20002', plate: 'EBS1A02', technology: VehicleTechnology.EBUS, kmSource: KmSource.TELEMETRY, odometerOffset: 0, manufacturer: 'VW', model: 'e-Delivery', modelYear: 2025, garageId: null, status: VehicleStatus.IN_CLEANING, currentKm: 38_902, lastReadingAt: daysAgo(0), isActive: true },
];

/** Média diária por carro, base da projeção mostrada no painel. */
export const avgDailyKm: Record<string, number> = {
  [uuid(101)]: 218.4,
  [uuid(102)]: 195.2,
  [uuid(103)]: 231.7,
  [uuid(104)]: 176.5,
  [uuid(105)]: 168.9,
};

export const catalogVersionId = uuid(200);

export const catalogItems: FailureCatalogItem[] = [
  { id: uuid(201), versionId: catalogVersionId, code: 'ELE-ALT-01', description: 'Alternador não carrega', system: 'Elétrica', subsystem: 'Carga', isFastTrack: true, isSafety: false, isDeferrable: false, probableCause: 'Alternador ou regulador de tensão', estimatedRepairMinutes: 180, fieldResolutionRate: 0.62, fieldResolutionSamples: 47, isActive: true },
  { id: uuid(202), versionId: catalogVersionId, code: 'PNE-APU-01', description: 'Válvula APU com vazamento', system: 'Pneumático', subsystem: 'Ar', isFastTrack: true, isSafety: true, isDeferrable: false, probableCause: 'Válvula APU', estimatedRepairMinutes: 120, fieldResolutionRate: 0.18, fieldResolutionSamples: 33, isActive: true },
  { id: uuid(203), versionId: catalogVersionId, code: 'PNE-CUI-01', description: 'Cuíca de freio inoperante', system: 'Pneumático', subsystem: 'Freio', isFastTrack: true, isSafety: true, isDeferrable: false, probableCause: 'Cuíca de freio', estimatedRepairMinutes: 150, fieldResolutionRate: 0.09, fieldResolutionSamples: 22, isActive: true },
  { id: uuid(204), versionId: catalogVersionId, code: 'MEC-MOT-01', description: 'Superaquecimento do motor', system: 'Motor', subsystem: 'Arrefecimento', isFastTrack: false, isSafety: true, isDeferrable: false, probableCause: 'Radiador, bomba d’água ou correia', estimatedRepairMinutes: 240, fieldResolutionRate: 0.31, fieldResolutionSamples: 16, isActive: true },
  { id: uuid(205), versionId: catalogVersionId, code: 'AC-CLI-01', description: 'Ar-condicionado sem refrigeração', system: 'Conforto', subsystem: 'Climatização', isFastTrack: false, isSafety: false, isDeferrable: true, probableCause: 'Carga de gás ou compressor', estimatedRepairMinutes: 120, fieldResolutionRate: 0.44, fieldResolutionSamples: 28, isActive: true },
  { id: uuid(206), versionId: catalogVersionId, code: 'CAR-POR-01', description: 'Porta não fecha completamente', system: 'Carroceria', subsystem: 'Portas', isFastTrack: false, isSafety: true, isDeferrable: false, probableCause: 'Cilindro ou sensor de porta', estimatedRepairMinutes: 90, fieldResolutionRate: 0.57, fieldResolutionSamples: 39, isActive: true },
];

const rc = (n: number, list: ReasonCodeList, code: string, description: string): ReasonCode => ({
  id: uuid(n),
  list,
  code,
  description,
  isActive: true,
});

export const reasonCodes: ReasonCode[] = [
  rc(301, ReasonCodeList.QUEUE_PRIORITY, 'SEG', 'Risco de segurança'),
  rc(302, ReasonCodeList.QUEUE_PRIORITY, 'CONTR', 'Exigência contratual'),
  rc(303, ReasonCodeList.QUEUE_PRIORITY, 'DISP', 'Disponibilidade da linha'),
  rc(304, ReasonCodeList.SCHEDULE_RESCHEDULE, 'MAT', 'Falta de material'),
  rc(305, ReasonCodeList.SCHEDULE_RESCHEDULE, 'EQP', 'Equipe indisponível'),
  rc(306, ReasonCodeList.SCHEDULE_RESCHEDULE, 'OPER', 'Necessidade da operação'),
  rc(307, ReasonCodeList.INSPECTION_REJECTION, 'FOLGA', 'Folga fora de especificação'),
  rc(308, ReasonCodeList.INSPECTION_REJECTION, 'VAZ', 'Vazamento constatado'),
  rc(309, ReasonCodeList.INSPECTION_REJECTION, 'ACAB', 'Acabamento reprovado'),
  rc(310, ReasonCodeList.PART_WAITING, 'SEMEST', 'Sem saldo em estoque'),
  rc(311, ReasonCodeList.PART_WAITING, 'COMPRA', 'Aguardando compra'),
  rc(312, ReasonCodeList.PART_WAITING, 'OFIC', 'Em recuperação na Oficina'),
  rc(313, ReasonCodeList.EVENT_DEFERRAL, 'BAIXO', 'Baixo impacto na operação'),
  rc(314, ReasonCodeList.EVENT_DEFERRAL, 'JANELA', 'Cabe na próxima janela preventiva'),
];

let idCounter = 900;
export const newId = () => uuid(++idCounter);
