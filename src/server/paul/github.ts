// Paul lit GitHub (lecture seule, GITHUB_LECTURE_PERSO) : commits de la semaine, fichiers touchés, README et CLAUDE.md
// avec le sha de leur blob, arborescence, et quelques fichiers texte. Tout le réseau passe par un `fetch` injecté.
// L'écriture (après « Valider ») est à part : ecriture.ts, avec une autre clé.
import { encoderChemin, lire, type Recup } from '../light/sources';
import { lireAvecCode, lireCommit, teteDeBranche } from '../lea/github';

export { teteDeBranche };

const HOTE = 'https://api.github.com';
/** Commits listés au plus par projet (une page de GitHub). */
export const MAX_COMMITS = 100;

export type CommitBrut = { sha: string; message: string; date: number };

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

function commitDe(x: unknown): CommitBrut | null {
  const c = obj(x);
  const meta = obj(c?.commit);
  if (!c || typeof c.sha !== 'string' || !meta) return null;
  const date = Date.parse(String(obj(meta.author)?.date ?? obj(meta.committer)?.date ?? ''));
  return { sha: c.sha, message: typeof meta.message === 'string' ? meta.message : '', date: Number.isFinite(date) ? date : 0 };
}
const commitsDe = (liste: unknown): CommitBrut[] | null =>
  Array.isArray(liste) ? liste.map(commitDe).filter((c): c is CommitBrut => c !== null) : null;

/** Les commits de la branche depuis une date, du plus récent au plus ancien (100 au plus). Null si GitHub ne répond pas. */
export async function commitsDepuisDate(f: Recup, jeton: string, depot: string, branche: string, depuis: number, fin?: AbortSignal): Promise<CommitBrut[] | null> {
  const r = await lireAvecCode(f, `${HOTE}/repos/${depot}/commits?sha=${encodeURIComponent(branche)}&since=${encodeURIComponent(new Date(depuis).toISOString())}&per_page=${MAX_COMMITS}`, jeton, fin);
  if (!r) return null;
  if (r.statut === 404 || r.statut === 422) return [];
  return commitsDe(r.json);
}

/**
 * Les commits ajoutés depuis le marque-page, du plus récent au plus ancien. `coupes` : combien de commits plus anciens
 * n'ont pas été listés (plus de 100). « introuvable » : GitHub ne connaît plus ce sha (404 ou 422 : historique réécrit).
 * Null si GitHub ne répond pas.
 */
export async function commitsDepuisMarque(
  f: Recup, jeton: string, depot: string, marque: string, branche: string, fin?: AbortSignal,
): Promise<{ commits: CommitBrut[]; coupes: number } | 'introuvable' | null> {
  const cmp = await lireAvecCode(f, `${HOTE}/repos/${depot}/compare/${encodeURIComponent(marque)}...${encodeURIComponent(branche)}?per_page=${MAX_COMMITS}`, jeton, fin);
  if (!cmp) return null;
  if (cmp.statut === 404 || cmp.statut === 422) return 'introuvable';
  const c = obj(cmp.json);
  if (!c) return null;
  if (c.status === 'behind' || c.status === 'identical') return { commits: [], coupes: 0 };
  const listes = commitsDe(c.commits);
  if (!listes) return null;
  const total = typeof c.total_commits === 'number' ? c.total_commits : listes.length;
  if (total <= listes.length) return { commits: [...listes].reverse(), coupes: 0 };
  // Plus de 100 commits : la comparaison donne les plus anciens ; on veut les 100 plus récents.
  const r = await lireAvecCode(f, `${HOTE}/repos/${depot}/commits?sha=${encodeURIComponent(branche)}&per_page=${MAX_COMMITS}`, jeton, fin);
  const recents = r && r.statut !== 404 && r.statut !== 422 ? commitsDe(r.json) : null;
  if (!recents) return null;
  const i = recents.findIndex(x => x.sha === marque);
  const commits = i >= 0 ? recents.slice(0, i) : recents;
  return { commits, coupes: Math.max(0, total - commits.length) };
}

/** Les chemins touchés par un commit (sans les différences). Null si GitHub ne répond pas. */
export async function fichiersDuCommit(f: Recup, jeton: string, depot: string, sha: string, fin?: AbortSignal): Promise<string[] | null> {
  const c = await lireCommit(f, jeton, depot, sha, fin);
  return c ? c.fichiers.map(x => x.chemin).filter(x => x !== '…') : null;
}

/** Un fichier de la racine : absent, ou présent avec le sha de son blob (`texte` null : trop gros pour l'API). */
export type Contenu = { present: false } | { present: true; sha: string; texte: string | null };

/** Le contenu d'un fichier à un commit donné, avec le sha de son blob. Null si GitHub ne répond pas. */
export async function lireContenu(f: Recup, jeton: string, depot: string, chemin: string, ref: string, fin?: AbortSignal): Promise<Contenu | null> {
  const r = await lireAvecCode(f, `${HOTE}/repos/${depot}/contents/${encoderChemin(chemin)}?ref=${encodeURIComponent(ref)}`, jeton, fin);
  if (!r) return null;
  if (r.statut === 404 || r.statut === 422) return { present: false };
  const c = obj(r.json);
  if (!c) return Array.isArray(r.json) ? { present: false } : null; // un dossier porte ce nom : pas un fichier
  if (c.type !== 'file') return { present: false };
  if (typeof c.sha !== 'string') return null;
  if (c.encoding !== 'base64' || typeof c.content !== 'string' || (c.content === '' && Number(c.size) > 0)) return { present: true, sha: c.sha, texte: null };
  try {
    return { present: true, sha: c.sha, texte: Buffer.from(c.content.replace(/\s/g, ''), 'base64').toString('utf8') };
  } catch {
    return null;
  }
}

export type EntreeArbre = { chemin: string; dossier: boolean };

/** L'arborescence complète à un commit. Null si GitHub ne répond pas ou répond de travers. */
export async function lireArbre(f: Recup, jeton: string, depot: string, ref: string, fin?: AbortSignal): Promise<EntreeArbre[] | null> {
  const r = await lireAvecCode(f, `${HOTE}/repos/${depot}/git/trees/${encodeURIComponent(ref)}?recursive=1`, jeton, fin);
  if (!r || r.statut === 404 || r.statut === 422) return null;
  const a = obj(r.json);
  if (!a || !Array.isArray(a.tree)) return null;
  return a.tree.flatMap(x => {
    const e = obj(x);
    return e && typeof e.path === 'string' && (e.type === 'blob' || e.type === 'tree') ? [{ chemin: e.path, dossier: e.type === 'tree' }] : [];
  });
}

/** Un fichier texte brut à un commit donné (package.json, .env.example, note de séance). Null si absent ou illisible. */
export async function lireTexte(f: Recup, jeton: string, depot: string, chemin: string, ref: string, fin?: AbortSignal): Promise<string | null> {
  const r = await lire(f, `${HOTE}/repos/${depot}/contents/${encoderChemin(chemin)}?ref=${encodeURIComponent(ref)}`, jeton, 'application/vnd.github.raw', fin);
  if (!r) return null;
  try { return await r.text(); } catch { return null; }
}
