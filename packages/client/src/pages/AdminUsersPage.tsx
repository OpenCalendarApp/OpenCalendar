import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  AdminCreateUserResponse,
  AdminUserResponse,
  AdminUserSummary,
  AdminUsersResponse,
  CreateAdminUserRequest,
  UpdateUserRoleRequest,
  UpdateUserStatusRequest,
  UserRole
} from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';
import { useToast } from '../context/ToastContext.js';

type UserPendingState = Record<number, boolean>;
type ActiveFilter = 'all' | 'active' | 'inactive';

const roleOptions: UserRole[] = ['admin', 'pm', 'engineer'];

const emptyNewUserForm = {
  email: '',
  first_name: '',
  last_name: '',
  phone: '',
  role: 'engineer' as UserRole
};

export function AdminUsersPage(): JSX.Element {
  const { showToast } = useToast();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [draftRoles, setDraftRoles] = useState<Record<number, UserRole>>({});
  const [draftIsActive, setDraftIsActive] = useState<Record<number, boolean>>({});
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingRoleByUserId, setPendingRoleByUserId] = useState<UserPendingState>({});
  const [pendingStatusByUserId, setPendingStatusByUserId] = useState<UserPendingState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [newUserForm, setNewUserForm] = useState(emptyNewUserForm);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState<string | null>(null);
  const [createdUserCredential, setCreatedUserCredential] = useState<{ email: string; temporaryPassword: string } | null>(null);

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

  async function saveBoth(userId: number): Promise<void> {
    const user = users.find((existing) => existing.id === userId);
    if (!user) {
      return;
    }

    const draftRole = draftRoles[userId] ?? user.role;
    const draftActive = draftIsActive[userId] ?? user.is_active;

    if (draftRole !== user.role) {
      await saveRole(userId);
    }
    if (draftActive !== user.is_active) {
      await saveStatus(userId);
    }
  }

  async function createUser(): Promise<void> {
    const email = newUserForm.email.trim();
    const firstName = newUserForm.first_name.trim();
    const lastName = newUserForm.last_name.trim();
    const phone = newUserForm.phone.trim();

    if (!email || !firstName || !lastName) {
      setCreateUserError('Email, first name, and last name are required.');
      return;
    }

    setIsCreatingUser(true);
    setCreateUserError(null);

    try {
      const payload: CreateAdminUserRequest = {
        email,
        first_name: firstName,
        last_name: lastName,
        phone: phone || undefined,
        role: newUserForm.role
      };
      const response = await apiFetch<AdminCreateUserResponse>('/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setUsers((prev) => [response.user, ...prev]);
      setDraftRoles((prev) => ({ ...prev, [response.user.id]: response.user.role }));
      setDraftIsActive((prev) => ({ ...prev, [response.user.id]: response.user.is_active }));
      setCreatedUserCredential({ email: response.user.email, temporaryPassword: response.temporary_password });
      setNewUserForm(emptyNewUserForm);
      setIsCreateFormOpen(false);
      showToast('User created.', 'success');
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Unable to create user';
      setCreateUserError(message);
    } finally {
      setIsCreatingUser(false);
    }
  }

  const adminCount = useMemo(() => users.filter((user) => user.role === 'admin').length, [users]);
  const pmCount = useMemo(() => users.filter((user) => user.role === 'pm').length, [users]);
  const engineerCount = useMemo(() => users.filter((user) => user.role === 'engineer').length, [users]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return users;
    }
    return users.filter((user) => {
      const fullName = `${user.first_name} ${user.last_name}`.toLowerCase();
      return fullName.includes(term) || user.email.toLowerCase().includes(term);
    });
  }, [users, searchTerm]);

  const hasUsers = useMemo(() => filteredUsers.length > 0, [filteredUsers.length]);

  return (
    <section>
      <div className="header-row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h2>Users</h2>
          <p className="hint">
            {users.length} users · {adminCount} admin{adminCount === 1 ? '' : 's'} · {pmCount} PMs · {engineerCount} engineers
          </p>
        </div>
        <div className="button-row">
          <button type="button" className="header-button secondary-button" onClick={() => void loadUsers()} disabled={isLoading}>
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            type="button"
            className="header-button"
            onClick={() => {
              setCreateUserError(null);
              setIsCreateFormOpen((prev) => !prev);
            }}
          >
            {isCreateFormOpen ? 'Cancel' : 'Create User'}
          </button>
        </div>
      </div>

      {createdUserCredential ? (
        <div className="detail-card status-card">
          <p>
            User <strong>{createdUserCredential.email}</strong> was created with temporary password:{' '}
            <strong>{createdUserCredential.temporaryPassword}</strong>
          </p>
          <p className="hint">Copy this now — it will not be shown again. Share it with the user through a secure channel.</p>
          <button type="button" className="secondary-button small-button" onClick={() => setCreatedUserCredential(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {isCreateFormOpen ? (
        <form
          className="detail-card"
          onSubmit={(event) => {
            event.preventDefault();
            void createUser();
          }}
        >
          {createUserError ? <p className="error">{createUserError}</p> : null}

          <label>
            Email
            <input
              type="email"
              value={newUserForm.email}
              onChange={(event) => setNewUserForm((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>

          <label>
            First Name
            <input
              value={newUserForm.first_name}
              onChange={(event) => setNewUserForm((prev) => ({ ...prev, first_name: event.target.value }))}
              required
            />
          </label>

          <label>
            Last Name
            <input
              value={newUserForm.last_name}
              onChange={(event) => setNewUserForm((prev) => ({ ...prev, last_name: event.target.value }))}
              required
            />
          </label>

          <label>
            Phone (optional)
            <input
              value={newUserForm.phone}
              onChange={(event) => setNewUserForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
          </label>

          <label>Role</label>
          <div className="seg">
            {roleOptions.map((role) => (
              <label key={role} className={`seg-opt${newUserForm.role === role ? ' checked' : ''}`}>
                <input
                  type="radio"
                  name="new-user-role"
                  checked={newUserForm.role === role}
                  onChange={() => setNewUserForm((prev) => ({ ...prev, role }))}
                />
                <span>{role.toUpperCase()}</span>
              </label>
            ))}
          </div>

          <button type="submit" className="secondary-button" disabled={isCreatingUser}>
            {isCreatingUser ? 'Creating...' : 'Create User'}
          </button>
        </form>
      ) : null}

      <div className="filter-bar">
        <div className="filter-field">
          <span className="filter-label">Role</span>
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

        <div className="filter-field">
          <span className="filter-label">Status</span>
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

        <div className="filter-field filter-field--search">
          <span className="filter-label">Search</span>
          <input
            placeholder="Name or email"
            className="h-34"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            style={{ width: '220px' }}
          />
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
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '26%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th className="text-right">Created</th>
                <th>Save</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const draftRole = draftRoles[user.id] ?? user.role;
                const draftActive = draftIsActive[user.id] ?? user.is_active;
                const isDirty = draftRole !== user.role || draftActive !== user.is_active;
                const pending = Boolean(pendingRoleByUserId[user.id]) || Boolean(pendingStatusByUserId[user.id]);

                return (
                  <tr key={user.id} className={isDirty ? 'is-dirty' : undefined}>
                    <td>{user.first_name} {user.last_name}</td>
                    <td>{user.email}</td>
                    <td>
                      <select
                        className="h-32"
                        value={draftRole}
                        onChange={(event) =>
                          setDraftRoles((prev) => ({ ...prev, [user.id]: event.target.value as UserRole }))
                        }
                        style={isDirty ? { borderColor: 'var(--color-text-primary)' } : undefined}
                      >
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                        onClick={() =>
                          setDraftIsActive((prev) => ({
                            ...prev,
                            [user.id]: !(prev[user.id] ?? user.is_active)
                          }))
                        }
                      >
                        <span className={draftActive ? 'tag tag-accent' : 'tag tag-neutral'}>
                          {draftActive ? 'Active' : 'Inactive'}
                        </span>
                      </button>
                    </td>
                    <td className="text-right tabular-nums">{new Date(user.created_at).toLocaleString()}</td>
                    <td>
                      {isDirty ? (
                        <button type="button" onClick={() => void saveBoth(user.id)} disabled={pending}>
                          {pending ? 'Saving...' : 'Save'}
                        </button>
                      ) : (
                        <span className="hint" style={{ fontSize: '0.8125rem' }}>Saved</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
