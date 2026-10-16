export class ApiError extends Error {
  code: string;
  requestId: string;
  status: number;

  constructor(status: number, code: string, message: string, requestId: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

interface ApiOptions extends RequestInit {
  accessToken?: string | null;
  _retryCount?: number;
}

/**
 * Every API route returns either the payload or {error:{code,message,request_id}}.
 * Includes automatic 401 retry with silent token refresh to prevent session timeouts.
 */
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { accessToken, headers, _retryCount = 0, ...rest } = options;

  const res = await fetch(`/api/v1${path}`, {
    ...rest,
    credentials: "include", // send the httpOnly refresh cookie
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  // Auto-refresh token on 401 unauthorized (except on auth endpoints themselves)
  if (res.status === 401 && _retryCount === 0 && !path.startsWith("/auth/")) {
    try {
      const refreshRes = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        const newAccessToken = refreshData.access_token;
        if (newAccessToken) {
          return apiFetch<T>(path, {
            ...options,
            accessToken: newAccessToken,
            _retryCount: _retryCount + 1,
          });
        }
      }
    } catch {
      // Fall through to error handling below
    }
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = body?.error ?? { code: "unknown_error", message: "Request failed", request_id: "-" };
    throw new ApiError(res.status, err.code, err.message, err.request_id);
  }

  return body as T;
}
