import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '@/features/auth/protected-route';
import { AppShell } from '@/components/app-shell';
import { LoginPage } from '@/pages/login-page';
import { FleetPanelPage } from '@/pages/fleet-panel-page';
import { OdometerEntryPage } from '@/pages/odometer-entry-page';
import { VehiclesPage } from '@/pages/vehicles-page';
import { CatalogPage } from '@/pages/catalog-page';
import { EventsPage } from '@/pages/events-page';
import { TriagePage } from '@/pages/triage-page';
import { QueuePage } from '@/pages/queue-page';
import { FieldServicePage } from '@/pages/field-service-page';
import { WorkOrdersPage } from '@/pages/work-orders-page';
import { WorkOrderPage } from '@/pages/work-order-page';
import { StockPage } from '@/pages/stock-page';
import { MetricsPage } from '@/pages/metrics-page';
import { NotFoundPage } from '@/pages/not-found-page';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          // R0 — Fundacoes
          { path: '/', element: <FleetPanelPage /> },
          { path: '/km', element: <OdometerEntryPage /> },
          { path: '/cadastros/frota', element: <VehiclesPage /> },
          { path: '/cadastros/catalogo', element: <CatalogPage /> },
          // R1 — Corretivo e execucao
          { path: '/eventos', element: <EventsPage /> },
          { path: '/triagem', element: <TriagePage /> },
          { path: '/fila', element: <QueuePage /> },
          { path: '/socorro', element: <FieldServicePage /> },
          { path: '/os', element: <WorkOrdersPage /> },
          { path: '/os/:id', element: <WorkOrderPage /> },
          { path: '/estoque', element: <StockPage /> },
          { path: '/indicadores', element: <MetricsPage /> },
          // R2 (preventiva, plantao) entra aqui.
        ],
      },
    ],
  },
  { path: '/404', element: <NotFoundPage /> },
  { path: '*', element: <Navigate to="/404" replace /> },
]);
