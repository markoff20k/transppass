import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { forgotPasswordSchema, resetPasswordSchema } from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { TransppassLogo } from '@/components/brand/transppass-logo';

/**
 * Recuperação de senha, fora do shell e com o mesmo chão da tela de login.
 *
 * "Esqueci" nunca diz se o e-mail existe. Sem SMTP no servidor, o caminho é
 * o administrador gerar o link em Cadastros › Usuários — a tela avisa isso.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'E-mail inválido');
    setError(null);
    setPending(true);
    try {
      await api.post('/auth/forgot-password', parsed.data, { skipAuth: true });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar');
    } finally {
      setPending(false);
    }
  }

  return (
    <PasswordShell>
      {sent ? (
        <div className="tp-stack">
          <CheckCircle2 size={28} className="password__ok" />
          <h1 className="login__title">Verifique seu e-mail</h1>
          <p className="tp-muted">
            Se <b>{email}</b> tiver uma conta ativa, o link para definir uma nova senha chega em instantes e vale por 1 hora.
          </p>
          <p className="tp-muted">Não chegou? O administrador do sistema pode gerar o link para você em <i>Cadastros › Usuários</i>.</p>
          <Link to="/login" className="tp-btn tp-btn--secondary"><ArrowLeft size={14} /> Voltar ao login</Link>
        </div>
      ) : (
        <form className="login__form" onSubmit={submit} noValidate>
          <div className="login__intro">
            <span className="subheader__eyebrow">Acesso</span>
            <h1 className="login__title">Esqueci minha senha</h1>
            <p className="tp-muted">Informe o e-mail da sua conta. Enviamos um link para definir uma nova senha.</p>
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="forgot-email">E-mail</label>
            <input id="forgot-email" className="tp-input tp-input--touch" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          {error && <div className="tp-alert tp-alert--danger">{error}</div>}
          <button type="submit" className="tp-btn tp-btn--primary tp-btn--touch login__submit" disabled={pending}>{pending ? 'Enviando…' : 'Enviar link'}</button>
          <Link to="/login" className="login__help"><ArrowLeft size={14} /> Voltar ao login</Link>
        </form>
      )}
    </PasswordShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('A confirmação não confere com a nova senha.');
    const parsed = resetPasswordSchema.safeParse({ token, newPassword: password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    setPending(true);
    try {
      await api.post('/auth/reset-password', parsed.data, { skipAuth: true });
      setDone(true);
      window.setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível redefinir a senha');
    } finally {
      setPending(false);
    }
  }

  return (
    <PasswordShell>
      {done ? (
        <div className="tp-stack">
          <CheckCircle2 size={28} className="password__ok" />
          <h1 className="login__title">Senha redefinida</h1>
          <p className="tp-muted">Entre com a nova senha. Suas outras sessões foram encerradas.</p>
          <Link to="/login" className="tp-btn tp-btn--primary">Ir para o login</Link>
        </div>
      ) : !token ? (
        <div className="tp-stack">
          <h1 className="login__title">Link inválido</h1>
          <p className="tp-muted">Este endereço não tem um código de redefinição. Peça um link novo.</p>
          <Link to="/esqueci-senha" className="tp-btn tp-btn--secondary">Pedir novo link</Link>
        </div>
      ) : (
        <form className="login__form" onSubmit={submit} noValidate>
          <div className="login__intro">
            <span className="subheader__eyebrow">Acesso</span>
            <h1 className="login__title">Definir nova senha</h1>
            <p className="tp-muted">No mínimo 8 caracteres.</p>
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="reset-password">Nova senha</label>
            <input id="reset-password" className="tp-input tp-input--touch" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="reset-confirm">Confirmar nova senha</label>
            <input id="reset-confirm" className="tp-input tp-input--touch" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <div className="tp-alert tp-alert--danger">{error}</div>}
          <button type="submit" className="tp-btn tp-btn--primary tp-btn--touch login__submit" disabled={pending || !password || !confirm}>{pending ? 'Salvando…' : 'Salvar nova senha'}</button>
        </form>
      )}
    </PasswordShell>
  );
}

function PasswordShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login login--single">
      <section className="login__form-col">
        <div className="login__brand"><TransppassLogo height={48} /></div>
        <div className="login__form">{children}</div>
        <p className="login__foot tp-muted">Transppass · Transporte de Passageiros · São Paulo</p>
      </section>
    </div>
  );
}
