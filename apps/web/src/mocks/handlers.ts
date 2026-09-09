import { http, HttpResponse } from 'msw';
import {
  AVAILABLE_STATUSES,
  classifyOdometerDelta,
  KM_DEGRADATION_DAYS,
  KmSource,
  OdometerStatus,
  VehicleStatus,
  createVehicleSchema,
  loginSchema,
  odometerBatchSchema,
  type ApiErrorBody,
  type FleetPanelRow,
  type FleetPanelSummary,
  type OdometerBatchResultItem,
  type ReasonCodeList,
  type Vehicle,
} from '@app/shared';
import { avgDailyKm, catalogItems, newId, reasonCodes, users, vehicles } from './fixtures';
import { dashboardHandlers } from './dashboard.mock';
import { r1Handlers } from './r1.mock';

/**
 * Handlers do modo mock.
 *
 * Reimplementam apenas o transporte: a validação de entrada usa os mesmos
 * schemas Zod de @app/shared que a API usa, e a classificação de delta de km
 * chama a mesma `classifyOdometerDelta`. O que se exercita aqui é o front e o
 * contrato compartilhado — a lógica de persistência da API não é coberta.
 */

const DAY_MS = 86_400_000;

/** Token opaco de brincadeira: no mock não há assinatura para verificar. */
const tokenFor = (userId: string) => `mock.${userId}`;
const userIdFromToken = (token: string | null) =>
  token?.startsWith('Bearer mock.') ? token.slice('Bearer mock.'.length) : null;

function apiError(status: number, code: string, message: string, path: string, fields?: Record<string, string[]>) {
  const body: ApiErrorBody = {
    statusCode: status,
    code,
    message,
    ...(fields ? { fields } : {}),
    timestamp: new Date().toISOString(),
    path,
  };
  return HttpResponse.json(body, { status });
}

function requireAuth(request: Request, path: string) {
  const userId = userIdFromToken(request.headers.get('Authorization'));
  const user = users.find((u) => u.id === userId);
  if (!user) return { error: apiError(401, 'UNAUTHORIZED', 'Sessão inválida', path) } as const;
  return { user } as const;
}

/** Latência artificial para o front exercitar os estados de carregamento. */
const delay = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));

