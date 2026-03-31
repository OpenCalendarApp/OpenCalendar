import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AdminUserResponse,
  AdminUserSummary,
  AdminUsersResponse,
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
  UserRole
} from '@calendar-genie/shared';

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
        <div className="header-row">
          <label>
            Role Filter
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)}>
              <option value="all">All roles</option>
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {role.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <label>
            Status Filter
            <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}>
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>
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
                    <select
                      value={draftRoles[user.id] ?? user.role}
                      onChange={(event) =>
                        setDraftRoles((prev) => ({ ...prev, [user.id]: event.target.value as UserRole }))
                      }
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={draftIsActive[user.id] ?? user.is_active}
                        onChange={(event) =>
                          setDraftIsActive((prev) => ({ ...prev, [user.id]: event.target.checked }))
                        }
                      />
                      {(draftIsActive[user.id] ?? user.is_active) ? 'Active' : 'Inactive'}
                    </label>
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
