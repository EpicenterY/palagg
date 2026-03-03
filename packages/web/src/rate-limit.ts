const STORAGE_KEY = "palagg-download-timestamps";
export const DOWNLOAD_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function loadTimestamps(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

function saveTimestamps(ts: number[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ts));
}

/** Return timestamps within the 1-hour window, pruning expired ones. */
export function getActiveDownloads(): number[] {
  const now = Date.now();
  const active = loadTimestamps().filter((t) => now - t < WINDOW_MS);
  saveTimestamps(active);
  return active;
}

/** Record a download. Returns false if quota is already exhausted. */
export function recordDownload(): boolean {
  const active = getActiveDownloads();
  if (active.length >= DOWNLOAD_LIMIT) return false;
  active.push(Date.now());
  saveTimestamps(active);
  return true;
}

/** Remaining downloads available (0–DOWNLOAD_LIMIT). */
export function remainingQuota(): number {
  return Math.max(0, DOWNLOAD_LIMIT - getActiveDownloads().length);
}

/** Milliseconds until the next slot opens. 0 if quota is available. */
export function msUntilNextSlot(): number {
  const active = getActiveDownloads();
  if (active.length < DOWNLOAD_LIMIT) return 0;
  const oldest = Math.min(...active);
  return Math.max(0, oldest + WINDOW_MS - Date.now());
}

/** Clear all recorded timestamps. */
export function resetQuota(): void {
  saveTimestamps([]);
}
