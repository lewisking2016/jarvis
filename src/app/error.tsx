"use client";

/**
 * Route-level backstop: if a module page still manages to throw outside every
 * panel boundary, Next.js renders this instead of a blank page.
 */
export default function ModuleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="panel corner !p-6 max-w-xl mx-auto mt-10" style={{ borderColor: "var(--bad)" }}>
      <p className="k mb-2" style={{ color: "var(--bad)" }}>⚠ Module fault</p>
      <p className="mono text-xs mb-4" style={{ color: "var(--ink-dim)" }}>
        {error.message}
        {error.digest ? ` (digest ${error.digest})` : ""}
      </p>
      <button className="btn" onClick={reset}>RETRY MODULE</button>
    </div>
  );
}
