import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { loginSchema, type LoginInput } from '@app/shared';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/features/auth/use-auth';

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
      setFormError(err instanceof ApiError ? err.message : 'Nao foi possivel entrar');
    }
  });

  return (
    <div className="page-center">
      <form className="card" onSubmit={onSubmit} noValidate>
        <h1>Transppass PCM</h1>
        <p className="muted">Gestão de manutenção e operações da frota</p>

        <label>
          E-mail
          <input type="email" autoComplete="email" {...register('email')} />
          {errors.email && <span className="field-error">{errors.email.message}</span>}
        </label>

        <label>
          Senha
          <input type="password" autoComplete="current-password" {...register('password')} />
          {errors.password && <span className="field-error">{errors.password.message}</span>}
        </label>

        {formError && <p className="form-error">{formError}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="muted">Acesso individual. Contas são criadas pelo administrador.</p>
      </form>
    </div>
  );
}
