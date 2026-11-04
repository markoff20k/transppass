import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carga de contas a partir da "Listagem Funcionários Sistema" que a Transppass
 * entregou (RE, nome, departamento, e-mail), convertida para
 * prisma/data/usuarios.json — arquivo com dados do cliente, fora do repositório.
 *
 *   npm run db:seed:users                      # lê prisma/data/usuarios.json
 *   npm run db:seed:users -- caminho/lista.json
 *   USERS_ROLE=ADMIN npm run db:seed:users     # todos com o mesmo perfil
 *
 * Toda conta entra com a senha padrão e `mustChangePassword`: a pessoa define
 * a própria senha no primeiro acesso (PasswordChangeGuard + /primeiro-acesso).
 *
 * Idempotente: quem já existe (pelo e-mail) não é alterado — nome, perfil e
 * senha ficam como estão. A única exceção é a senha provisória: conta da lista
 * que ainda não fez login nenhum passa a exigir a troca no primeiro acesso.
 */

const DEFAULT_PASSWORD = 'transppass123';
const DEFAULT_GARAGE = process.env.USERS_GARAGE ?? '009';
/** Perfil único para toda a lista (ex.: USERS_ROLE=ADMIN); sem ele, vale o `role` da linha ou o departamento. */
const FORCED_ROLE = process.env.USERS_ROLE ? UserRole[process.env.USERS_ROLE as keyof typeof UserRole] : undefined;

/** Departamento da listagem → perfil de acesso (RF-36). */
const DEPARTMENT_ROLES: Record<string, UserRole> = {
  'manutencao': UserRole.MANUTENCAO,
  'pcm': UserRole.PCM,
  'cco': UserRole.CCO,
  'operacao': UserRole.GESTAO,
  'sgi': UserRole.GESTAO,
  'ti': UserRole.ADMIN,
  'almoxarifado': UserRole.ESTOQUE,
  'estoque': UserRole.ESTOQUE,
  'plantao': UserRole.PLANTAO,
  'socorro': UserRole.SOCORRO,
  'limpeza': UserRole.LIMPEZA,
  'gestao': UserRole.GESTAO,
  'diretoria': UserRole.GESTAO,
  'inspecao': UserRole.INSPETOR,
  'administrador': UserRole.ADMIN,
};

interface UserRow {
  registration?: string | null;
  name: string;
  department?: string | null;
  email: string;
  /** Opcional: vence o mapeamento por departamento. */
  role?: UserRole;
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function roleFor(row: UserRow): UserRole | null {
  if (FORCED_ROLE) return FORCED_ROLE;
  if (row.role) return row.role;
  return DEPARTMENT_ROLES[normalize(row.department ?? '')] ?? null;
}

function cleanRegistration(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return v && v !== '-' ? v : null;
}

async function main() {
  const file = resolve(process.argv[2] ?? resolve(__dirname, 'data', 'usuarios.json'));
  if (!existsSync(file)) {
    console.error(`Lista não encontrada: ${file}`);
    process.exit(1);
  }
  const rows = JSON.parse(readFileSync(file, 'utf8')) as UserRow[];
  if (process.env.USERS_ROLE && !FORCED_ROLE) throw new Error(`Perfil inválido em USERS_ROLE: ${process.env.USERS_ROLE}`);
  const prisma = new PrismaClient();
  const garage = await prisma.garage.findUnique({ where: { code: DEFAULT_GARAGE } });
  if (!garage) throw new Error(`Garagem ${DEFAULT_GARAGE} não existe (USERS_GARAGE)`);

  const passwordHash = await argon2.hash(DEFAULT_PASSWORD, { type: argon2.argon2id });
  const report = { created: [] as string[], kept: [] as string[], flagged: [] as string[], skipped: [] as string[] };

  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    const name = row.name.trim().replace(/\s+/g, ' ');
    const role = roleFor(row);
    if (!email.includes('@') || name.length < 2 || !role) {
      report.skipped.push(`${email || '(sem e-mail)'} — ${!role ? `departamento sem perfil: "${row.department}"` : 'dados incompletos'}`);
      continue;
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, mustChangePassword: true } });
    if (existing) {
      const everLoggedIn = await prisma.auditLog.findFirst({ where: { actorId: existing.id, action: 'auth.login' }, select: { id: true } });
      if (!existing.mustChangePassword && !everLoggedIn) {
        await prisma.user.update({ where: { id: existing.id }, data: { mustChangePassword: true } });
        report.flagged.push(email);
      } else {
        report.kept.push(email);
      }
      continue;
    }

    let registration = cleanRegistration(row.registration);
    if (registration && (await prisma.user.findUnique({ where: { registration }, select: { id: true } }))) {
      console.warn(`  matrícula ${registration} já pertence a outra conta; ${email} entra sem matrícula`);
      registration = null;
    }

    await prisma.user.create({
      data: { name, email, registration, role, garageId: garage.id, passwordHash, mustChangePassword: true },
    });
    report.created.push(`${email} (${role})`);
  }

  await prisma.$disconnect();

  const list = (title: string, items: string[]) => {
    console.log(`\n${title}: ${items.length}`);
    for (const i of items) console.log(`  - ${i}`);
  };
  list('Contas criadas (senha padrão, troca obrigatória no primeiro acesso)', report.created);
  list('Já existiam e ficaram como estão', report.kept);
  list('Já existiam sem nenhum login: passam a exigir a troca de senha', report.flagged);
  list('Ignoradas', report.skipped);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
