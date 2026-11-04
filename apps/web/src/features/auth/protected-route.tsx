import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './use-auth';
import { BrandLoader } from '@/components/brand/brand-loader';

export const FIRST_ACCESS_PATH = '/primeiro-acesso';

export function ProtectedRoute() {
  const { user, isLoading, expired } = useAuth();
  const location = useLocation();

  if (isLoading) return <BrandLoader fullscreen wordmark size={104} label="Preparando a garagem" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location, expired }} />;

  // Senha provisória: a pessoa define a sua antes de ver qualquer tela (a API
  // bloqueia o resto também — PasswordChangeGuard).
  const atFirstAccess = location.pathname === FIRST_ACCESS_PATH;
  if (user.mustChangePassword && !atFirstAccess) return <Navigate to={FIRST_ACCESS_PATH} replace />;
  if (!user.mustChangePassword && atFirstAccess) return <Navigate to="/" replace />;

  return <Outlet />;
}
