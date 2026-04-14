import { Link, Outlet } from 'react-router-dom';

import { BrandLogo } from './BrandLogo.js';
import { useAuth } from '../context/AuthContext.js';

export function Layout(): JSX.Element {
  const { logout, user } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link to="/dashboard" className="brand-link" aria-label="Calendar Genie dashboard">
            <BrandLogo className="brand-logo sidebar-logo" />
          </Link>
          <p className="brand-subtitle">Team scheduling built for how consultants work.</p>
        </div>
        {user ? (
          <p className="user-badge">
            {user.first_name} {user.last_name} ({user.role.toUpperCase()})
          </p>
        ) : null}
        <nav>
          <Link to="/dashboard">Dashboard</Link>
          {user?.role === 'admin' ? <Link to="/admin">Admin Overview</Link> : null}
          {user?.role === 'admin' ? <Link to="/admin/audit">Audit Log</Link> : null}
          {user?.role === 'admin' ? <Link to="/admin/sso">SSO (OIDC)</Link> : null}
          {user?.role === 'admin' ? <Link to="/admin/users">Admin Users</Link> : null}
        </nav>
        <button type="button" onClick={logout}>
          Logout
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
