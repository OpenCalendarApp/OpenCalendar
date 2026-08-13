import { Link, Outlet } from 'react-router-dom';
import { LayoutDashboard, LogOut, Palette, ScrollText, Shield, ShieldCheck, Users } from 'lucide-react';

import { BrandLogo } from './BrandLogo.js';
import { useAuth } from '../context/AuthContext.js';

export function Layout(): JSX.Element {
  const { logout, user } = useAuth();

  return (
    <div className="app-shell">
      <header className="topnav">
        <Link to="/dashboard" className="brand-link topnav-brand" aria-label="OpenCalendar dashboard">
          <BrandLogo className="brand-logo sidebar-logo" variant="horizontal" />
        </Link>
        <nav className="topnav-links">
          <Link to="/dashboard"><LayoutDashboard size={16} /> Dashboard</Link>
          {user?.role === 'admin' ? <Link to="/admin"><Shield size={16} /> Admin</Link> : null}
          {user?.role === 'admin' ? <Link to="/admin/branding"><Palette size={16} /> Branding</Link> : null}
          {user?.role === 'admin' ? <Link to="/admin/audit"><ScrollText size={16} /> Audit Log</Link> : null}
          {user?.role === 'admin' ? <Link to="/admin/sso"><ShieldCheck size={16} /> SSO (OIDC)</Link> : null}
          {user?.role === 'admin' ? <Link to="/admin/users"><Users size={16} /> Users</Link> : null}
        </nav>
        <div className="topnav-user">
          {user ? (
            <>
              <span className="topnav-user-name">{user.first_name} {user.last_name}</span>
              <span className="user-badge">{user.role.toUpperCase()}</span>
            </>
          ) : null}
          <button type="button" className="secondary-button small-button" onClick={logout}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
