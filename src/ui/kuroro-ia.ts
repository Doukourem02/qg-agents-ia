// Qui répond pour Kuroro dans la page, dans l'ordre : Claude (route /api/qg/kuroro, seulement si la clé existe),
// puis le modèle local du Mac par le QG (la page dépose sa demande, mac/kuroro.mjs la fait répondre par Ollama ;
// Safari et le téléphone ne peuvent pas joindre Ollama eux-mêmes), puis les règles (null : la page reprend decider).
// Dans les deux cas, une mission éventuelle est déjà déposée et confirmée par le serveur. Jamais en /demo.

export type Tour = { role: 'moi' | 'kuroro'; texte: string };
export type ReponseIA = { source: 'claude' | 'relais'; texte: string; mission?: { agent: string; nom: string } };
type Fetch = typeof fetch;
export type Options = {
  /** « Effacer » : l'attente s'arrête tout de suite. */
  signal?: AbortSignal;
  attendre?: (ms: number) => Promise<void>;
};

/** La page relit la réponse du Mac toutes les 700 ms, 30 s au plus. */
export const PAS_MS = 700;
export const ATTENTE_MAX_MS = 30_000;
const attendreVrai = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const lireMission = (m: unknown) => {
  const { agent, nom } = (m ?? {}) as Record<string, unknown>;
  return typeof agent === 'string' && typeof nom === 'string' ? { mission: { agent, nom } } : {};
};

/** Claude par la route du QG ; null au moindre doute (repli, erreur, réseau). */
export async function demanderClaude(messages: Tour[], f: Fetch = fetch): Promise<ReponseIA | null> {
  try {
    const r = await f('/api/qg/kuroro', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, demo: false }) });
    if (!r.ok) return null;
    const v = await r.json();
    if (typeof v?.texte !== 'string' || !v.texte) return null;
    return { source: 'claude', texte: v.texte, ...lireMission(v.mission) };
  } catch {
    return null;
  }
}

/** Le Mac par le QG : null s'il n'est pas là, s'il échoue, au bout de 30 s, ou si « Effacer » coupe l'attente. */
export async function demanderRelais(messages: Tour[], f: Fetch = fetch, { signal, attendre = attendreVrai }: Options = {}): Promise<ReponseIA | null> {
  try {
    const r = await f('/api/qg/kuroro/demande', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }), signal });
    if (!r.ok) return null;
    const { id } = await r.json();
    if (typeof id !== 'string') return null;
    for (let i = 0; i < Math.floor(ATTENTE_MAX_MS / PAS_MS); i++) {
      await attendre(PAS_MS);
      if (signal?.aborted) return null;
      let v: Record<string, unknown>;
      try {
        const l = await f(`/api/qg/kuroro/reponse?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal });
        if (!l.ok) continue;
        v = await l.json();
      } catch {
        if (signal?.aborted) return null;
        continue; // un trou de réseau : on relit au pas suivant
      }
      if (signal?.aborted) return null;
      if (v.statut === 'prete' && typeof v.texte === 'string' && v.texte) return { source: 'relais', texte: v.texte, ...lireMission(v.mission) };
      if (v.statut !== 'attente') return null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Au plus un réveil du Mac par 30 s et par page. */
export const REVEIL_MS = 30_000;
let dernierReveil = -Infinity;

/**
 * J'ouvre la conversation : le Mac se réveille (il relit la file toutes les 1,5 s au lieu de 20 s), pour répondre vite.
 * Silencieux : sans réponse, rien ne change. Renvoie true si l'appel est parti.
 */
export function reveillerMac(f: Fetch = fetch, now = Date.now()): boolean {
  if (now - dernierReveil < REVEIL_MS) return false;
  dernierReveil = now;
  f('/api/qg/kuroro/eveil', { method: 'POST' }).catch(() => {});
  return true;
}

/** Claude, sinon le Mac par le QG, sinon null (les règles). */
export async function repondreIA(messages: Tour[], f: Fetch = fetch, options: Options = {}): Promise<ReponseIA | null> {
  return (await demanderClaude(messages, f)) ?? (options.signal?.aborted ? null : await demanderRelais(messages, f, options));
}
