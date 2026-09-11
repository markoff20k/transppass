import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { loginSchema, VehicleStatus, type LoginInput } from '@app/shared';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/features/auth/use-auth';
import { TransppassLogo, TransppassMark } from '@/components/brand/transppass-logo';
import { BusIllustration } from '@/components/bus/bus-illustration';

/**
 * Login — a única tela sem o shell.
 *
 * À esquerda, a imagem da marca: o ônibus da Transppass em linha sobre a
 * garagem à noite, com a luz laranja da marca e o símbolo como marca d'água.
 * À direita, o formulário, sempre. No celular a imagem vira uma faixa curta
 * no topo e o formulário toma a tela.
 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
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
      navigate('/', { replace: true });
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
          <BusIllustration status={VehicleStatus.IN_LINE} code="10001" width={560} className="login__bus" />
        </div>
      </aside>

      <section className="login__form-col">
        <div className="login__brand">
          <TransppassLogo height={48} />
        </div>

        <form className="login__form" onSubmit={onSubmit} noValidate>
          <div className="login__intro">
            <span className="subheader__eyebrow">Acesso</span>
            <h1 className="login__title">Bem-vindo de volta</h1>
            <p className="tp-muted">Entre com o e-mail e a senha da sua conta.</p>
          </div>

          <div className="tp-field">
            <label className="tp-label" htmlFor="login-email">
              E-mail
            </label>
            <input
              id="login-email"
              className="tp-input tp-input--touch"
              type="email"
              autoComplete="email"
              placeholder="nome@transppass.com.br"
              aria-invalid={errors.email ? 'true' : undefined}
              {...register('email')}
            />
            {errors.email && <span className="tp-error">{errors.email.message}</span>}
          </div>

          <div className="tp-field">
            <label className="tp-label" htmlFor="login-password">
              Senha
            </label>
            <div className="login__password">
              <input
                id="login-password"
                className="tp-input tp-input--touch"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
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

          {formError && <div className="tp-alert tp-alert--danger">{formError}</div>}

          <button type="submit" className="tp-btn tp-btn--primary tp-btn--touch login__submit" disabled={isSubmitting}>
            {isSubmitting ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="login__help">
            <LockKeyhole size={14} />
            Acesso individual. Precisa de conta? Fale com o administrador do sistema.
          </p>
        </form>

        <p className="login__foot tp-muted">Transppass · Transporte de Passageiros · São Paulo</p>
      </section>
    </div>
  );
}
