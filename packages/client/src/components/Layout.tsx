import { Link, Outlet } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.js';

export function Layout(): JSX.Element {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Session Scheduler</h1>
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
