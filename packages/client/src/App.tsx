import { Navigate, Route, Routes } from 'react-router-dom';

import { AdminRoute } from './components/AdminRoute.js';
import { Layout } from './components/Layout.js';
import { useAuth } from './context/AuthContext.js';
import { AdminAuditPage } from './pages/AdminAuditPage.js';
import { AdminOverviewPage } from './pages/AdminOverviewPage.js';
import { AdminSsoPage } from './pages/AdminSsoPage.js';
import { AdminUsersPage } from './pages/AdminUsersPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { ProjectDetailPage } from './pages/ProjectDetailPage.js';
import { PublicBookingPage } from './pages/PublicBookingPage.js';
import { ReschedulePage } from './pages/ReschedulePage.js';
import { ResetPasswordPage } from './pages/ResetPasswordPage.js';
import { SetupPage } from './pages/SetupPage.js';

export function App(): JSX.Element {
  const { isAuthenticated, isBootstrapping } = useAuth();

  if (isBootstrapping) {
    return (
      <main className="center-card">
        <h2>Loading session...</h2>
      </main>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/setup"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <SetupPage />}
      />
      <Route
        path="/forgot-password"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <ForgotPasswordPage />}
      />
      <Route
        path="/reset-password/:token"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <ResetPasswordPage />}
      />
      <Route path="/schedule/:shareToken" element={<PublicBookingPage />} />
      <Route path="/schedule/:shareToken/reschedule/:bookingToken" element={<ReschedulePage />} />

      <Route
        path="/"
        element={isAuthenticated ? <Layout /> : <Navigate to="/login" replace />}
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="projects" element={<DashboardPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="admin" element={<AdminRoute />}>
          <Route index element={<AdminOverviewPage />} />
          <Route path="audit" element={<AdminAuditPage />} />
          <Route path="sso" element={<AdminSsoPage />} />
          <Route path="users" element={<AdminUsersPage />} />
        </Route>
      </Route>

      <Route
        path="*"
        element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />}
      />
    </Routes>
  );
}
