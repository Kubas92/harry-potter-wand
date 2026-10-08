import { normalize } from "./voice-recognition";

// Kids expected at the 2026-09 camp — nominative name (as it'll likely be
// recognized) -> correct Czech vocative (5th case) form to greet them with.
// Czech vocative is irregular, so this is a lookup, not a formula. Add more
// names here as they're confirmed.
const KNOWN_VOCATIVES: Record<string, string> = {
  emi: "Emo",
  emily: "Emily",
  vojta: "Vojto",
  ondra: "Ondro",
  onda: "Onďo", // Onďa
  lily: "Lily",
  ema: "Emo",
  ada: "Áďo", // Áďa
  adelka: "Adélko",
  vasek: "Vašku",
  vasik: "Vašíku",
  natalka: "Natálko",
  naty: "Naty",
};

export function toVocative(name: string): string {
  const known = KNOWN_VOCATIVES[normalize(name)];
  if (known) return known;
  // Best-effort fallback for a name not on the list: Czech names ending in
  // -a commonly become -o in the vocative (Kuba -> Kubo, Bára -> Báro).
  // Anything else is left as-is rather than risk a confidently wrong guess.
  if (/a$/i.test(name)) return name.slice(0, -1) + "o";
  return name;
}

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    window.speechSynthesis.onvoiceschanged = () => resolve(window.speechSynthesis.getVoices());
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
  });
}

export async function speak(text: string, lang = "cs-CZ"): Promise<void> {
  if (!("speechSynthesis" in window)) return;

  const voices = await waitForVoices();
  // Prefer a voice installed on the Mac itself (localService) over Chrome's
  // online "Google" voices — the camp cottage may have no internet, and an
  // online voice would then just silently fail to speak.
  const langVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  const matchingVoice = langVoices.find((v) => v.localService) ?? langVoices[0];
  if (!matchingVoice) {
    console.warn(`[wand] no ${lang} voice installed on this Mac — speech will sound off`);
  }

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    if (matchingVoice) utterance.voice = matchingVoice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

// Web Speech API's SpeechRecognition has no official TS lib types, so this
// stays loosely typed rather than fighting for exact browser-vendor typings.
export function listenOnce(lang = "cs-CZ", timeoutMs = 6000): Promise<string> {
  return new Promise((resolve) => {
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
      | (new () => any) // eslint-disable-line @typescript-eslint/no-explicit-any
      | undefined;
    if (!Ctor) {
      resolve("");
      return;
    }

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;

    let done = false;
    const finish = (text: string) => {
      if (done) return;
      done = true;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      resolve(text);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => finish(event.results[0][0].transcript as string);
    recognition.onerror = () => finish("");
    recognition.onend = () => finish("");
    setTimeout(() => finish(""), timeoutMs);

    try {
      recognition.start();
    } catch {
      finish("");
    }
  });
}

const INTRO_PREFIXES = [
  "já se jmenuji",
  "já se jmenuju",
  "jmenuji se",
  "jmenuju se",
  "já jsem",
  "jsem",
];

export function extractName(transcript: string): string {
  let t = transcript.trim().toLowerCase();
  for (const prefix of INTRO_PREFIXES) {
    if (t.startsWith(prefix)) {
      t = t.slice(prefix.length).trim();
      break;
    }
  }
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Asks the child's name out loud, listens for the answer, and returns it
// both as heard (nominative — used for kouzla/hra's printable diploma) and
// declined into the Czech vocative (5th case, for greeting them) — or null
// if nothing usable was heard (an apology is spoken in that case so it
// doesn't feel like the app just silently failed).
export async function askForName(
  onStatus: (text: string | null) => void
): Promise<{ name: string; vocative: string } | null> {
  onStatus("Kdo se to sem přikradl? Jak se jmenuješ?");
  await speak("Kdo se to sem přikradl? Jak se jmenuješ?");

  onStatus("Poslouchám...");
  const transcript = await listenOnce("cs-CZ", 6000);
  console.log("[wand] name heard:", transcript);
  const name = extractName(transcript);

  if (!name) {
    onStatus(null);
    await speak("Neslyšel jsem tě. Zkus to prosím znovu.");
    return null;
  }

  onStatus(null);
  return { name, vocative: toVocative(name) };
}

export async function askForVocativeName(
  onStatus: (text: string | null) => void
): Promise<string | null> {
  return (await askForName(onStatus))?.vocative ?? null;
}

export async function runNameGreeting(onStatus: (text: string | null) => void): Promise<void> {
  const vocative = await askForVocativeName(onStatus);
  if (vocative) {
    onStatus(`Ahoj, ${vocative}!`);
    await speak(`Ahoj, ${vocative}!`);
    onStatus(null);
  }
}
