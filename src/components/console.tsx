"use client";

import { apiUrl } from "@/lib/apiBase";
import { useCallback, useEffect, useRef, useState } from "react";

interface Bubble {
  role: "user" | "jarvis";
  text: string;
  tools?: { name: string; ok: boolean }[];
  failovers?: string[];
}

const BOOT_LINES = [
  "IMT GENERAL SYSTEM — COMMAND CORE v2.0",
  "Neural bus ............................ OK",
  "Operational memory (SQLite+FTS) ....... OK",
  "CRM / LEDGER / REVENUE modules ........ OK",
  "Outreach engine · approval gates ...... OK",
  "Scanning MCP tool relays ..............",
  "J.A.R.V.I.S. online. All systems at your command, sir.",
];

interface ChatMsg { role: "user" | "model"; text: string }

export function useJarvisChat() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<ChatMsg[]>([]);

  const send = useCallback(async (message: string, onDone?: () => void) => {
    const text = message.trim();
    if (!text || busy) return;
    setBubbles((b) => [...b, { role: "user", text }, { role: "jarvis", text: "" }]);
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyRef.current.slice(-30) }),
      });
      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader!.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const ev = JSON.parse(line.slice(5).trim()) as {
            type: string; delta?: string; name?: string; ok?: boolean; text?: string; message?: string; from?: string; to?: string;
          };
          if (ev.type === "text" && ev.delta) {
            setBubbles((b) => {
              const c = [...b];
              c[c.length - 1] = { ...c[c.length - 1], text: c[c.length - 1].text + ev.delta };
              return c;
            });
          } else if (ev.type === "tool_start" && ev.name) {
            setBubbles((b) => {
              const c = [...b];
              const last = c[c.length - 1];
              c[c.length - 1] = { ...last, tools: [...(last.tools ?? []), { name: ev.name!, ok: true }] };
              return c;
            });
          } else if (ev.type === "tool_end" && ev.name) {
            setBubbles((b) => {
              const c = [...b];
              const last = c[c.length - 1];
              const tools = (last.tools ?? []).map((t, i) =>
                i === (last.tools ?? []).length - 1 ? { name: t.name, ok: ev.ok !== false } : t
              );
              c[c.length - 1] = { ...last, tools };
              return c;
            });
          } else if (ev.type === "reset") {
            // Brain failed over after narrating garbage — wipe the partial text, keep tools/failover notes.
            setBubbles((b) => {
              const c = [...b];
              c[c.length - 1] = { ...c[c.length - 1], text: "" };
              return c;
            });
          } else if (ev.type === "failover" && ev.from && ev.to) {
            setBubbles((b) => {
              const c = [...b];
              const last = c[c.length - 1];
              c[c.length - 1] = { ...last, failovers: [...(last.failovers ?? []), `${ev.from} → ${ev.to}`] };
              return c;
            });
          } else if (ev.type === "error") {
            setBubbles((b) => {
              const c = [...b];
              c[c.length - 1] = { ...c[c.length - 1], text: c[c.length - 1].text + `\n[ERROR] ${ev.message}` };
              return c;
            });
          } else if (ev.type === "done" && ev.text) {
            historyRef.current = [...historyRef.current, { role: "user" as const, text }, { role: "model" as const, text: ev.text }].slice(-40);
          }
        }
      }
    } catch {
      setBubbles((b) => {
        const c = [...b];
        c[c.length - 1] = { ...c[c.length - 1], text: "[CONNECTION LOST]" };
        return c;
      });
    } finally {
      setBusy(false);
      onDone?.();
    }
  }, [busy]);

  return { bubbles, busy, send, setBubbles };
}

