// Single source of truth for id -> Czech animal name, shared by the setup
// page (`/kouzla`, display labels) and the game page (`kouzla/hra`, which
// needs the current selection's spoken animal name for the tutorial's
// Patronus voice-fallback — see runIntroTutorial's teachPatronus()). Keeping
// one list means adding a 5th patron later can't silently desync the two.
export const PATRONUS_CATALOG = [
  { id: "1", label: "Jelen" },
  { id: "2", label: "Fénix" },
  { id: "fox", label: "Liška" },
  { id: "horse", label: "Kůň" },
] as const;
