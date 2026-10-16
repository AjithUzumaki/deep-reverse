export interface LocalWorkspaceInfo {
  name: string;
  path: string;
}

export interface LocalWorkspaceConnection {
  connected: boolean;
  token: string | null;
  workspace: LocalWorkspaceInfo | null;
}

export const LOCAL_AGENT_TOKEN_KEY = "deep-reverse-local-agent-token";
export const LOCAL_WORKSPACE_CHAT_DRAFT_KEY = "deep-reverse-workspace-chat-draft";
export const LOCAL_WORKSPACE_COMMAND_KEY = "deep-reverse-workspace-pending-command";
export const LOCAL_AGENT_URL = "http://127.0.0.1:8765/v1";

export async function localAgentFetch<T>(
  route: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${LOCAL_AGENT_URL}${route}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Local workspace request failed (${response.status}).`);
  return body as T;
}

export async function applyWorkspaceFile(token: string, path: string, content: string): Promise<void> {
  await localAgentFetch("/file/write", token, {
    method: "POST",
    body: JSON.stringify({ path, content }),
  });
}
