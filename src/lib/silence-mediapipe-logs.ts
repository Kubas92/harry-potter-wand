// MediaPipe's WASM runtime routes its own stderr through console.error, so
// harmless startup chatter like "INFO: Created TensorFlow Lite XNNPACK
// delegate for CPU." shows up in the Next.js dev overlay as a "Console
// Error" even though nothing is wrong. Drop just those "INFO:" lines; every
// other console.error still goes through untouched. Idempotent — safe to
// call from every page's effect (and twice under Strict Mode).
let installed = false;

export function silenceMediapipeInfoLogs() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("INFO:")) return;
    original(...args);
  };
}
