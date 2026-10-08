"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cinzel } from "next/font/google";
import type { PhotoSession } from "@/lib/photo-store";

// Printable "wizard diploma" per kid who went through kouzla/hra's guided
// tutorial. Each tutorial run (N press) is its own photo session with a
// meta.json holding the name as heard + the chosen patronus (see
// kouzla/hra). Names can be corrected here before printing (speech
// recognition gets them wrong sometimes), the photo is picked from that
// session's Patronus shots, and "kluk/holka" picks the verb ending. All
// edits are local to this page — nothing is written back. Printing shows
// only the .diploma sheets (A4 landscape, one per page) via @media print.
const cinzel = Cinzel({ subsets: ["latin", "latin-ext"], weight: ["400", "700"] });

type Draft = { name: string; photo: string | null; girl: boolean; include: boolean; preview: boolean };

function photoUrl(s: PhotoSession, file: string) {
  return `/api/photos/file?${new URLSearchParams({ game: s.game, session: s.session, file })}`;
}

function sessionLabel(session: string) {
  // "2026-09-24-14-05-33_tutorial" → "24. 9. 14:05"
  const m = session.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[4]}:${m[5]}` : session;
}

function Diploma({ session, draft }: { session: PhotoSession; draft: Draft }) {
  const name = draft.name.trim() || "Mladý kouzelník";
  return (
    <div className={`diploma ${cinzel.className}`}>
      <div className="diploma-frame">
        <p className="diploma-school">⚡ Kouzelnická akademie ⚡</p>
        <h1 className="diploma-title">Kouzelnický diplom</h1>
        <div className="diploma-body">
          {draft.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl(session, draft.photo)} alt="" className="diploma-photo" />
          )}
          <div className="diploma-text">
            <p>Tímto se potvrzuje, že</p>
            <p className="diploma-name">{name}</p>
            <p>
              úspěšně {draft.girl ? "zvládla" : "zvládl"} základy kouzel
              <br />
              <em>Lumos · Nox · Expelliarmus · Wingardium Leviosa · Expecto Patronum</em>
            </p>
            {session.meta?.patronus && (
              <p>
                a {draft.girl ? "vyčarovala" : "vyčaroval"} svého Patrona: <strong>{session.meta.patronus}</strong>
              </p>
            )}
          </div>
        </div>
        <div className="diploma-footer">
          <span>Září 2026</span>
          <span className="diploma-signature">Ředitel akademie</span>
        </div>
      </div>
    </div>
  );
}

export default function DiplomyPage() {
  const [sessions, setSessions] = useState<PhotoSession[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [printKeys, setPrintKeys] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/photos", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ sessions: PhotoSession[] }>)
      .then((data) => {
        const tutorial = data.sessions.filter((s) => s.game === "kouzla" && s.meta).reverse();
        setSessions(tutorial);
        setDrafts(
          Object.fromEntries(
            tutorial.map((s) => [
              s.session,
              { name: s.meta?.name ?? "", photo: s.photos.at(-1) ?? null, girl: false, include: true, preview: false },
            ])
          )
        );
      })
      .catch((err) => console.warn("[diplomy] failed to load sessions:", err));
  }, []);

  // Render the chosen sheets first, then open the print dialog.
  useEffect(() => {
    if (printKeys.length === 0) return;
    const t = setTimeout(() => {
      window.print();
      setPrintKeys([]);
    }, 300);
    return () => clearTimeout(t);
  }, [printKeys]);

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  }

  const toPrint = (sessions ?? []).filter((s) => printKeys.includes(s.session));

  return (
    <>
      <main className="no-print min-h-screen bg-black text-white p-8 flex flex-col items-center gap-6">
        <div className="text-center">
          <Link href="/" className="text-white/40 hover:text-white text-sm">
            ‹ Zpět na rozcestník
          </Link>
          <h1 className="text-3xl font-semibold mt-2">📜 Diplomy</h1>
          <p className="text-white/60 mt-2 max-w-xl">
            Jeden řádek = jedno dítě, které prošlo tutoriálem v „Základech kouzel“. Oprav jméno, vyber fotku a vytiskni.
          </p>
        </div>

        {sessions !== null && sessions.length > 0 && (
          <button
            onClick={() => setPrintKeys(sessions.filter((s) => drafts[s.session]?.include).map((s) => s.session))}
            className="rounded bg-yellow-500 text-black font-semibold px-6 py-2 hover:bg-yellow-400"
          >
            🖨 Vytisknout všechny vybrané
          </button>
        )}

        {sessions === null && <p className="text-white/60">Načítám...</p>}
        {sessions?.length === 0 && (
          <p className="text-white/60">Zatím nikdo neprošel tutoriálem (klávesa N v „Základech kouzel“).</p>
        )}

        <div className="w-full max-w-5xl flex flex-col gap-4">
          {sessions?.map((s) => {
            const draft = drafts[s.session];
            if (!draft) return null;
            return (
              <div key={s.session} className="rounded-lg bg-neutral-900 p-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="checkbox"
                    checked={draft.include}
                    onChange={(e) => update(s.session, { include: e.target.checked })}
                    className="h-5 w-5"
                  />
                  <input
                    value={draft.name}
                    onChange={(e) => update(s.session, { name: e.target.value })}
                    placeholder="Jméno"
                    className="rounded bg-black border border-neutral-700 px-3 py-1 text-lg"
                  />
                  <button
                    onClick={() => update(s.session, { girl: !draft.girl })}
                    className="rounded bg-white/10 px-3 py-1 text-sm"
                  >
                    {draft.girl ? "👧 holka" : "👦 kluk"}
                  </button>
                  <span className="text-white/50 text-sm">
                    {sessionLabel(s.session)}
                    {s.meta?.patronus ? ` · Patron: ${s.meta.patronus}` : ""}
                  </span>
                  <button
                    onClick={() => update(s.session, { preview: !draft.preview })}
                    className="ml-auto rounded bg-white/10 px-3 py-1 text-sm"
                  >
                    {draft.preview ? "Skrýt náhled" : "👁 Náhled"}
                  </button>
                  <button
                    onClick={() => setPrintKeys([s.session])}
                    className=" rounded bg-yellow-500 text-black font-semibold px-4 py-1 hover:bg-yellow-400"
                  >
                    🖨 Tisk
                  </button>
                </div>
                {s.photos.length === 0 ? (
                  <p className="text-white/40 text-sm">Bez fotky (Patronus nebyl vyčarován) — diplom bude bez obrázku.</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto">
                    {s.photos.map((file) => (
                      <button
                        key={file}
                        onClick={() => update(s.session, { photo: draft.photo === file ? null : file })}
                        className={`shrink-0 border-4 rounded ${draft.photo === file ? "border-yellow-400" : "border-transparent"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photoUrl(s, file)} alt="" className="h-24 w-auto rounded-sm" />
                      </button>
                    ))}
                  </div>
                )}
                {draft.preview && (
                  // A4 sheet scaled down to fit the row — same component as
                  // the printed one, so what you see is what prints.
                  <div className="diploma-preview">
                    <Diploma session={s} draft={draft} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      <div className="print-only">
        {toPrint.map((s) => (
          <Diploma key={s.session} session={s} draft={drafts[s.session]} />
        ))}
      </div>

      <style>{`
        .print-only { display: none; }
        @media print {
          @page { size: A4 landscape; margin: 0; }
          html, body { background: white !important; }
          .no-print { display: none !important; }
          .print-only { display: block; }
        }
        .diploma-preview { width: calc(297mm * 0.5); height: calc(210mm * 0.5); overflow: hidden; }
        .diploma-preview .diploma { transform: scale(0.5); transform-origin: top left; }
        .diploma {
          width: 297mm; height: 210mm; box-sizing: border-box; padding: 12mm;
          page-break-after: always; break-after: page;
          background: radial-gradient(ellipse at center, #fbf3dc 0%, #f1dfb0 70%, #e2c486 100%);
          color: #3b2a12;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .diploma-frame {
          height: 100%; box-sizing: border-box; border: 3mm double #8a6424; padding: 10mm 16mm;
          display: flex; flex-direction: column; align-items: center; text-align: center;
        }
        .diploma-school { font-size: 16pt; letter-spacing: 0.2em; color: #8a6424; }
        .diploma-title { font-size: 40pt; font-weight: 700; margin: 4mm 0 8mm; color: #5a3d10; }
        .diploma-body { flex: 1; display: flex; align-items: center; gap: 12mm; }
        .diploma-photo {
          height: 95mm; max-width: 130mm; object-fit: cover; border: 2mm solid #8a6424;
          border-radius: 3mm; box-shadow: 0 0 0 1mm #f1dfb0, 0 0 0 1.6mm #8a6424;
        }
        .diploma-text { font-size: 15pt; line-height: 1.7; display: flex; flex-direction: column; gap: 3mm; }
        .diploma-text em { font-size: 12pt; color: #6b4d1a; }
        .diploma-name { font-size: 34pt; font-weight: 700; color: #7a1f1f; line-height: 1.2; }
        .diploma-footer {
          width: 100%; display: flex; justify-content: space-between; align-items: flex-end;
          font-size: 13pt; margin-top: 6mm;
        }
        .diploma-signature { border-top: 0.4mm solid #3b2a12; padding-top: 2mm; min-width: 70mm; }
      `}</style>
    </>
  );
}
