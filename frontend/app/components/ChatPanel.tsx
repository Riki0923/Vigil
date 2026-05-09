"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import type { Alert } from "@/lib/types";
import { severityClasses, truncateAddress } from "@/lib/format";

const SUGGESTED_PROMPTS = [
  "Explain this upgrade in plain English.",
  "What is the worst case if this is exploited?",
  "Which storage slots collide and why does it matter?",
  "Compare this pattern to known historical exploits.",
];

type Props = {
  alert: Alert;
  onClose: () => void;
};

export function ChatPanel({ alert, onClose }: Props) {
  const [input, setInput] = useState("");

  // Lazy useState init keeps a stable transport instance per panel mount.
  // Using useRef(...).current here trips the react-hooks/refs rule (refs
  // can't be read during render) AND constructs a fresh transport on every
  // render even though only the first survives. Lazy useState avoids both.
  // The parent renders <ChatPanel key={alert.id}/> so the panel remounts
  // per alert — alert.id is stable for this instance's lifetime.
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { alertId: alert.id },
      }),
  );

  const { messages, sendMessage, status } = useChat({
    id: alert.id,
    transport,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const isStreaming = status === "submitted" || status === "streaming";

  const handleSend = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  return (
    <div className="fixed inset-0 z-30 flex">
      <div
        className="flex-1 bg-[rgba(26,35,72,0.25)] backdrop-blur-sm"
        onClick={onClose}
        aria-label="close-backdrop"
      />
      <aside className="brand-border flex h-full w-full max-w-md flex-col border-l shadow-2xl sm:max-w-lg surface-1">
        <div className="brand-navy-bg flex items-center justify-between px-5 py-2.5">
          <div className="flex items-center gap-2">
            <div className="brand-cream-bg rounded p-1">
              <Image
                src="/vigil-logo.png"
                alt="Vigil"
                width={48}
                height={48}
                className="h-7 w-7 object-contain"
              />
            </div>
            <span className="font-display text-xs font-medium text-[var(--brand-cream)]">
              AI assistant
            </span>
          </div>
          <button
            onClick={onClose}
            className="-m-1 shrink-0 rounded-md p-1.5 text-[var(--brand-cream)]/70 transition hover:bg-white/10 hover:text-[var(--brand-cream)]"
            aria-label="close-chat"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <header className="brand-border border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${severityClasses(
                alert.severity,
              )}`}
            >
              {alert.severity}
            </span>
            <span className="text-brand-soft truncate font-mono text-xs">
              proxy {truncateAddress(alert.proxyAddress)}
            </span>
          </div>
          <p className="text-brand mt-1.5 truncate text-sm">{alert.message}</p>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-brand-soft text-sm">
                Ask anything about this upgrade. The agent has the full alert context.
              </p>
              <div className="flex flex-col gap-2">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => handleSend(p)}
                    disabled={isStreaming}
                    className="brand-border text-brand rounded-md border bg-white/60 px-3 py-2 text-left text-sm transition hover:border-[var(--brand-navy)]/40 hover:bg-white disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {messages.map((m) => (
                <Message key={m.id} message={m} />
              ))}
              {status === "submitted" && (
                <li className="text-brand-soft flex items-center gap-2 text-xs">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-navy)]" />
                  thinking…
                </li>
              )}
            </ul>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend(input);
          }}
          className="brand-border border-t px-5 py-4 surface-0"
        >
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isStreaming}
              placeholder="Ask about this upgrade…"
              className="input-brand flex-1 rounded-md px-3 py-2 text-sm disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="btn-brand rounded-md px-4 py-2 text-sm"
            >
              Send
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts?: Array<{ type: string; text?: string }>;
};

function Message({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const text = (message.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");

  if (!text) return null;

  return (
    <li className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "brand-navy-bg font-medium"
            : "brand-border border bg-white/80 text-brand"
        }`}
      >
        {text.split("\n").map((line, i) => (
          <p key={i} className={i === 0 ? "" : "mt-1.5"}>
            {line}
          </p>
        ))}
      </div>
    </li>
  );
}
