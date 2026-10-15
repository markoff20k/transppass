import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  createUserSchema,
  USER_ROLE_LABELS,
  UserRole,
  type CreateUserInput,
  type Paginated,
  type PublicUser,
  type UpdateUserInput,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/features/auth/use-auth';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

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

  return (
    <>
      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Contas</h3>
          <label className="tp-check" style={{ fontSize: 'var(--tp-text-sm)' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            mostrar desativadas
          </label>
        </div>
        {isPending ? (
          <p className="tp-muted">Carregando…</p>
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
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
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
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="tp-table__empty">Nenhuma conta.</td>
                  </tr>
                )}
              </tbody>
            </table>
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
    mutationFn: (input: CreateUserInput) => api.post<PublicUser>('/users', input),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta'),
  });
  const update = useMutation({
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

        {error && <p className="tp-error">{error}</p>}
      </form>
    </Drawer>
  );
}
