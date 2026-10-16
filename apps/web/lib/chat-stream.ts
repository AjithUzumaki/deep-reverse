export interface ChatStreamHandlers {
  onStatus?: (data: { state: string; conversation_id?: string }) => void;
  onDelta?: (text: string) => void;
  onDone?: (data: { message_id: string; usage: unknown }) => void;
  onError?: (data: { code?: string; message?: string }) => void;
}

export interface ChatAttachmentPayload {
  name: string;
  mime_type: string;
  data_base64: string;
}

interface ChatStreamBody {
  conversation_id?: string;
  message: string;
  system_override?: string;
  audio_base64?: string;
  audio_mime_type?: string;
  attachments?: ChatAttachmentPayload[];
  website_builder?: boolean;
  previous_code?: string;
}

/**
 * Streams chat responses from DEEP REVERSE API over Server-Sent Events (SSE).
 * Handles token refresh automatically on 401 to ensure unlimited, uninterrupted chats.
 */
export async function streamChat(
  body: ChatStreamBody,
  accessToken: string,
  handlers: ChatStreamHandlers,
  retryCount: number = 0,
): Promise<void> {
  const res = await fetch("/api/v1/chat", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  // If 401 and not retried yet, silently refresh token and retry
  if (res.status === 401 && retryCount === 0) {
    try {
      const refreshRes = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        if (refreshData.access_token) {
          return streamChat(body, refreshData.access_token, handlers, retryCount + 1);
        }
      }
    } catch {
      // Continue to error handler
    }
  }

  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => null);
    handlers.onError?.(errBody?.error ?? { message: errBody?.detail ?? "Request failed. Please try again." });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      dispatchEvent(rawEvent, handlers);
    }
  }
}

function dispatchEvent(rawEvent: string, handlers: ChatStreamHandlers): void {
  let eventType = "message";
  let dataLine = "";

  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) eventType = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }

  if (!dataLine) return;

  let parsed: any;
  try {
    parsed = JSON.parse(dataLine);
  } catch {
    return;
  }

  switch (eventType) {
    case "status":
      handlers.onStatus?.(parsed);
      break;
    case "delta":
      handlers.onDelta?.(parsed.text);
      break;
    case "done":
      handlers.onDone?.(parsed);
      break;
    case "error":
      handlers.onError?.(parsed);
      break;
  }
}
