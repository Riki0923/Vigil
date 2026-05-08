"use client";
import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <button
      onClick={handleCopy}
      className={`ml-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded transition-all duration-150 ${
        copied
          ? "text-green-400 bg-green-950/50"
          : "text-zinc-700 hover:text-zinc-400 hover:bg-zinc-800"
      }`}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? (
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden>
          <path
            d="M1 4.5l2.5 2.5 4.5-4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <rect x="3.5" y="0.5" width="6" height="7" rx="1" stroke="currentColor" strokeWidth="1" />
          <rect x="0.5" y="2.5" width="6" height="7" rx="1" stroke="currentColor" strokeWidth="1" />
        </svg>
      )}
    </button>
  );
}
