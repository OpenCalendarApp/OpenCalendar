import { Navigate, Outlet } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.js';

export function AdminRoute(): JSX.Element {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
