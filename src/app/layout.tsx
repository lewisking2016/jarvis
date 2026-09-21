"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import "./globals.css";
import { BootOverlay, ConsoleDrawer, Reactor, useJarvisChat, useVoice } from "@/components/console";
import { ErrorBoundary } from "@/components/error-boundary";

const NAV = [
  { href: "/", label: "Command Deck", icon: "◎" },
  { href: "/crm", label: "CRM / Pipeline", icon: "◇" },
  { href: "/money", label: "Money Desk", icon: "₭" },
  { href: "/documents", label: "Paper Desk", icon: "▤" },
  { href: "/revenue", label: "Revenue Mission", icon: "▲" },
  { href: "/outreach", label: "Outbound", icon: "➤" },
  { href: "/memory", label: "Memory Core", icon: "◈" },
  { href: "/fleet", label: "Fleet & MCP", icon: "⬡" },
{ href: "/connections", label: "Connections", icon: "⊕" },
  { href: "/approvals", label: "Approvals", icon: "✓" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [booted, setBooted] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [input, setInput] = useState("");
  const [clock, setClock] = useState("");
  const pathname = usePathname();
  const chat = useJarvisChat();
  const voice = useVoice(chat);

  useEffect(() => {
    const t = setInterval(
      () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })),
      1000
    );
    return () => clearInterval(t);
  }, []);

  // global console shortcut: Ctrl/Cmd+K
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setConsoleOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const state = voice.listening ? "listening" : chat.busy ? "working" : voice.speakState === "speaking" ? "speaking" : "idle";

  return (
    <html lang="en">
      <body className="antialiased">
        {!booted && <BootOverlay onDone={() => setBooted(true)} />}
        <div className="hud-root min-h-screen flex" style={{ opacity: booted ? 1 : 0, transition: "opacity 400ms" }}>
          {/* sidebar */}
          <nav className="w-[210px] shrink-0 border-r flex flex-col py-4 px-3 gap-1 sticky top-0 h-screen" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-center gap-3 px-2 pb-4 mb-2 border-b" style={{ borderColor: "var(--line)" }}>
              <div className="w-9 h-9 rounded flex items-center justify-center shrink-0" style={{ background: "#f5f5f5" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/imtblack.png" alt="IMT logo" className="w-7 h-7 object-contain" />
              </div>
              <Reactor state={state} size={44} />
              <div>
                <p className="mono text-[11px] tracking-[0.25em] text-cyan-300 glow">JARVIS</p>
                <p className="k">IMT General System</p>
              </div>
            </div>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`nav-item ${pathname === n.href ? "active" : ""}`}>
                <span className="w-4 text-center">{n.icon}</span>
                {n.label}
              </Link>
            ))}
            <div className="mt-auto px-2">
              <p className="k mb-2">Console</p>
              <button className="btn w-full" onClick={() => setConsoleOpen(true)}>⌘K TALK TO JARVIS</button>
            </div>
          </nav>

          {/* main column */}
          <div className="flex-1 flex flex-col min-w-0">
            <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-3 border-b backdrop-blur"
              style={{ borderColor: "var(--line)", background: "rgba(5,10,18,0.8)" }}>
              <p className="k">{pathname === "/" ? "Command Deck" : NAV.find((n) => n.href === pathname)?.label ?? "Module"}</p>
              <div className="flex items-center gap-4">
                <span className="k hidden md:inline">info@imeantech.com</span>
                <span className="num text-xs" style={{ color: "var(--accent)" }}>{clock}</span>
                <button className="btn" onClick={() => setConsoleOpen(true)}>CONSOLE ⌘K</button>
              </div>
            </header>
            <main className="flex-1 px-6 py-5">
              <ErrorBoundary label={NAV.find((n) => n.href === pathname)?.label ?? "Module"}>{children}</ErrorBoundary>
            </main>
            <footer className="px-6 py-3 border-t" style={{ borderColor: "var(--line)" }}>
              <p className="k">“Sometimes you gotta run before you can walk.” — IMT General System, command core v2.0</p>
            </footer>
          </div>

          <ConsoleDrawer
            open={consoleOpen}
            onClose={() => setConsoleOpen(false)}
            chat={chat}
            voiceOn={voice.voiceOn}
            setVoiceOn={voice.setVoiceOn}
            listening={voice.listening}
            toggleMic={voice.toggleMic}
            input={input}
            setInput={setInput}
            registerComposer={voice.registerComposer}
          />
        </div>
      </body>
    </html>
  );
}
