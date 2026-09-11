const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .replace(/[^a-z\s]/g, "");
}

export function matchesPatronusPhrase(transcript: string): boolean {
  const norm = normalize(transcript);
  return norm.includes("expect") && (norm.includes("patron") || norm.includes("patrn"));
}

export type PatronusListener = {
  stop: () => void;
  // Pause while another SpeechRecognition session needs the microphone
  // (browsers only support one active session at a time), then resume.
  setPaused: (paused: boolean) => void;
};

// Web Speech API has no official TS lib types (it's non-standard/vendor
// prefixed), so this stays loosely typed rather than fighting for exact
// browser-vendor typings.
export function startPatronusListener(onDetected: () => void): PatronusListener {
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
    | (new () => any) // eslint-disable-line @typescript-eslint/no-explicit-any
    | undefined;

  if (!Ctor) {
    console.warn("[wand] SpeechRecognition not supported in this browser");
    return { stop: () => {}, setPaused: () => {} };
  }

  let stopped = false;
  let paused = false;
  let lastTrigger = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recognition: any = new Ctor();

  function attachHandlers() {
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript as string;
        console.log("[wand] heard:", transcript);
        if (matchesPatronusPhrase(transcript)) {
          const now = Date.now();
          if (now - lastTrigger > 4000) {
            lastTrigger = now;
            onDetected();
          }
        }
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (e: any) => {
      console.warn("[wand] speech recognition error:", e.error);
    };

    recognition.onend = () => {
      // Browsers stop listening after a pause of silence — restart to keep
      // it always-on for as long as the page is open (unless deliberately
      // paused or stopped).
      if (!stopped && !paused) {
        try {
          recognition.start();
        } catch {
          // already running — ignore
        }
      }
    };
  }

  attachHandlers();
  try {
    recognition.start();
    console.log("[wand] listening for 'Expecto Patronum'...");
  } catch (e) {
    console.warn("[wand] failed to start speech recognition:", e);
  }

  return {
    stop: () => {
      stopped = true;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      recognition = null;
    },
    setPaused: (p: boolean) => {
      paused = p;
      if (p) {
        try {
          recognition?.stop();
        } catch {
          // ignore
        }
      } else {
        try {
          recognition?.start();
        } catch {
          // ignore
        }
      }
    },
  };
}
