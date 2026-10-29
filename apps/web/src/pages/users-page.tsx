import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Pencil, Plus } from 'lucide-react';
import {
  createUserSchema,
  USER_ROLE_LABELS,
  UserRole,
  type CreateUserInput,
  type Paginated,
  type PasswordResetLink,
  type PublicUser,
  type UpdateUserInput,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/features/auth/use-auth';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { BrandLoader } from '@/components/brand/brand-loader';
import { Pager } from '@/components/ui/pager';
import { usePager } from '@/lib/pager';

type Mode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; user: PublicUser };

/**
 * RF-36 — contas e perfis por área.
 *
 * Não há auto-cadastro: o administrador cria a conta e escolhe o perfil, que
 * carrega a autoridade da pessoa no processo. Contas são desativadas, nunca
 * apagadas — o histórico precisa continuar legível. Toda mudança de perfil
 * vira registro de auditoria no servidor.
 */
export function UsersPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [showInactive, setShowInactive] = useState(false);

  usePageHeader({
    eyebrow: 'Cadastros',
    title: 'Usuários',
    description: 'Contas individuais e o perfil de acesso de cada área (RF-36).',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setMode({ kind: 'create' })}>
        <Plus size={14} /> Novo usuário
      </button>
    ),
  });

  const { data, isPending } = useQuery({
    queryKey: ['users', showInactive],
    queryFn: () => api.get<Paginated<PublicUser>>(`/users?perPage=100&onlyActive=${showInactive ? 'false' : 'true'}`),
  });

  const rows = data?.data ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['users'] });
  const activeRows = rows.filter((u) => u.isActive);
  const roles = new Set(activeRows.map((u) => u.role)).size;
  const admins = activeRows.filter((u) => u.role === 'ADMIN').length;
  const operational = activeRows.filter((u) => u.role !== 'ADMIN' && u.role !== 'GESTAO').length;

  const pager = usePager('usuarios', rows.length, String(showInactive));
  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Contas ativas</span>
          <strong className="tp-kpi__value">{activeRows.length}</strong>
          <span className="tp-kpi__note">{showInactive ? `${rows.length - activeRows.length} desativada(s) na lista` : 'desativadas ficam fora da lista'}</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Perfis em uso</span>
          <strong className="tp-kpi__value">{roles}<small className="tp-kpi__of"> / {Object.keys(USER_ROLE_LABELS).length}</small></strong>
          <span className="tp-kpi__note">cada área enxerga só a sua tela</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Operação e oficina</span>
          <strong className="tp-kpi__value">{operational}</strong>
          <span className="tp-kpi__note">CCO, plantão, socorro, mecânicos, estoque…</span>
        </div>
        <div className={`tp-kpi ${admins > 2 ? 'tp-kpi--warn' : ''}`}>
          <span className="tp-kpi__label">Administradores</span>
          <strong className="tp-kpi__value">{admins}</strong>
          <span className="tp-kpi__note">quanto menos, melhor — tudo passa por eles</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>Contas</h3>
            <span className="chart__hint">clique na linha para editar nome, matrícula, perfil ou gerar link de nova senha</span>
          </div>
          <label className="tp-check tp-check--inline">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            mostrar desativadas
          </label>
        </div>
        {isPending ? (
          <BrandLoader size={44} label="Carregando" />
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Matrícula</th>
                  <th>Perfil</th>
                  <th>Situação</th>
                  <th>Desde</th>
                  <th className="is-action" aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {pager.slice(rows).map((u) => (
                  <tr
                    key={u.id}
                    className={`is-clickable${u.isActive ? '' : ' is-inactive'}`}
                    tabIndex={0}
                    onClick={() => setMode({ kind: 'edit', user: u })}
                    onKeyDown={(e) => e.key === 'Enter' && setMode({ kind: 'edit', user: u })}
                  >
                    <td className="is-strong">{u.name}</td>
                    <td className="tp-muted">{u.email}</td>
                    <td className="tp-muted">{u.registration ?? '—'}</td>
                    <td>
                      <span className="tp-badge tp-badge--status">{USER_ROLE_LABELS[u.role]}</span>
                    </td>
                    <td>
                      <span className={`tp-badge tp-badge--status ${u.isActive ? 'tp-badge--success' : ''}`}>{u.isActive ? 'Ativa' : 'Desativada'}</span>
                    </td>
                    <td className="tp-muted">{formatDate(u.createdAt)}</td>
                    <td className="is-action">
                      <span className="tp-row-action"><Pencil size={13} /> Editar</span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="tp-table__empty">Nenhuma conta.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pager pager={pager} label="usuários" />
          </div>
        )}
      </section>

      <UserDrawer mode={mode} onClose={() => setMode({ kind: 'closed' })} onDone={() => { setMode({ kind: 'closed' }); invalidate(); }} />
    </>
  );
}

// ---------------------------------------------------------------------------

const ROLE_HINTS: Record<UserRole, string> = {
  ADMIN: 'Tudo, inclusive contas e cadastros.',
  PCM: 'Triagem, fila, preventiva, catálogo e indicadores.',
  CCO: 'Registra eventos e abre demandas do plantão.',
  PLANTAO: 'Reservas e janelas de reposição.',
  SOCORRO: 'Apontamento do socorro em campo.',
  MANUTENCAO: 'Encarregado: OS, equipes, liberação do carro.',
  MECANICO: 'Executa sub-OS e pede material.',
  INSPETOR: 'Inspeciona sub-OS concluídas.',
  ESTOQUE: 'Fila de materiais, pool, kits e ferramentas.',
  LIMPEZA: 'Checklist de limpeza e avarias.',
  GESTAO: 'Só leitura de indicadores.',
};

function UserDrawer({ mode, onClose, onDone }: { mode: Mode; onClose: () => void; onDone: () => void }) {
  const { user: me } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const editing = mode.kind === 'edit' ? mode.user : null;

  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { role: UserRole.MECANICO },
  });

  useEffect(() => {
    setError(null);
    if (mode.kind === 'create') form.reset({ name: '', email: '', password: '', role: UserRole.MECANICO, registration: '' });
    if (mode.kind === 'edit') form.reset({ name: mode.user.name, email: mode.user.email, password: '', role: mode.user.role, registration: mode.user.registration ?? '' });
  }, [mode, form]);

  const create = useMutation({
    meta: { success: 'Usuário criado' },
    mutationFn: (input: CreateUserInput) => api.post<PublicUser>('/users', input),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta'),
  });
  const update = useMutation({
    meta: { success: 'Usuário atualizado' },
    mutationFn: (input: UpdateUserInput) => api.patch<PublicUser>(`/users/${editing?.id}`, input),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar'),
  });

  const submit = form.handleSubmit((values) => {
    setError(null);
    if (editing) {
      update.mutate({
        name: values.name,
        role: values.role,
        registration: values.registration || undefined,
        ...(values.password ? { password: values.password } : {}),
      });
    } else {
      create.mutate({ ...values, registration: values.registration || undefined });
    }
  });

  // Na edição a senha é opcional: só troca se for preenchida.
  const passwordRules = editing ? { setValueAs: (v: string) => v || undefined } : {};
  const isSelf = editing?.id === me?.id;
  const [resetLink, setResetLink] = useState<PasswordResetLink | null>(null);
  const [copied, setCopied] = useState(false);
  const resetMutation = useMutation({
    mutationFn: () => api.post<PasswordResetLink>(`/users/${editing?.id}/reset-link`),
    onSuccess: (link) => { setResetLink(link); setCopied(false); setError(null); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível gerar o link'),
  });
  useEffect(() => { setResetLink(null); setCopied(false); }, [mode]);
  const pending = create.isPending || update.isPending;

  return (
    <Drawer
      open={mode.kind !== 'closed'}
      onClose={onClose}
      eyebrow={editing ? `Conta · ${USER_ROLE_LABELS[editing.role]}` : 'Nova conta'}
      title={editing ? editing.name : 'Novo usuário'}
      description={editing ? editing.email : 'A pessoa recebe e-mail e senha de você; pode trocar a senha depois em Meu perfil.'}
      footer={
        <>
          {editing && !isSelf && (
            <button
              type="button"
              className={`tp-btn ${editing.isActive ? 'tp-btn--danger' : 'tp-btn--secondary'}`}
              disabled={pending}
              onClick={() => update.mutate({ isActive: !editing.isActive })}
            >
              {editing.isActive ? 'Desativar conta' : 'Reativar conta'}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="tp-btn tp-btn--primary" disabled={pending} onClick={() => void submit()}>
            {pending ? 'Salvando…' : editing ? 'Salvar' : 'Criar conta'}
          </button>
        </>
      }
    >
      <form className="tp-stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <label className="tp-field">
          <span className="tp-label">Nome</span>
          <input className="tp-input" autoComplete="off" {...form.register('name')} />
          {form.formState.errors.name && <span className="tp-error">{form.formState.errors.name.message}</span>}
        </label>

        <label className="tp-field">
          <span className="tp-label">E-mail</span>
          <input className="tp-input" type="email" autoComplete="off" disabled={Boolean(editing)} {...form.register('email')} />
          {form.formState.errors.email && <span className="tp-error">{form.formState.errors.email.message}</span>}
          {editing && <span className="tp-help">O e-mail identifica a conta e não muda.</span>}
        </label>

        <div className="tp-grid-2">
          <label className="tp-field">
            <span className="tp-label">Matrícula</span>
            <input className="tp-input" autoComplete="off" {...form.register('registration')} />
          </label>
          <label className="tp-field">
            <span className="tp-label">{editing ? 'Nova senha (opcional)' : 'Senha inicial'}</span>
            <input className="tp-input" type="password" autoComplete="new-password" {...form.register('password', passwordRules)} />
            {form.formState.errors.password && !editing && <span className="tp-error">{form.formState.errors.password.message}</span>}
          </label>
        </div>

        <label className="tp-field">
          <span className="tp-label">Perfil de acesso</span>
          <select className="tp-select" disabled={isSelf} {...form.register('role')}>
            {Object.values(UserRole).map((r) => (
              <option key={r} value={r}>
                {USER_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <span className="tp-help">{ROLE_HINTS[form.watch('role')]}{isSelf ? ' Você não altera o próprio perfil.' : ''}</span>
        </label>

        {editing && (
          <div className="reset-link">
            <div className="reset-link__head">
              <span className="tp-label"><KeyRound size={14} /> Esqueceu a senha?</span>
              <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" disabled={resetMutation.isPending} onClick={() => resetMutation.mutate()}>
                {resetMutation.isPending ? 'Gerando…' : 'Gerar link de redefinição'}
              </button>
            </div>
            {resetLink ? (
              <>
                <div className="reset-link__url">
                  <code>{resetLink.url}</code>
                  <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => { void navigator.clipboard?.writeText(resetLink.url); setCopied(true); }}>
                    <Copy size={14} /> {copied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <span className="tp-help">
                  {resetLink.emailed ? 'Enviado por e-mail para a pessoa. ' : 'O servidor não tem e-mail configurado — passe o link à pessoa por outro canal. '}
                  Vale por 1 hora e uma única vez.
                </span>
              </>
            ) : (
              <span className="tp-help">Gera um link de uso único para a pessoa definir uma nova senha sem você saber qual é.</span>
            )}
          </div>
        )}

        {error && <p className="tp-error">{error}</p>}
      </form>
    </Drawer>
  );
}
