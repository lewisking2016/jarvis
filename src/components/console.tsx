"use client";

import { apiUrl } from "@/lib/apiBase";
import { ThinkingOrb } from "thinking-orbs";
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

  const send = useCallback(async (message: string, onDone?: () => void, attachmentIds: number[] = []) => {
    const text = message.trim();
    if ((!text && !attachmentIds.length) || busy) return;
    const shown = text || "Analyse the attached file(s), sir.";
    setBubbles((b) => [...b, { role: "user", text: shown }, { role: "jarvis", text: "" }]);
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyRef.current.slice(-30), attachment_ids: attachmentIds }),
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
            historyRef.current = [...historyRef.current, { role: "user" as const, text: shown }, { role: "model" as const, text: ev.text }].slice(-40);
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

export function ConsoleDrawer({ open, onClose, chat, voiceOn, setVoiceOn, listening, toggleMic, input, setInput, registerComposer }: {
  open: boolean;
  onClose: () => void;
  chat: ReturnType<typeof useJarvisChat>;
  voiceOn: boolean;
  setVoiceOn: (v: boolean) => void;
  listening: boolean;
  toggleMic: () => void;
  input: string;
  setInput: (v: string) => void;
  registerComposer: (fn: (text: string) => void) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ id: number; name: string; mime: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  // One-breath composing: the mic handler calls this with the transcript so a
  // dictation rides the SAME message as any pending attachments.
  const sendRef = useRef<(text: string) => void>(() => {});
  sendRef.current = (text: string): void => {
    const ids = pending.map((p) => p.id);
    chat.send(text, undefined, ids);
    setInput("");
    setPending([]);
  };
  // mic dictation → this composer (attachments ride the same message)
  useEffect(() => {
    registerComposer((text: string) => sendRef.current(text));
  }, [registerComposer]);
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
              {b.text || (chat.busy && i === chat.bubbles.length - 1 ? (
                <span className="inline-flex items-center gap-2">
                  <ThinkingOrb state="working" size={20} theme="dark" aria-label="JARVIS is thinking" />
                  <span className="k text-[10px]" style={{ color: "var(--ink-faint)" }}>THINKING</span>
                </span>
              ) : "")}
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
        className="flex flex-col gap-2 p-3 border-t"
        style={{ borderColor: "var(--line)" }}
        onSubmit={(e) => {
          e.preventDefault();
          sendRef.current(input);
        }}
      >
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {pending.map((p) => (
              <span key={p.id} className="badge" style={{ borderColor: "var(--line)" }}>
                {p.mime.startsWith("image/") ? "🖼" : "📄"} {p.name.slice(0, 22)}
                <button
                  type="button"
                  className="ml-1 opacity-60 hover:opacity-100"
                  onClick={() => setPending((list) => list.filter((x) => x.id !== p.id))}
                  aria-label={`remove ${p.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="btn shrink-0"
            title="Attach an image or document for JARVIS to work with"
            disabled={uploading || chat.busy}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "···" : "+"}
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,text/markdown,application/json"
            multiple
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (!files.length) return;
              setUploading(true);
              try {
                for (const f of files) {
                  const fd = new FormData();
                  fd.append("file", f);
                  const r = await fetch(apiUrl("/api/attachments"), { method: "POST", body: fd });
                  if (r.ok) {
                    const meta = (await r.json()) as { id: number; name: string; mime: string };
                    setPending((list) => [...list, meta]);
                  }
                }
              } finally {
                setUploading(false);
              }
            }}
          />
          <input
            className="input flex-1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={pending.length ? "Tell JARVIS what to do with the attachment(s)…" : listening ? "Listening…" : "Directive, sir?"}
          />
          <button className="btn" type="submit" disabled={chat.busy || uploading}>{chat.busy ? "···" : "SEND"}</button>
        </div>
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
  /** Registered by the composer: dictation sends THROUGH it so pending
   *  attachments ride the same message (one-breath: attach + talk → send). */
  const composeSendRef = useRef<(text: string) => void>(() => {});
  const registerComposer = useCallback((fn: (text: string) => void): void => {
    composeSendRef.current = fn;
  }, []);

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
  // arrives; when the stream ends, flush any remaining tail. The cursor is keyed to
  // the reply bubble AFTER the latest user message — never the previous turn's
  // reply — so a new send can't replay stale audio or eat the fresh reply.
  const spokenLenRef = useRef(0);
  const spokenForRef = useRef(-1);
  let lastUserIdx = -1;
  for (let i = chat.bubbles.length - 1; i >= 0; i--) {
    if (chat.bubbles[i].role === "user") { lastUserIdx = i; break; }
  }
  const replyIdx = lastUserIdx >= 0 ? chat.bubbles.findIndex((b, i) => i > lastUserIdx && b.role === "jarvis") : -1;
  const reply = replyIdx >= 0 ? chat.bubbles[replyIdx] : undefined;
  useEffect(() => {
    if (replyIdx !== spokenForRef.current) {
      spokenForRef.current = replyIdx;
      spokenLenRef.current = 0;
    }
    if (replyIdx < 0 || !reply?.text) return;
    const text = reply.text;
    const flushTo = (end: number): void => {
      speakRef.current(text.slice(spokenLenRef.current, end));
      spokenLenRef.current = end;
    };
    if (chat.busy) {
      // stream: speak sentence-by-sentence as soon as a full sentence exists
      if (voiceOn && text.length - spokenLenRef.current >= 40) {
        const punct = Math.max(
          text.lastIndexOf(". ", spokenLenRef.current + 20),
          text.lastIndexOf("! ", spokenLenRef.current + 20),
          text.lastIndexOf("? ", spokenLenRef.current + 20),
          text.lastIndexOf("\n", spokenLenRef.current + 20)
        );
        if (punct > spokenLenRef.current) flushTo(punct + 1);
      }
    } else if (text.length > spokenLenRef.current) {
      flushTo(text.length);
    }
    if (!chat.busy) lastSpokenRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply?.text, replyIdx, chat.busy, voiceOn]);



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
      composeSendRef.current(e.results[0][0].transcript);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
    r.start();
    setListening(true);
  }, [listening, chat]);

  return { listening, toggleMic, voiceOn, setVoiceOn, speakState, registerComposer };
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

export function Reactor({ state, size = 64 }: { state: "idle" | "listening" | "working" | "speaking" | "boot"; size?: number; progress?: number }) {
  // thinking-orbs (github.com/Jakubantalik/thinking-orbs) — hand-tuned canvas
  // animations, one verb per agent state. Pinned dark theme (our HUD is dark).
  // Size snaps to the nearest tuned preset: 64 (avatar) or 20 (inline).
  const orbState =
    state === "listening" ? "listening"
    : state === "working" ? "solving"
    : state === "speaking" ? "composing"
    : state === "boot" ? "connecting"
    : "breathing";
  const tuned = size >= 40 ? 64 : 20;
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }} title={`JARVIS ${state.toUpperCase()}`}>
      <ThinkingOrb state={orbState} size={tuned} theme="dark" speed={state === "working" ? 1.4 : 1} paused={false} aria-label={`JARVIS ${state}`} />
    </div>
  );
}
