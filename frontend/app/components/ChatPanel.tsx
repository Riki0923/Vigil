"use client";

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
  const transport = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      body: { alertId: alert.id },
    }),
  ).current;

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
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="close-backdrop"
      />
      <aside className="flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl sm:max-w-lg">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${severityClasses(
                  alert.severity,
                )}`}
              >
                {alert.severity}
              </span>
              <span className="truncate font-mono text-xs text-zinc-400">
                proxy {truncateAddress(alert.proxyAddress)}
              </span>
            </div>
            <p className="mt-1.5 truncate text-sm text-zinc-300">{alert.message}</p>
          </div>
          <button
            onClick={onClose}
            className="-m-1 shrink-0 rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
            aria-label="close-chat"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-zinc-400">
                Ask anything about this upgrade. The agent has the full alert context.
              </p>
              <div className="flex flex-col gap-2">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => handleSend(p)}
                    disabled={isStreaming}
                    className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-left text-sm text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-50"
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
                <li className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
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
          className="border-t border-zinc-800 bg-zinc-950 px-5 py-4"
        >
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isStreaming}
              placeholder="Ask about this upgrade…"
              className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-700 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
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
            ? "bg-zinc-100 text-zinc-950"
            : "border border-zinc-800 bg-zinc-900/60 text-zinc-200"
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
