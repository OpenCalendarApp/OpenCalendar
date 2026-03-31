import { getStoredToken } from '../auth/storage.js';

interface ApiError {
  error: string;
  details?: unknown;
}

interface ApiFetchOptions extends RequestInit {
  includeAuth?: boolean;
}

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

function getBearerToken(): string | null {
  const token = getStoredToken()?.trim();

  if (!token || token === 'null' || token === 'undefined') {
    return null;
  }

  return token;
}

export async function apiFetch<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const { includeAuth = true, ...requestInit } = init ?? {};
  const token = includeAuth ? getBearerToken() : null;
  const headers = new Headers(requestInit.headers);

  if (requestInit.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(buildApiUrl(path), {
    ...requestInit,
    headers
  });

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? ((await response.json()) as T | ApiError)
    : ((await response.text()) as unknown as T);

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String(payload.error)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function apiPublicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(path, { ...init, includeAuth: false });
}
