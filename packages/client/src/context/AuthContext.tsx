import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type {
  AuthResponse,
  LoginRequest,
  MeResponse,
  RegisterRequest,
  User
} from '@session-scheduler/shared';

import { apiFetch } from '../api/client.js';
import { clearStoredToken, getStoredToken, setStoredToken } from '../auth/storage.js';

interface AuthContextValue {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  register: (payload: RegisterRequest) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const logout = useCallback(() => {
    clearStoredToken();
    setToken(null);
    setUser(null);
  }, []);

  const applyAuthResponse = useCallback((response: AuthResponse) => {
    setStoredToken(response.token);
    setToken(response.token);
    setUser(response.user);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!token) {
      setUser(null);
      return;
    }

    const response = await apiFetch<MeResponse>('/auth/me');
    setUser(response.user);
  }, [token]);

  useEffect(() => {
    let isMounted = true;

    async function bootstrapSession(): Promise<void> {
      setIsBootstrapping(true);

      if (!token) {
        if (isMounted) {
          setUser(null);
          setIsBootstrapping(false);
        }
        return;
      }

      try {
        const response = await apiFetch<MeResponse>('/auth/me');
        if (isMounted) {
          setUser(response.user);
        }
      } catch {
        if (isMounted) {
          logout();
        }
      } finally {
        if (isMounted) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrapSession();

    return () => {
      isMounted = false;
    };
  }, [logout, token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token && user),
      isBootstrapping,
      async login(credentials: LoginRequest) {
        const response = await apiFetch<AuthResponse>('/auth/login', {
          method: 'POST',
          body: JSON.stringify(credentials)
        });

        applyAuthResponse(response);
      },
      async register(payload: RegisterRequest) {
        const response = await apiFetch<AuthResponse>('/auth/register', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        applyAuthResponse(response);
      },
      logout,
      refreshSession
    }),
    [applyAuthResponse, isBootstrapping, logout, refreshSession, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