export const handlers = [
  ...dashboardHandlers,
  ...r1Handlers,
  // --- Autenticação --------------------------------------------------------

  http.post('*/api/auth/login', async ({ request }) => {
    await delay();
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError(422, 'VALIDATION_ERROR', 'Dados inválidos', '/api/auth/login', parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const user = users.find((u) => u.email === parsed.data.email);
    if (!user || user.password !== parsed.data.password) {
      return apiError(401, 'UNAUTHORIZED', 'E-mail ou senha inválidos', '/api/auth/login');
    }

    const { password: _password, ...publicUser } = user;
    return HttpResponse.json({
      user: publicUser,
      tokens: { accessToken: tokenFor(user.id), refreshToken: `refresh.${user.id}`, expiresIn: 900 },
    });
  }),

  http.get('*/api/auth/me', async ({ request }) => {
    await delay();
    const auth = requireAuth(request, '/api/auth/me');
    if ('error' in auth) return auth.error;
    const { password: _password, ...publicUser } = auth.user;
    return HttpResponse.json(publicUser);
  }),

  http.post('*/api/auth/refresh', async () => {
    // No mock o access token nunca expira, então o refresh não deveria ocorrer.
    return apiError(401, 'UNAUTHORIZED', 'Refresh não disponível no modo mock', '/api/auth/refresh');
  }),

  http.post('*/api/auth/logout', () => new HttpResponse(null, { status: 204 })),

  // --- Frota ---------------------------------------------------------------

  http.get('*/api/vehicles/panel', async ({ request }) => {
    await delay();
    const auth = requireAuth(request, '/api/vehicles/panel');
    if ('error' in auth) return auth.error;

    const rows = filterVehicles(new URL(request.url)).map(toPanelRow);

    const byStatus = Object.fromEntries(Object.values(VehicleStatus).map((s) => [s, 0])) as Record<VehicleStatus, number>;
    for (const row of rows) byStatus[row.status] += 1;

    const available = rows.filter((r) => AVAILABLE_STATUSES.includes(r.status)).length;
    const summary: FleetPanelSummary = {
      total: rows.length,
      available,
      availabilityRate: rows.length ? available / rows.length : 0,
      byStatus,
      degradedKmCount: rows.filter((r) => r.isKmDegraded).length,
    };

    return HttpResponse.json({ summary, rows });
  }),

  http.get('*/api/vehicles', async ({ request }) => {
    await delay();
    const auth = requireAuth(request, '/api/vehicles');
    if ('error' in auth) return auth.error;

    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const perPage = Number(url.searchParams.get('perPage') ?? 20);
    const all = filterVehicles(url);

    return HttpResponse.json({
      data: all.slice((page - 1) * perPage, page * perPage),
      meta: { page, perPage, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / perPage)) },
    });
  }),

  http.post('*/api/vehicles', async ({ request }) => {
    await delay();
    const auth = requireAuth(request, '/api/vehicles');
    if ('error' in auth) return auth.error;

    const parsed = createVehicleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError(422, 'VALIDATION_ERROR', 'Dados inválidos', '/api/vehicles', parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const clash = vehicles.find((v) => v.code === parsed.data.code || v.plate === parsed.data.plate);
    if (clash) {
      const conflictOnCode = clash.code === parsed.data.code;
      return apiError(409, 'CONFLICT', conflictOnCode ? `Já existe carro com o prefixo ${parsed.data.code}` : `Já existe carro com a placa ${parsed.data.plate}`, '/api/vehicles');
    }

    const vehicle: Vehicle = {
      id: newId(),
      code: parsed.data.code,
      plate: parsed.data.plate,
      technology: parsed.data.technology,
      kmSource: parsed.data.kmSource,
      odometerOffset: parsed.data.odometerOffset,
      manufacturer: parsed.data.manufacturer ?? null,
      model: parsed.data.model ?? null,
      modelYear: parsed.data.modelYear ?? null,
      garageId: parsed.data.garageId ?? null,
      status: VehicleStatus.AVAILABLE,
      currentKm: 0,
      lastReadingAt: null,
      isActive: true,
    };
    vehicles.push(vehicle);
    return HttpResponse.json(vehicle, { status: 201 });
  }),

  // --- Quilometragem -------------------------------------------------------

  http.post('*/api/odometer/batch', async ({ request }) => {
    await delay();
    const auth = requireAuth(request, '/api/odometer/batch');
    if ('error' in auth) return auth.error;

    const parsed = odometerBatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError(422, 'VALIDATION_ERROR', 'Dados inválidos', '/api/odometer/batch', parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const items: OdometerBatchResultItem[] = parsed.data.entries.map((entry) => {
      const vehicle = vehicles.find((v) => v.id === entry.vehicleId);
      if (!vehicle) {
        return { vehicleId: entry.vehicleId, vehicleCode: '—', accepted: false, status: OdometerStatus.REJECTED, deltaKm: null, message: 'Carro não encontrado' };
      }

      const adjustedKm = entry.rawKm + vehicle.odometerOffset;
      const deltaKm = vehicle.currentKm > 0 ? adjustedKm - vehicle.currentKm : null;
      const { status, message } = classifyOdometerDelta(deltaKm);

      if (status !== OdometerStatus.REJECTED && adjustedKm > vehicle.currentKm) {
        vehicle.currentKm = adjustedKm;
        vehicle.lastReadingAt = new Date(entry.readAt).toISOString();
      }

      return {
        vehicleId: vehicle.id,
        vehicleCode: vehicle.code,
        accepted: status !== OdometerStatus.REJECTED,
        status,
        deltaKm,
        message,
      };
    });

    return HttpResponse.json({
      accepted: items.filter((i) => i.accepted).length,
      suspect: items.filter((i) => i.status === OdometerStatus.SUSPECT).length,
      rejected: items.filter((i) => i.status === OdometerStatus.REJECTED).length,
      items,
    });
  }),

  // --- Catálogo ------------------------------------------------------------

  http.get('*/api/catalog/items', async ({ request }) => {
    await delay();
    const auth = requireAuth(request, '/api/catalog/items');
    if ('error' in auth) return auth.error;

    const search = new URL(request.url).searchParams.get('search')?.toLowerCase();
    const data = search
      ? catalogItems.filter((i) => i.code.toLowerCase().includes(search) || i.description.toLowerCase().includes(search))
      : catalogItems;

    return HttpResponse.json({
      data,
      meta: { page: 1, perPage: 100, total: data.length, totalPages: 1 },
    });
  }),

  http.get('*/api/catalog/reason-codes', async ({ request }) => {
    await delay();
    const auth = requireAuth(request, '/api/catalog/reason-codes');
    if ('error' in auth) return auth.error;

    const list = new URL(request.url).searchParams.get('list') as ReasonCodeList | null;
    return HttpResponse.json(list ? reasonCodes.filter((r) => r.list === list) : reasonCodes);
  }),
];

function filterVehicles(url: URL): Vehicle[] {
  const search = url.searchParams.get('search')?.toLowerCase();
  const technology = url.searchParams.get('technology');
  const status = url.searchParams.get('status');
  const onlyActive = url.searchParams.get('onlyActive') !== 'false';

  return vehicles
    .filter((v) => (onlyActive ? v.isActive : true))
    .filter((v) => (technology ? v.technology === technology : true))
    .filter((v) => (status ? v.status === status : true))
    .filter((v) => (search ? v.code.toLowerCase().includes(search) || v.plate.toLowerCase().includes(search) : true))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function toPanelRow(vehicle: Vehicle): FleetPanelRow {
  const avg = avgDailyKm[vehicle.id] ?? null;
  const lastReadingAt = vehicle.lastReadingAt ? new Date(vehicle.lastReadingAt) : null;
  const daysSince = lastReadingAt ? (Date.now() - lastReadingAt.getTime()) / DAY_MS : null;

  return {
    ...vehicle,
    projectedKm: avg !== null && daysSince !== null ? Math.round(vehicle.currentKm + avg * Math.max(0, daysSince)) : null,
    avgDailyKm: avg,
    isKmDegraded: daysSince !== null && daysSince > KM_DEGRADATION_DAYS,
    daysSinceLastReading: daysSince !== null ? Math.floor(daysSince) : null,
  };
}

/** Só carros de lançamento manual entram na tela de km (RF-15). */
export const manualKmVehicles = () => vehicles.filter((v) => v.kmSource === KmSource.MANUAL);
