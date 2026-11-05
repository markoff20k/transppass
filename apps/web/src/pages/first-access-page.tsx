import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import { changePasswordSchema } from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { useAuth } from '@/features/auth/use-auth';
import { TransppassMark } from '@/components/brand/transppass-logo';
import { LoginArt } from '@/components/brand/login-art';

/**
 * Primeiro acesso — o primeiro contato da pessoa com o sistema.
 *
 * A conta veio com a senha padrão (criada pelo administrador ou importada da
 * listagem de funcionários) e nada abre antes de a pessoa definir a sua. A
 * tela valida enquanto se digita: a força da senha nova, os três requisitos e
 * a confirmação aparecem ao vivo, e o botão só liga quando tudo confere — o
 * envio nunca é a primeira vez que a pessoa descobre que algo está errado.
 * Ao salvar, entra de novo com a senha nova por baixo dos panos e vai ao painel.
 */

const MIN_LENGTH = 8;

type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string };

/** Força estimada: tamanho, variedade e nada de reaproveitar o que já se sabe da pessoa. */
function strengthOf(password: string, taboo: string[]): Strength {
  if (!password) return { score: 0, label: '' };
  const lower = password.toLowerCase();
  if (taboo.some((t) => t && lower.includes(t))) return { score: 1, label: 'Fraca: parece com dados da sua conta' };
  let score = 0;
  if (password.length >= MIN_LENGTH) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const clamped = Math.min(4, Math.max(1, score)) as 1 | 2 | 3 | 4;
  const labels: Record<1 | 2 | 3 | 4, string> = { 1: 'Fraca', 2: 'Razoável', 3: 'Boa', 4: 'Forte' };
  return { score: clamped, label: labels[clamped] };
}

