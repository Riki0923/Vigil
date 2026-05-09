// Tiny structured logger for demo-target hardhat scripts.
// Output format: `<emoji> [scope]   <message>`. The emoji + bracket prefix is
// colored with ANSI escapes; body text stays default. Honors NO_COLOR.

const useColor = !process.env.NO_COLOR;

const C = {
  reset: useColor ? "\x1b[0m" : "",
  green: useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  red: useColor ? "\x1b[31m" : "",
  blue: useColor ? "\x1b[34m" : "",
  cyan: useColor ? "\x1b[36m" : "",
  magenta: useColor ? "\x1b[35m" : "",
  gray: useColor ? "\x1b[90m" : "",
};

export type Logger = {
  start: (msg: string) => void;
  step: (msg: string) => void;
  deploy: (msg: string) => void;
  sign: (msg: string) => void;
  tx: (msg: string) => void;
  ok: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
  info: (msg: string) => void;
  hint: (msg: string) => void;
  seed: (msg: string) => void;
  reset: (msg: string) => void;
  raw: (line: string) => void;
};

export function makeLogger(scope: string): Logger {
  const tag = (emoji: string, color: string) =>
    `${color}${emoji}${C.reset} ${C.gray}[${scope}]${C.reset}`;

  return {
    start: (m) => console.log(`${tag("🚀", C.green)}   ${m}`),
    step: (m) => console.log(`${tag("⚙️", C.cyan)}    ${m}`),
    deploy: (m) => console.log(`${tag("📦", C.blue)}   ${m}`),
    sign: (m) => console.log(`${tag("🔐", C.cyan)}   ${m}`),
    tx: (m) => console.log(`${tag("📡", C.cyan)}   ${m}`),
    ok: (m) => console.log(`${tag("✅", C.green)}   ${m}`),
    warn: (m) => console.warn(`${tag("⚠️", C.yellow)}    ${m}`),
    error: (m, err) =>
      err !== undefined
        ? console.error(`${tag("❌", C.red)}   ${m}`, err)
        : console.error(`${tag("❌", C.red)}   ${m}`),
    info: (m) => console.log(`${tag("📊", C.gray)}   ${m}`),
    hint: (m) => console.log(`${tag("💡", C.magenta)}   ${m}`),
    seed: (m) => console.log(`${tag("🌱", C.green)}   ${m}`),
    reset: (m) => console.log(`${tag("🧹", C.gray)}   ${m}`),
    raw: (line) => console.log(line),
  };
}
