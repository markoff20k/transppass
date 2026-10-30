import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './use-auth';
import { BrandLoader } from '@/components/brand/brand-loader';

export function ProtectedRoute() {
  const { user, isLoading, expired } = useAuth();
  const location = useLocation();

  if (isLoading) return <BrandLoader fullscreen wordmark size={104} label="Preparando a garagem" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location, expired }} />;

  return <Outlet />;
}
