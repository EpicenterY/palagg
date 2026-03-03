import type { EmojiPreset } from "./model/emoji";

const STORAGE_KEY = "palagg-custom-icons";

export function loadCustomIcons(): EmojiPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as EmojiPreset[];
  } catch {
    return [];
  }
}

export function saveCustomIcon(preset: EmojiPreset): void {
  const icons = loadCustomIcons();
  if (!icons.find((i) => i.id === preset.id)) {
    icons.push(preset);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(icons));
}

