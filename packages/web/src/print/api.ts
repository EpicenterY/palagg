import type { Job, WsMessage } from "@palagg/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export async function submitPrintJob(blob: Blob, filename: string, printerId?: string): Promise<Job> {
  const form = new FormData();
  form.append("file", blob, filename);
  if (printerId) form.append("printer_id", printerId);

  const res = await fetch(`${API_URL}/api/jobs`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.job as Job;
}

export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`${API_URL}/api/jobs/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.job as Job;
}

export function connectJobWs(onMessage: (msg: WsMessage) => void): WebSocket {
  const wsUrl = API_URL.replace(/^http/, "ws") + "/ws/jobs";
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data) as WsMessage;
      onMessage(msg);
    } catch {
      // ignore malformed messages
    }
  });

  ws.addEventListener("close", () => {
    // Reconnect after 3 seconds
    setTimeout(() => {
      connectJobWs(onMessage);
    }, 3000);
  });

  return ws;
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
