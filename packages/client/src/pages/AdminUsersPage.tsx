import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AdminUserResponse,
  AdminUserSummary,
  AdminUsersResponse,
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
  UserRole
} from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';
import { useToast } from '../context/ToastContext.js';

type UserPendingState = Record<number, boolean>;
type ActiveFilter = 'all' | 'active' | 'inactive';

const roleOptions: UserRole[] = ['admin', 'pm', 'engineer'];

export function AdminUsersPage(): JSX.Element {
  const { showToast } = useToast();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [draftRoles, setDraftRoles] = useState<Record<number, UserRole>>({});
  const [draftIsActive, setDraftIsActive] = useState<Record<number, boolean>>({});
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [pendingRoleByUserId, setPendingRoleByUserId] = useState<UserPendingState>({});
  const [pendingStatusByUserId, setPendingStatusByUserId] = useState<UserPendingState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (roleFilter !== 'all') {
      params.set('role', roleFilter);
    }
    if (activeFilter === 'active') {
      params.set('is_active', 'true');
    } else if (activeFilter === 'inactive') {
      params.set('is_active', 'false');
    }

    const query = params.toString();
    const path = query ? `/admin/users?${query}` : '/admin/users';

    try {
      const response = await apiFetch<AdminUsersResponse>(path);
      setUsers(response.users);
      setDraftRoles(Object.fromEntries(response.users.map((user) => [user.id, user.role])));
      setDraftIsActive(Object.fromEntries(response.users.map((user) => [user.id, user.is_active])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load users');
    } finally {
      setIsLoading(false);
    }
  }, [activeFilter, roleFilter]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  function applyUserUpdate(updatedUser: AdminUserSummary): void {
    setUsers((prev) => prev.map((existing) => (existing.id === updatedUser.id ? updatedUser : existing)));
    setDraftRoles((prev) => ({ ...prev, [updatedUser.id]: updatedUser.role }));
    setDraftIsActive((prev) => ({ ...prev, [updatedUser.id]: updatedUser.is_active }));
  }

  async function saveRole(userId: number): Promise<void> {
    const selectedRole = draftRoles[userId];
    if (!selectedRole) {
      return;
    }

    setPendingRoleByUserId((prev) => ({ ...prev, [userId]: true }));

    try {
      const payload: UpdateUserRoleRequest = { role: selectedRole };
      const response = await apiFetch<AdminUserResponse>(`/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      applyUserUpdate(response.user);
      showToast('User role updated.', 'success');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to update user role';
      showToast(message, 'error');
    } finally {
      setPendingRoleByUserId((prev) => ({ ...prev, [userId]: false }));
    }
  }

  async function saveStatus(userId: number): Promise<void> {
    const selectedIsActive = draftIsActive[userId];
    if (selectedIsActive === undefined) {
      return;
    }

    setPendingStatusByUserId((prev) => ({ ...prev, [userId]: true }));

    try {
      const payload: UpdateUserStatusRequest = { is_active: selectedIsActive };
      const response = await apiFetch<AdminUserResponse>(`/admin/users/${userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      applyUserUpdate(response.user);
      showToast('User status updated.', 'success');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to update user status';
      showToast(message, 'error');
    } finally {
      setPendingStatusByUserId((prev) => ({ ...prev, [userId]: false }));
    }
  }

  const hasUsers = useMemo(() => users.length > 0, [users.length]);

  return (
    <section>
      <div className="header-row">
        <h2>Admin Users</h2>
        <button type="button" className="header-button" onClick={() => void loadUsers()} disabled={isLoading}>
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="detail-card">
        <div className="header-row" style={{ border: 'none', margin: 0, padding: 0 }}>
          <div>
            <label>Role Filter</label>
            <div className="seg">
              <label className={`seg-opt${roleFilter === 'all' ? ' checked' : ''}`}>
                <input type="radio" name="role-filter" checked={roleFilter === 'all'} onChange={() => setRoleFilter('all')} />
                <span>All</span>
              </label>
              {roleOptions.map((role) => (
                <label key={role} className={`seg-opt${roleFilter === role ? ' checked' : ''}`}>
                  <input type="radio" name="role-filter" checked={roleFilter === role} onChange={() => setRoleFilter(role)} />
                  <span>{role.toUpperCase()}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label>Status Filter</label>
            <div className="seg">
              <label className={`seg-opt${activeFilter === 'all' ? ' checked' : ''}`}>
                <input type="radio" name="status-filter" checked={activeFilter === 'all'} onChange={() => setActiveFilter('all')} />
                <span>All</span>
              </label>
              <label className={`seg-opt${activeFilter === 'active' ? ' checked' : ''}`}>
                <input type="radio" name="status-filter" checked={activeFilter === 'active'} onChange={() => setActiveFilter('active')} />
                <span>Active</span>
              </label>
              <label className={`seg-opt${activeFilter === 'inactive' ? ' checked' : ''}`}>
                <input type="radio" name="status-filter" checked={activeFilter === 'inactive'} onChange={() => setActiveFilter('inactive')} />
                <span>Inactive</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="detail-card status-card">
          <p className="error">{error}</p>
        </div>
      ) : null}

      {isLoading && !hasUsers ? (
        <div className="detail-card status-card">
          <p>Loading users...</p>
        </div>
      ) : null}

      {!isLoading && !error && !hasUsers ? (
        <div className="detail-card status-card">
          <p className="hint">No users found for current filters.</p>
        </div>
      ) : null}

      {hasUsers ? (
        <div className="detail-card">
          <table className="block-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.first_name} {user.last_name}</td>
                  <td>{user.email}</td>
                  <td>
                    <div className="seg">
                      {roleOptions.map((role) => {
                        const current = draftRoles[user.id] ?? user.role;
                        return (
                          <label key={role} className={`seg-opt${current === role ? ' checked' : ''}`}>
                            <input
                              type="radio"
                              name={`role-${user.id}`}
                              checked={current === role}
                              onChange={() => setDraftRoles((prev) => ({ ...prev, [user.id]: role }))}
                            />
                            <span>{role.toUpperCase()}</span>
                          </label>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    <span className={(draftIsActive[user.id] ?? user.is_active) ? 'tag tag-accent' : 'tag tag-neutral'}>
                      {(draftIsActive[user.id] ?? user.is_active) ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      type="button"
                      className="secondary-button small-button"
                      style={{ marginTop: '6px' }}
                      onClick={() =>
                        setDraftIsActive((prev) => ({
                          ...prev,
                          [user.id]: !(prev[user.id] ?? user.is_active)
                        }))
                      }
                    >
                      Toggle
                    </button>
                  </td>
                  <td>{new Date(user.created_at).toLocaleString()}</td>
                  <td>
                    <div className="button-row">
                      <button
                        type="button"
                        className="secondary-button small-button"
                        onClick={() => void saveRole(user.id)}
                        disabled={Boolean(pendingRoleByUserId[user.id])}
                      >
                        {pendingRoleByUserId[user.id] ? 'Saving...' : 'Save Role'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button small-button"
                        onClick={() => void saveStatus(user.id)}
                        disabled={Boolean(pendingStatusByUserId[user.id])}
                      >
                        {pendingStatusByUserId[user.id] ? 'Saving...' : 'Save Status'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
