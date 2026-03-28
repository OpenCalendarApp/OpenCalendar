import { Link, Outlet } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.js';

export function Layout(): JSX.Element {
  const { logout, user } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Session Scheduler</h1>
        {user ? (
          <p className="user-badge">
            {user.first_name} {user.last_name} ({user.role.toUpperCase()})
          </p>
        ) : null}
        <nav>
          <Link to="/dashboard">Dashboard</Link>
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
