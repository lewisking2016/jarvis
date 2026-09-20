/**
 * SPLIT-ARCHITECTURE API BASE — the frontend runs on Vercel, the brain (API +
 * MCP + OmniRoute) runs on the VPS. Relative "/api/..." paths resolve to the
 * configured backend at runtime; same-origin stays the default in dev and when
 * NEXT_PUBLIC_API_URL is unset.
 *
 * Set NEXT_PUBLIC_API_URL in the Vercel project env, e.g. http://jarvis.imeantech.com
 */
export const API_BASE: string = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return API_BASE + path;
}
