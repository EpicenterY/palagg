import type { EmojiPreset } from "./model/emoji";

const API_BASE = "https://api.iconify.design";

interface IconifySearchResult {
  icons: string[]; // e.g. ["material-symbols:star", ...]
  total: number;
}

interface IconifyIconData {
  body: string;
  width?: number;
  height?: number;
}

interface IconifyIconsResponse {
  prefix: string;
  icons: Record<string, IconifyIconData>;
  width?: number;
  height?: number;
}

export async function searchIcons(
  query: string,
  limit = 48,
): Promise<{ icons: string[] }> {
  const url = `${API_BASE}/search?query=${encodeURIComponent(query)}&prefix=material-symbols&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Iconify search failed: ${res.status}`);
  const data: IconifySearchResult = await res.json();
  return { icons: data.icons };
}

export async function fetchIconData(
  prefix: string,
  names: string[],
): Promise<IconifyIconsResponse> {
  const url = `${API_BASE}/${prefix}.json?icons=${names.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Iconify fetch failed: ${res.status}`);
  return res.json();
}

/** Extract all <path> d attributes from an SVG body string and join them */
export function extractSvgPaths(body: string): string {
  const paths: string[] = [];
  const re = /<path[^>]*\bd="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    paths.push(m[1]);
  }
  return paths.join(" ");
}

/** Detect fill-rule from SVG body */
export function detectFillRule(body: string): "EvenOdd" | "NonZero" {
  return /fill-rule\s*=\s*"evenodd"/i.test(body) ? "EvenOdd" : "NonZero";
}

/** Convert an Iconify icon to an EmojiPreset */
export function iconifyToPreset(
  fullName: string,
  label: string,
  body: string,
  defaultW: number,
  defaultH: number,
  iconW?: number,
  iconH?: number,
): EmojiPreset {
  const w = iconW ?? defaultW;
  const h = iconH ?? defaultH;
  return {
    id: `iconify:${fullName}`,
    label,
    svg: extractSvgPaths(body),
    viewBox: [0, 0, w, h],
    fillRule: detectFillRule(body),
  };
}
