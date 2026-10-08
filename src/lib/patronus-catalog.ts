// Single source of truth for id -> Czech animal name, shared by the setup
// page (`/kouzla`, display labels) and the game page (`kouzla/hra`, which
// stores the label in the photo session's meta.json for /diplomy). Keeping
// one list means adding a 5th patron later can't silently desync the two.
export const PATRONUS_CATALOG = [
  { id: "1", label: "Jelen" },
  { id: "2", label: "Fénix" },
  { id: "fox", label: "Liška" },
  { id: "horse", label: "Kůň" },
] as const;
