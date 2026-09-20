"use client";

import React from "react";

interface Props {
  label?: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Crash isolation: if anything inside throws during render, the failed subtree is
 * replaced by a retry card instead of unmounting the whole module page. Retrying
 * remounts the subtree, which re-runs its data fetching.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error(`[boundary${this.props.label ? `:${this.props.label}` : ""}]`, error);
  }

  private reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="panel corner !p-4" style={{ borderColor: "var(--bad)" }}>
        <p className="k mb-1" style={{ color: "var(--bad)" }}>
          ⚠ {this.props.label ?? "Panel"} hit a fault
        </p>
        <p className="mono text-[11px] mb-3" style={{ color: "var(--ink-dim)" }}>
          {error.message}
        </p>
        <button className="btn" onClick={this.reset}>
          RETRY
        </button>
      </div>
    );
  }
}
