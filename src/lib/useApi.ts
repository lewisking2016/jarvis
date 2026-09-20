"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Typed fetch that never throws raw network noise — surfaces API error bodies as
 * Error messages. Used directly for mutations and under the useApi hook for reads.
 */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response — body stays null */
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return (body ?? {}) as T;
}

export interface UseApiOptions {
  /** Re-fetch every N ms (0 = fetch once on mount / URL change). */
  intervalMs?: number;
}

export interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Shared typed data hook for every module page: loading + error states, safe JSON
 * parsing, stale-response guarding and optional polling. A malformed or failed
 * payload surfaces as `error` — it can never throw during render.
 */
export function useApi<T>(url: string | null, opts: UseApiOptions = {}): UseApiResult<T> {
  const { intervalMs = 0 } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(url !== null);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const alive = useRef(true);

  const reload = useCallback((): void => setNonce((n) => n + 1), []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const mySeq = ++seq.current;
    setLoading(true);
    apiFetch<T>(url)
      .then((d) => {
        if (!alive.current || mySeq !== seq.current) return;
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive.current || mySeq !== seq.current) return;
        setError(e instanceof Error ? e.message : "Network error");
        setLoading(false);
      });
  }, [url, nonce]);

  useEffect(() => {
    if (!intervalMs || !url) return;
    const t = setInterval(() => setNonce((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, url]);

  return { data, error, loading, reload };
}
