// Tiny structured logger for frontend code (server + client).
// On Node (SSR), uses ANSI escapes around `<emoji> [scope]`. On browser, uses
// `%c` CSS so the segment shows up colored in DevTools.

const isServer = typeof window === "undefined";
const useAnsi = isServer && !process.env.NO_COLOR;

const ANSI = {
  reset: useAnsi ? "\x1b[0m" : "",
  green: useAnsi ? "\x1b[32m" : "",
  yellow: useAnsi ? "\x1b[33m" : "",
  red: useAnsi ? "\x1b[31m" : "",
  blue: useAnsi ? "\x1b[34m" : "",
  cyan: useAnsi ? "\x1b[36m" : "",
  magenta: useAnsi ? "\x1b[35m" : "",
  gray: useAnsi ? "\x1b[90m" : "",
};

const CSS = {
  green: "color: #16a34a; font-weight: 600",
  yellow: "color: #ca8a04; font-weight: 600",
  red: "color: #dc2626; font-weight: 600",
  blue: "color: #2563eb; font-weight: 600",
  cyan: "color: #0891b2; font-weight: 600",
  magenta: "color: #9333ea; font-weight: 600",
  gray: "color: #64748b; font-weight: 600",
};

const RESET_CSS = "color: inherit; font-weight: normal";

export type Logger = {
  start: (msg: string, ...rest: unknown[]) => void;
  step: (msg: string, ...rest: unknown[]) => void;
  deploy: (msg: string, ...rest: unknown[]) => void;
  sign: (msg: string, ...rest: unknown[]) => void;
  tx: (msg: string, ...rest: unknown[]) => void;
  ok: (msg: string, ...rest: unknown[]) => void;
  warn: (msg: string, ...rest: unknown[]) => void;
  error: (msg: string, err?: unknown) => void;
  info: (msg: string, ...rest: unknown[]) => void;
  hint: (msg: string, ...rest: unknown[]) => void;
  seed: (msg: string, ...rest: unknown[]) => void;
  reset: (msg: string, ...rest: unknown[]) => void;
};

export function makeLogger(scope: string): Logger {
  const fmt = (
    emoji: string,
    ansi: string,
    css: string,
    msg: string,
  ): unknown[] => {
    if (isServer) {
      return [
        `${ansi}${emoji}${ANSI.reset} ${ANSI.gray}[${scope}]${ANSI.reset}   ${msg}`,
      ];
    }
    return [`%c${emoji} [${scope}]%c   ${msg}`, css, RESET_CSS];
  };

  const make =
    (emoji: string, ansi: string, css: string, fn: typeof console.log) =>
    (msg: string, ...rest: unknown[]) =>
      fn(...fmt(emoji, ansi, css, msg), ...rest);

  return {
    start: make("🚀", ANSI.green, CSS.green, console.log),
    step: make("⚙️", ANSI.cyan, CSS.cyan, console.log),
    deploy: make("📦", ANSI.blue, CSS.blue, console.log),
    sign: make("🔐", ANSI.cyan, CSS.cyan, console.log),
    tx: make("📡", ANSI.cyan, CSS.cyan, console.log),
    ok: make("✅", ANSI.green, CSS.green, console.log),
    warn: make("⚠️", ANSI.yellow, CSS.yellow, console.warn),
    error: (msg: string, err?: unknown) => {
      const args = fmt("❌", ANSI.red, CSS.red, msg);
      if (err !== undefined) {
        console.error(...args, err);
      } else {
        console.error(...args);
      }
    },
    info: make("📊", ANSI.gray, CSS.gray, console.log),
    hint: make("💡", ANSI.magenta, CSS.magenta, console.log),
    seed: make("🌱", ANSI.green, CSS.green, console.log),
    reset: make("🧹", ANSI.gray, CSS.gray, console.log),
  };
}
