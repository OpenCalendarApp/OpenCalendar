import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type {
  AuthResponse,
  LoginRequest,
  LogoutRequest,
  MeResponse,
  RefreshTokenRequest,
  RegisterRequest,
  User
} from '@opencalendar/shared';

import { apiFetch } from '../api/client.js';
import {
  clearStoredRefreshToken,
  clearStoredToken,
  getStoredRefreshToken,
  getStoredToken,
  setStoredRefreshToken,
  setStoredToken
} from '../auth/storage.js';

interface AuthContextValue {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  completeSsoLogin: (tokens: { token: string; refresh_token: string }) => Promise<void>;
  register: (payload: RegisterRequest) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<User | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const clearAuthState = useCallback(() => {
    clearStoredToken();
    clearStoredRefreshToken();
    setToken(null);
    setUser(null);
  }, []);

  const logout = useCallback(() => {
    const refreshToken = getStoredRefreshToken();
    if (token) {
      const payload: LogoutRequest = refreshToken ? { refresh_token: refreshToken } : {};
      void apiFetch<unknown>('/auth/logout', {
        method: 'POST',
        body: JSON.stringify(payload)
      }).catch(() => undefined);
    }

    clearAuthState();
  }, [clearAuthState, token]);

  const applyAuthResponse = useCallback((response: AuthResponse) => {
    setStoredToken(response.token);
    setStoredRefreshToken(response.refresh_token);
    setToken(response.token);
    setUser(response.user);
  }, []);

  const refreshWithStoredToken = useCallback(async (): Promise<boolean> => {
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) {
      return false;
    }

    try {
      const payload: RefreshTokenRequest = { refresh_token: refreshToken };
      const response = await apiFetch<AuthResponse>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      applyAuthResponse(response);
      return true;
    } catch {
      clearAuthState();
      return false;
    }
  }, [applyAuthResponse, clearAuthState]);

  const refreshSession = useCallback(async () => {
    if (!token && !(await refreshWithStoredToken())) {
      setUser(null);
      return;
    }

    try {
      const response = await apiFetch<MeResponse>('/auth/me');
      setUser(response.user);
      return;
    } catch {
      if (!(await refreshWithStoredToken())) {
        clearAuthState();
        return;
      }
    }

    const retriedResponse = await apiFetch<MeResponse>('/auth/me');
    setUser(retriedResponse.user);
  }, [clearAuthState, refreshWithStoredToken, token]);

  useEffect(() => {
    let isMounted = true;

    async function bootstrapSession(): Promise<void> {
      setIsBootstrapping(true);

      if (!token && !getStoredRefreshToken()) {
        if (isMounted) {
          setUser(null);
          setIsBootstrapping(false);
        }
        return;
      }

      try {
        await refreshSession();
      } catch {
        if (isMounted) {
          clearAuthState();
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
  }, [clearAuthState, refreshSession, token]);

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
      async completeSsoLogin(tokens: { token: string; refresh_token: string }) {
        setStoredToken(tokens.token);
        setStoredRefreshToken(tokens.refresh_token);
        setToken(tokens.token);

        try {
          const response = await apiFetch<MeResponse>('/auth/me');
          setUser(response.user);
        } catch {
          clearAuthState();
          throw new Error('Unable to complete SSO login');
        }
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
    [applyAuthResponse, clearAuthState, isBootstrapping, logout, refreshSession, token, user]
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
