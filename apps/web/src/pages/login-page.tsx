import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, TimerOff } from 'lucide-react';
import { loginSchema, type LoginInput } from '@app/shared';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/features/auth/use-auth';
import { TransppassMark } from '@/components/brand/transppass-logo';
import { BusFront } from '@/components/bus/bus-front';

/**
 * Login — a única tela sem o shell.
 *
 * À esquerda, a imagem da marca: o ônibus da Transppass de frente, saindo da
 * garagem à noite e dando farol alto, com a luz laranja da marca e o símbolo
 * como marca d'água.
 * À direita, o formulário, sempre. No celular a imagem vira uma faixa curta
 * no topo e o formulário toma a tela.
 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as { from?: { pathname?: string; search?: string }; expired?: boolean };
  // Depois de entrar, volta para a tela de onde a sessao caiu.
  const returnTo = state.from?.pathname && state.from.pathname !== '/login' ? `${state.from.pathname}${state.from.search ?? ''}` : '/';
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
      navigate(returnTo, { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível entrar');
    }
  });

  return (
    <div className="login">
      <aside className="login__art" aria-hidden>
        <TransppassMark size={420} className="login__watermark" />
        <div className="login__art-copy">
          <span className="login__kicker">Transppass · Módulo PCM</span>
          <h2 className="login__headline">A garagem inteira, numa tela.</h2>
          <p>
            Do evento na rua à liberação do carro: cada decisão vira registro, e o MKBF sai do
            próprio processo — ninguém digita.
          </p>
        </div>
        <div className="login__road">
          <BusFront className="login__bus" />
        </div>
      </aside>

      <section className="login__form-col">
        <form className="login__card" onSubmit={onSubmit} noValidate>
          <div className="login__intro">
            <span className="login__coin" aria-hidden>
              <TransppassMark size={30} />
            </span>
            <h1 className="login__title">Acessar o Módulo PCM</h1>
            <p className="tp-muted">Entre com o e-mail e a senha da sua conta.</p>
          </div>

          <div className="tp-field">
            <label className="tp-label" htmlFor="login-email">
              E-mail
            </label>
            <div className="login__control">
              <Mail size={17} className="login__control-icon" aria-hidden />
              <input
                id="login-email"
                className="tp-input tp-input--touch"
                type="email"
                autoComplete="email"
                placeholder="nome@transppass.com.br"
                aria-invalid={errors.email ? 'true' : undefined}
                {...register('email')}
              />
            </div>
            {errors.email && <span className="tp-error">{errors.email.message}</span>}
          </div>

          <div className="tp-field">
            <label className="tp-label" htmlFor="login-password">
              Senha
            </label>
            <div className="login__control login__control--password">
              <LockKeyhole size={17} className="login__control-icon" aria-hidden />
              <input
                id="login-password"
                className="tp-input tp-input--touch"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Digite sua senha"
                aria-invalid={errors.password ? 'true' : undefined}
                {...register('password')}
              />
              <button
                type="button"
                className="login__eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {errors.password && <span className="tp-error">{errors.password.message}</span>}
          </div>

          {state.expired && !formError && (
            <div className="tp-alert tp-alert--warning login__notice" role="status">
              <TimerOff size={16} aria-hidden />
              <span>Sua sessão expirou. Entre de novo para continuar de onde parou.</span>
            </div>
          )}
          {formError && <div className="tp-alert tp-alert--danger">{formError}</div>}

          <button type="submit" className="tp-btn tp-btn--primary tp-btn--touch login__submit" disabled={isSubmitting}>
            {isSubmitting ? 'Entrando…' : 'Entrar'}
            {!isSubmitting && <ArrowRight size={18} aria-hidden />}
          </button>

          <Link to="/esqueci-senha" className="login__forgot">Esqueci minha senha</Link>

          <div className="login__restricted">
            <p className="login__help">
              <ShieldCheck size={15} aria-hidden />
              Acesso restrito a colaboradores autorizados
            </p>
            <small>Precisa de conta? Fale com o administrador do sistema.</small>
          </div>
        </form>

        <p className="login__foot tp-muted">Transppass · Transporte de Passageiros · São Paulo</p>
      </section>
    </div>
  );
}
