import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bridges the browser (which can't speak HomeKit directly) to the physical
// lamp plugged into a HomeKit-paired smart plug, via a macOS Shortcut. Fixed
// allowlist by design — the shortcut name to run is never built from request
// input, so there's nothing to inject even though spawning without a shell
// already rules out shell-injection on its own.
const SHORTCUT_BY_STATE = {
  on: "LumosOn",
  off: "LumosOff",
} as const;

type LampState = keyof typeof SHORTCUT_BY_STATE;

function isLampState(value: unknown): value is LampState {
  return value === "on" || value === "off";
}

// `shortcuts run` hangs indefinitely — no error, no output, no dialog — when
// its stdout/stderr are Node's default anonymous pipes (confirmed while
// building this: `execFile`, which pipes by default, always hung; `spawn`
// with stdio pointed at a real file descriptor instead of a pipe consistently
// exited in well under a second). So: real fds, not pipes, plus a timeout as
// a last-resort safety net in case some other name/state ever hangs it again.
const SHORTCUT_TIMEOUT_MS = 5000;

function runShortcut(name: string): Promise<{ ok: boolean; output: string }> {
  const outPath = join(tmpdir(), `wand-shortcut-${randomUUID()}.log`);
  const fd = openSync(outPath, "w");

  return new Promise((resolve) => {
    const child = spawn("shortcuts", ["run", name], { stdio: ["ignore", fd, fd] });

    const timer = setTimeout(() => child.kill(), SHORTCUT_TIMEOUT_MS);

    child.on("exit", (code) => {
      clearTimeout(timer);
      closeSync(fd);
      let output = "";
      try {
        output = readFileSync(outPath, "utf8");
      } catch {
        // best-effort only
      }
      try {
        unlinkSync(outPath);
      } catch {
        // best-effort only
      }
      resolve({ ok: code === 0, output });
    });
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const state = (body as { state?: unknown } | null)?.state;

  if (!isLampState(state)) {
    return Response.json({ ok: false, error: 'state must be "on" or "off"' }, { status: 400 });
  }

  const shortcutName = SHORTCUT_BY_STATE[state];
  const { ok, output } = await runShortcut(shortcutName);

  if (!ok) {
    console.warn(`[lamp] Shortcut "${shortcutName}" failed:`, output);
    return Response.json({ ok: false, error: output || "shortcut failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