export function ConsoleDrawer({ open, onClose, chat, voiceOn, setVoiceOn, listening, toggleMic, input, setInput }: {
  open: boolean;
  onClose: () => void;
  chat: ReturnType<typeof useJarvisChat>;
  voiceOn: boolean;
  setVoiceOn: (v: boolean) => void;
  listening: boolean;
  toggleMic: () => void;
  input: string;
  setInput: (v: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.bubbles]);

  if (!open) return null;
  return (
    <aside className="console-drawer">
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="panel-title"><span>J.A.R.V.I.S. CONSOLE</span></div>
        <div className="flex items-center gap-1">
          <button className="btn" onClick={toggleMic} title="Voice input">{listening ? "◉ REC" : "🎙 MIC"}</button>
          <button className="btn" onClick={() => setVoiceOn(!voiceOn)} title="Toggle voice replies">{voiceOn ? "🔊 ON" : "🔈 OFF"}</button>
          <button className="btn" onClick={onClose}>ESC</button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto hud-scroll px-4 py-3 space-y-3">
        {chat.bubbles.length === 0 && (
          <p className="mono text-[11px]" style={{ color: "var(--ink-faint)" }}>
            {`> `}All systems nominal. Awaiting your directive, sir.
          </p>
        )}
        {chat.bubbles.map((b, i) => (
          <div key={i} className={b.role === "user" ? "text-right" : ""}>
            <div
              className={
                b.role === "user"
                  ? "inline-block max-w-[88%] rounded-md px-3 py-2 text-left text-[13px]"
                  : "inline-block max-w-[88%] rounded-md border px-3 py-2 text-left text-[13px] whitespace-pre-wrap"
              }
              style={b.role === "user"
                ? { background: "rgba(34,211,238,0.08)" }
                : { borderColor: "var(--line-bright)", background: "var(--bg-panel)" }}
            >
              {b.role === "jarvis" && <span className="k block mb-1" style={{ color: "var(--accent-dim)" }}>JARVIS</span>}
              {b.text || (chat.busy && i === chat.bubbles.length - 1 ? <span className="animate-pulse">▌</span> : "")}
              {b.failovers && b.failovers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {b.failovers.map((f, j) => (
                    <span key={j} className="badge" style={{ color: "var(--gold)" }} title="Brain switched mid-turn — chain kept the answer alive">◈ BRAIN {f}</span>
                  ))}
                </div>
              )}
              {b.tools && b.tools.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {b.tools.map((t, j) => (
                    <span key={j} className={`badge ${t.ok ? "badge-good" : "badge-bad"}`}>⚡ {t.name}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <form
        className="flex gap-2 p-3 border-t"
        style={{ borderColor: "var(--line)" }}
        onSubmit={(e) => {
          e.preventDefault();
          chat.send(input);
          setInput("");
        }}
      >
        <input
          className="input flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening…" : "Directive, sir?"}
        />
        <button className="btn" type="submit" disabled={chat.busy}>{chat.busy ? "···" : "SEND"}</button>
      </form>
    </aside>
  );
}

export function useVoice(chat: ReturnType<typeof useJarvisChat>) {
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [speakState, setSpeakState] = useState<"idle" | "speaking">("idle");
  const recogRef = useRef<{ stop: () => void } | null>(null);
  const speakRef = useRef<(t: string) => void>(() => {});
  const lastSpokenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const queueRef = useRef<string[]>([]);
  const pumpingRef = useRef(false);

  const stopSpeaking = useCallback(() => {
    queueRef.current = [];
    pumpingRef.current = false;
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setSpeakState("idle");
  }, []);

  // J.A.R.V.I.S. voice — free neural TTS (en-GB-RyanNeural via /api/voice) with a
  // persistent sentence queue: chunks are enqueued as the reply streams in and played
  // back-to-back, so he TALKS WHILE TYPING instead of waiting for the full reply.
  // Browser TTS remains the automatic fallback per chunk.
  useEffect(() => {
    const browserFallback = (t: string): void => {
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(t.slice(0, 500));
      u.rate = 1.02;
      u.pitch = 0.85;
      const preferred = window.speechSynthesis.getVoices().find((v) => /daniel|uk english male/i.test(v.name));
      if (preferred) u.voice = preferred;
      u.onstart = () => setSpeakState("speaking");
      window.speechSynthesis.speak(u);
    };
    const pump = (): void => {
      const chunk = queueRef.current.shift();
      if (chunk === undefined) {
        pumpingRef.current = false;
        setSpeakState("idle");
        return;
      }
      void (async () => {
        try {
          const res = await fetch(apiUrl("/api/voice"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: chunk }),
          });
          if (!res.ok) throw new Error(`voice ${res.status}`);
          const url = URL.createObjectURL(await res.blob());
          const audio = audioRef.current ?? new Audio();
          audioRef.current = audio;
          audio.src = url;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            pump();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            browserFallback(chunk);
            pump();
          };
          setSpeakState("speaking");
          await audio.play();
        } catch {
          browserFallback(chunk);
          pump();
        }
      })();
    };
    speakRef.current = (text: string) => {
      if (!voiceOn || typeof window === "undefined") return;
      const clean = text.replace(/[*_#`>]/g, " ").trim();
      if (!clean) return;
      queueRef.current.push(clean.slice(0, 2000));
      if (!pumpingRef.current) {
        pumpingRef.current = true;
        pump();
      }
    };
  }, [voiceOn]);

  // toggling voice off kills any speech in progress
  useEffect(() => {
    if (!voiceOn) stopSpeaking();
  }, [voiceOn, stopSpeaking]);

  // speak jarvis replies WHILE they stream: enqueue each completed sentence as it
  // arrives; when the stream ends, flush any remaining tail.
  const spokenLenRef = useRef(0);
  const lastReply = [...chat.bubbles].reverse().find((b) => b.role === "jarvis" && b.text.length > 0);
  useEffect(() => {
    if (!lastReply) return;
    const text = lastReply.text;
    if (chat.busy) {
      if (voiceOn && text.length - spokenLenRef.current >= 80) {
        const punct = Math.max(
          text.lastIndexOf(". ", spokenLenRef.current + 40),
          text.lastIndexOf("! ", spokenLenRef.current + 40),
          text.lastIndexOf("? ", spokenLenRef.current + 40),
          text.lastIndexOf("\n", spokenLenRef.current + 40)
        );
        if (punct > spokenLenRef.current) {
          speakRef.current(text.slice(spokenLenRef.current, punct + 1));
          spokenLenRef.current = punct + 1;
        }
      }
    } else if (text.length > spokenLenRef.current) {
      const tail = text.slice(spokenLenRef.current);
      spokenLenRef.current = text.length;
      if (tail.trim()) speakRef.current(tail);
    }
    if (!chat.busy) lastSpokenRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReply?.text, chat.busy]);

  // a new user message resets the spoken-cursor for the fresh reply bubble
  const bubbleCount = chat.bubbles.length;
  useEffect(() => {
    spokenLenRef.current = 0;
  }, [bubbleCount]);

  const toggleMic = useCallback(() => {
    const w = window as unknown as {
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      SpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e: SpeechResultLike) => {
      setListening(false);
      void chat.send(e.results[0][0].transcript);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
    r.start();
    setListening(true);
  }, [listening, chat]);

  return { listening, toggleMic, voiceOn, setVoiceOn, speakState };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechResultLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
interface SpeechResultLike {
  results: { [k: number]: { [k: number]: { transcript: string } } };
}

export function BootOverlay({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setLines(BOOT_LINES.slice(0, i));
      if (i >= BOOT_LINES.length) {
        clearInterval(t);
        setTimeout(() => doneRef.current(), 700);
      }
    }, 200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="fixed inset-0 z-[80] hud-root flex items-center justify-center">
      <div className="w-[600px] max-w-[92vw]">
        <div className="flex justify-center mb-6">
          <Reactor state="boot" size={110} />
        </div>
        <div className="mono text-[12px]" style={{ color: "var(--accent)" }}>
          {lines.map((l, i) => (
            <p key={i} className={`boot-line ${i === BOOT_LINES.length - 1 ? "mt-3 glow" : ""}`}>{l}</p>
          ))}
          <span className="animate-pulse">▌</span>
        </div>
      </div>
    </div>
  );
}

export function Reactor({ state, size = 150, progress }: { state: "idle" | "listening" | "working" | "speaking" | "boot"; size?: number; progress?: number }) {
  const colors: Record<string, string> = {
    idle: "var(--accent)", listening: "var(--bad)", working: "var(--warn)",
    speaking: "var(--good)", boot: "var(--accent)",
  };
  const c = colors[state];
  const labels: Record<string, string> = {
    idle: "STANDBY", listening: "LISTENING", working: "PROCESSING", speaking: "SPEAKING", boot: "BOOT",
  };
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full border-2 border-dashed opacity-60"
        style={{ borderColor: c, animation: "spin-slow 16s linear infinite" }} />
      <div className="absolute inset-[12%] rounded-full border border-dotted opacity-40"
        style={{ borderColor: c, animation: "spin-rev 10s linear infinite" }} />
      {typeof progress === "number" && (
        <svg className="absolute inset-0" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="46" fill="none" stroke="var(--line)" strokeWidth="2.5" />
          <circle cx="50" cy="50" r="46" fill="none" stroke="var(--gold)" strokeWidth="2.5"
            strokeDasharray={`${(progress / 100) * 289} 289`} strokeLinecap="round"
            transform="rotate(-90 50 50)" style={{ filter: "drop-shadow(0 0 4px var(--gold))" }} />
        </svg>
      )}
      <div className="absolute inset-[30%] rounded-full blur-md opacity-25" style={{ background: c }} />
      <span className="k relative z-10 glow" style={{ fontSize: 9, color: c }}>{labels[state]}</span>
    </div>
  );
}