export function FirstAccessPage() {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'edit' | 'saving' | 'done'>('edit');
  const currentRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  const firstName = user?.name.split(' ')[0] ?? '';
  const taboo = useMemo(() => {
    const local = user?.email.split('@')[0]?.toLowerCase() ?? '';
    const parts = (user?.name ?? '').toLowerCase().split(/\s+/).filter((p) => p.length >= 4);
    return [local, ...parts].filter((t) => t.length >= 4);
  }, [user]);

  const strength = strengthOf(next, taboo);
  const longEnough = next.length >= MIN_LENGTH;
  const differs = next.length > 0 && next !== current;
  const matches = confirm.length > 0 && confirm === next;
  // A confirmação só reclama depois que a pessoa teve chance de terminar de digitar.
  const showMismatch = confirm.length > 0 && !matches && (confirmTouched || confirm.length >= next.length);
  const ready = current.length > 0 && longEnough && differs && matches && phase === 'edit';

  useEffect(() => {
    currentRef.current?.focus();
  }, []);

  function watchCaps(e: KeyboardEvent<HTMLInputElement>) {
    setCapsOn(e.getModifierState('CapsLock'));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !user) return;
    const parsed = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Senha inválida');
      return;
    }
    setFormError(null);
    setCurrentError(null);
    setPhase('saving');
    try {
      await api.post('/users/me/password', parsed.data);
      // A confirmação fica na tela um instante; só depois a sessão nova entra
      // (a rota protegida leva ao painel assim que a conta deixa de ser provisória).
      setPhase('done');
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      await login({ email: user.email, password: parsed.data.newPassword });
      toast.success('Senha definida', { description: `Bem-vindo ao Módulo PCM, ${firstName}.` });
      navigate('/', { replace: true });
    } catch (err) {
      setPhase('edit');
      const message = err instanceof ApiError ? err.message : 'Não foi possível definir a senha. Tente de novo.';
      if (err instanceof ApiError && err.body.statusCode === 400 && /atual/i.test(message)) {
        setCurrentError('A senha provisória não confere. Confira com quem criou a sua conta.');
        setCurrent('');
        currentRef.current?.focus();
      } else {
        setFormError(message);
      }
    }
  }

  return (
    <div className="login">
      <LoginArt
        kicker="Transppass · Módulo PCM"
        headline="Bem-vindo à garagem."
        copy="Sua conta já está pronta. Só falta uma senha que seja só sua — e a partir daí, cada decisão da manutenção passa por aqui."
      />

      <section className="login__form-col">
        <form className={`login__card fa${phase === 'done' ? ' fa--done' : ''}`} onSubmit={submit} noValidate aria-busy={phase === 'saving'}>
          {phase === 'done' ? (
            <div className="fa__done" role="status">
              <span className="fa__done-icon"><CheckCircle2 size={34} aria-hidden /></span>
              <h1 className="login__title">Senha definida</h1>
              <p className="tp-muted">Entrando no painel…</p>
            </div>
          ) : (
            <>
              <div className="login__intro">
                <span className="login__coin" aria-hidden>
                  <TransppassMark size={30} />
                </span>
                <span className="fa__eyebrow">Primeiro acesso</span>
                <h1 className="login__title">Olá, {firstName}. Defina a sua senha</h1>
                <p className="tp-muted">Sua conta foi criada com uma senha provisória. Escolha uma só sua para começar a usar o sistema.</p>
              </div>

              <div className="tp-field">
                <label className="tp-label" htmlFor={`${ids}-current`}>Senha provisória</label>
                <div className="login__control login__control--password">
                  <LockKeyhole size={17} className="login__control-icon" aria-hidden />
                  <input
                    ref={currentRef}
                    id={`${ids}-current`}
                    className="tp-input tp-input--touch"
                    type={showCurrent ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="A senha que você recebeu"
                    value={current}
                    onChange={(e) => { setCurrent(e.target.value); setCurrentError(null); }}
                    onKeyDown={watchCaps}
                    onKeyUp={watchCaps}
                    aria-invalid={currentError ? 'true' : undefined}
                    aria-describedby={currentError ? `${ids}-current-error` : undefined}
                  />
                  <button type="button" className="login__eye" onClick={() => setShowCurrent((v) => !v)} aria-label={showCurrent ? 'Ocultar senha' : 'Mostrar senha'} title={showCurrent ? 'Ocultar senha' : 'Mostrar senha'}>
                    {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {currentError && <span id={`${ids}-current-error`} className="tp-error" role="alert">{currentError}</span>}
              </div>

              <div className="tp-field">
                <label className="tp-label" htmlFor={`${ids}-next`}>Nova senha</label>
                <div className="login__control login__control--password">
                  <KeyRound size={17} className="login__control-icon" aria-hidden />
                  <input
                    id={`${ids}-next`}
                    className="tp-input tp-input--touch"
                    type={showNext ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={`Pelo menos ${MIN_LENGTH} caracteres`}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    onKeyDown={watchCaps}
                    onKeyUp={watchCaps}
                    aria-describedby={`${ids}-rules`}
                  />
                  <button type="button" className="login__eye" onClick={() => setShowNext((v) => !v)} aria-label={showNext ? 'Ocultar senha' : 'Mostrar senha'} title={showNext ? 'Ocultar senha' : 'Mostrar senha'}>
                    {showNext ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>

                <div className={`fa__meter fa__meter--${strength.score}`} aria-hidden>
                  <span /><span /><span /><span />
                </div>
                <div className="fa__meter-label" aria-live="polite">
                  {next ? <span className={`fa__strength fa__strength--${strength.score}`}>{strength.label}</span> : <span className="tp-muted">Use letras, números e um símbolo para ficar forte.</span>}
                </div>

                <ul id={`${ids}-rules`} className="fa__rules">
                  <Rule ok={longEnough} pending={!next}>Pelo menos {MIN_LENGTH} caracteres</Rule>
                  <Rule ok={differs} pending={!next}>Diferente da senha provisória</Rule>
                  <Rule ok={matches} pending={!confirm}>Confirmação igual à nova senha</Rule>
                </ul>
              </div>

              <div className="tp-field">
                <label className="tp-label" htmlFor={`${ids}-confirm`}>Confirmar nova senha</label>
                <div className={`login__control login__control--password fa__confirm${matches ? ' is-ok' : showMismatch ? ' is-bad' : ''}`}>
                  <LockKeyhole size={17} className="login__control-icon" aria-hidden />
                  <input
                    id={`${ids}-confirm`}
                    className="tp-input tp-input--touch"
                    type={showNext ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Digite a nova senha outra vez"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onBlur={() => setConfirmTouched(true)}
                    onKeyDown={watchCaps}
                    onKeyUp={watchCaps}
                    aria-invalid={showMismatch ? 'true' : undefined}
                    aria-describedby={`${ids}-confirm-hint`}
                  />
                  <span className="fa__confirm-state" aria-hidden>{matches ? <Check size={18} /> : null}</span>
                </div>
                <span id={`${ids}-confirm-hint`} className={`fa__hint${matches ? ' is-ok' : showMismatch ? ' is-bad' : ''}`} aria-live="polite">
                  {matches ? 'As senhas conferem.' : showMismatch ? 'Ainda não confere com a nova senha.' : ' '}
                </span>
              </div>

              {capsOn && <div className="fa__caps" role="status">Caps Lock está ligado.</div>}
              {formError && <div className="tp-alert tp-alert--danger" role="alert">{formError}</div>}

              <button type="submit" className="tp-btn tp-btn--primary tp-btn--touch login__submit" disabled={!ready} aria-disabled={!ready}>
                {phase === 'saving' ? 'Salvando…' : 'Salvar e entrar'}
                {phase === 'edit' && <ArrowRight size={18} aria-hidden />}
              </button>
              {!ready && phase === 'edit' && (
                <p className="fa__gate tp-muted">
                  {!current ? 'Comece pela senha provisória.' : !longEnough ? `A nova senha precisa de ${MIN_LENGTH} caracteres.` : !differs ? 'A nova senha precisa ser diferente da provisória.' : 'Confirme a nova senha para liberar o botão.'}
                </p>
              )}

              <button type="button" className="tp-btn tp-btn--ghost fa__later" onClick={() => void logout().then(() => navigate('/login', { replace: true }))} disabled={phase !== 'edit'}>
                <LogOut size={14} aria-hidden /> Sair e trocar depois
              </button>

              <div className="login__restricted">
                <p className="login__help">
                  <ShieldCheck size={15} aria-hidden />
                  Sua senha é só sua: ninguém da Transppass vai pedi-la.
                </p>
              </div>
            </>
          )}
        </form>

        <p className="login__foot tp-muted">Transppass · Transporte de Passageiros · São Paulo</p>
      </section>
    </div>
  );
}

function Rule({ ok, pending, children }: { ok: boolean; pending: boolean; children: React.ReactNode }) {
  const state = ok ? 'ok' : pending ? 'pending' : 'todo';
  return (
    <li className={`fa__rule fa__rule--${state}`}>
      <span className="fa__rule-icon" aria-hidden>{ok ? <Check size={12} strokeWidth={3} /> : null}</span>
      <span>{children}</span>
      <span className="sr-only">{ok ? ' (ok)' : ''}</span>
    </li>
  );
}
