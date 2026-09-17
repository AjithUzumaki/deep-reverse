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
}

/**
 * Every API route returns either the payload or {error:{code,message,request_id}}.
 * This wrapper is the single place that unwraps that contract — callers
 * never touch fetch() directly, so the error shape can't drift per call site.
 */
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { accessToken, headers, ...rest } = options;

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

  const body = await res.json();

  if (!res.ok) {
    const err = body?.error ?? { code: "unknown_error", message: "Request failed", request_id: "-" };
    throw new ApiError(res.status, err.code, err.message, err.request_id);
  }

  return body as T;
}
