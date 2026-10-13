import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import './index.css';
import { ApiError, getSession, onSessionChange } from './lib/api';
import { AdminsPage } from './pages/Admins';
import { DuelsPage } from './pages/Duels';
import { NotificationsPage } from './pages/Notifications';
import { FinancePage, OrderDetailPage } from './pages/Finance';
import { ResultsPage } from './pages/Results';
import { SeriesEditorPage, StorePage } from './pages/Store';
import { SupportPage, TicketPage } from './pages/Support';
import { TestEditorPage } from './pages/TestEditor';
import { TestsPage } from './pages/Tests';
import { AuditPage } from './pages/Audit';
import { CmsPage } from './pages/Cms';
import { DashboardPage } from './pages/Dashboard';
import { ImportPage } from './pages/Import';
import { LoginPage } from './pages/Login';
import { QuestionEditorPage } from './pages/QuestionEditor';
import { QuestionsPage } from './pages/Questions';
import { SettingsPage } from './pages/Settings';
import { TaxonomyPage } from './pages/Taxonomy';
import { TournamentEditorPage } from './pages/TournamentEditor';
import { TournamentsPage } from './pages/Tournaments';
import { UsersPage } from './pages/Users';
import { ProctoringPage } from './pages/Proctoring';
import { WalletPage } from './pages/Wallet';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry only what can succeed on a retry (network, 429, 502-504). A 403/404/400 is the answer, not a glitch.
      retry: (failures, error) => failures < 2 && error instanceof ApiError && error.transient,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

function App() {
  const [session, setSession] = useState(getSession());
  useEffect(
    () =>
      onSessionChange((s) => {
        setSession(s);
        if (!s) queryClient.clear();
      }),
    [],
  );
  const location = useLocation();
  if (!session) return <LoginPage />;
  return (
    <ErrorBoundary resetKey={location.pathname}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="questions" element={<QuestionsPage />} />
        <Route path="questions/new" element={<QuestionEditorPage />} />
        <Route path="questions/import" element={<ImportPage />} />
        <Route path="questions/:id" element={<QuestionEditorPage />} />
        <Route path="taxonomy" element={<TaxonomyPage />} />
        <Route path="tournaments" element={<TournamentsPage />} />
        <Route path="tournaments/new" element={<TournamentEditorPage />} />
        <Route path="tournaments/:id" element={<TournamentEditorPage />} />
        <Route path="tournaments/:id/results" element={<ResultsPage />} />
        <Route path="tests" element={<TestsPage />} />
        <Route path="tests/new" element={<TestEditorPage />} />
        <Route path="tests/:id" element={<TestEditorPage />} />
        <Route path="store" element={<StorePage />} />
        <Route path="store/series/new" element={<SeriesEditorPage />} />
        <Route path="store/series/:id" element={<SeriesEditorPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="wallet" element={<WalletPage />} />
        <Route path="proctoring" element={<ProctoringPage />} />
        <Route path="finance/orders/:id" element={<OrderDetailPage />} />
        <Route path="support" element={<SupportPage />} />
        <Route path="support/tickets/:id" element={<TicketPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="announcements" element={<NotificationsPage />} />
        <Route path="duels" element={<DuelsPage />} />
        <Route path="cms" element={<CmsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admins" element={<AdminsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<p className="text-gray-500">Page not found.</p>} />
      </Route>
    </Routes>
    </ErrorBoundary>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
