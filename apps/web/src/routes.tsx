import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/features/auth/protected-route';
import { AppShell } from '@/components/app-shell';
import { LoginPage } from '@/pages/login-page';
import { FleetPanelPage } from '@/pages/fleet-panel-page';
import { OdometerEntryPage } from '@/pages/odometer-entry-page';
import { VehiclesPage } from '@/pages/vehicles-page';
import { CatalogPage } from '@/pages/catalog-page';
import { NotFoundPage } from '@/pages/not-found-page';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          // R0 — Fundacoes (secao 11 do PRD)
          { path: '/', element: <FleetPanelPage /> },
          { path: '/km', element: <OdometerEntryPage /> },
          { path: '/cadastros/frota', element: <VehiclesPage /> },
          { path: '/cadastros/catalogo', element: <CatalogPage /> },
          // R1 (evento, triagem, fila, OS) e R2 (preventiva, plantao) entram aqui.
        ],
      },
    ],
  },
  { path: '/404', element: <NotFoundPage /> },
  { path: '*', element: <Navigate to="/404" replace /> },
]);
