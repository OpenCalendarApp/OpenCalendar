import { Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from './components/Layout.js';
import { useAuth } from './context/AuthContext.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { ProjectDetailPage } from './pages/ProjectDetailPage.js';
import { PublicBookingPage } from './pages/PublicBookingPage.js';
import { ReschedulePage } from './pages/ReschedulePage.js';

export function App(): JSX.Element {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
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
      </Route>

      <Route
        path="*"
        element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />}
      />
    </Routes>
  );
}
