import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { loginSchema, VehicleStatus, type LoginInput } from '@app/shared';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/features/auth/use-auth';
import { TransppassLogo } from '@/components/brand/transppass-logo';
import { BusIllustration } from '@/components/bus/bus-illustration';

/**
 * Login — a única tela sem o shell.
 *
 * Duas colunas: à esquerda o formulário sobre superfície clara, onde o logo
 * fica no seu chão natural; à direita um painel grafite com a frota em
 * movimento — o mesmo ônibus que o painel usa, já contando o que o sistema
 * faz antes de a pessoa entrar. No celular sobra só o formulário.
 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

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
      <section className="login__form-col">
        <div className="login__brand">
          <TransppassLogo height={52} />
        </div>

        <form className="login__form" onSubmit={onSubmit} noValidate>
          <div>
            <span className="subheader__eyebrow">Módulo PCM</span>
            <h1 className="login__title">Gestão de manutenção e operações da frota</h1>
            <p className="tp-muted">Acesso individual. Contas são criadas pelo administrador.</p>
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
              aria-invalid={errors.email ? 'true' : undefined}
              {...register('email')}
            />
            {errors.email && <span className="tp-error">{errors.email.message}</span>}
          </div>

          <div className="tp-field">
            <label className="tp-label" htmlFor="login-password">
              Senha
            </label>
            <input
              id="login-password"
              className="tp-input tp-input--touch"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? 'true' : undefined}
              {...register('password')}
            />
            {errors.password && <span className="tp-error">{errors.password.message}</span>}
          </div>

          {formError && <div className="tp-alert tp-alert--danger">{formError}</div>}

          <button type="submit" className="tp-btn tp-btn--primary tp-btn--touch" disabled={isSubmitting}>
            {isSubmitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="login__foot tp-muted">
          Transppass · Transporte de Passageiros · São Paulo
        </p>
      </section>

      <aside className="login__art" aria-hidden>
        <div className="login__art-buses">
          <BusIllustration status={VehicleStatus.IN_LINE} code="10001" width={300} />
          <BusIllustration status={VehicleStatus.IN_MAINTENANCE} code="10002" width={300} />
          <BusIllustration status={VehicleStatus.IN_CLEANING} code="20001" width={300} />
        </div>
        <div className="login__art-text">
          <span className="login__art-kicker">Do evento na rua à liberação</span>
          <p>
            Cada carro no estado em que está. Toda decisão vira registro. O MKBF sai do
            próprio processo — ninguém digita.
          </p>
        </div>
      </aside>
    </div>
  );
}
