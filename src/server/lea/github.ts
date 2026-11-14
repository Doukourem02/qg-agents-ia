// Léa lit GitHub (lecture seule) : tête de la branche par défaut, nouveaux commits, fichiers d'un commit.
import { lire, lireJson, type Recup } from '../light/sources';
import type { CommitLot, FichierLot } from './types';

const HOTE = 'https://api.github.com';
const DELAI_MS = 15_000;
const MAX_COMMITS = 30;
const MAX_PATCH = 40 * 1024;
const MAX_FICHIERS_GITHUB = 300;
const ACCEPT = 'application/vnd.github+json';

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/**
 * Branche par défaut du dépôt et sha de sa tête. « vide » : le dépôt est lisible mais sa branche n'existe pas encore
 * (dépôt sans commit) — rien à relire, ce n'est pas une panne. Null si GitHub ne répond pas ou répond de travers.
 */
export async function teteDeBranche(f: Recup, jeton: string, depot: string, fin?: AbortSignal): Promise<{ branche: string; sha: string } | 'vide' | null> {
  const d = obj(await lireJson(f, `${HOTE}/repos/${depot}`, jeton, fin));
  const branche = d && typeof d.default_branch === 'string' ? d.default_branch : null;
  if (!branche) return null;
  const b = await lireAvecCode(f, `${HOTE}/repos/${depot}/branches/${encodeURIComponent(branche)}`, jeton, fin);
  if (b?.statut === 404) return 'vide';
  const sha = obj(obj(b?.json)?.commit)?.sha;
  return typeof sha === 'string' ? { branche, sha } : null;
}

export type Reponse = { statut: number; json: unknown } | null;

/** Un GET JSON qui garde le code HTTP (pour distinguer un 404 ou un 422) ; le jeton ne part que vers api.github.com. Aussi pour Paul. */
export async function lireAvecCode(f: Recup, url: string, jeton: string, fin?: AbortSignal): Promise<Reponse> {
  if (fin?.aborted) return null;
  const signal = fin ? AbortSignal.any([AbortSignal.timeout(DELAI_MS), fin]) : AbortSignal.timeout(DELAI_MS);
  try {
    const headers: Record<string, string> = { Accept: ACCEPT };
    if (new URL(url).hostname === 'api.github.com') headers.Authorization = `Bearer ${jeton}`;
    const r = await f(url, { headers, signal });
    if (r.status === 404 || r.status === 422) return { statut: r.status, json: null };
    if (!r.ok) return null;
    return { statut: r.status, json: await r.json() };
  } catch {
    return null;
  }
}

const shasDe = (liste: unknown): string[] | null =>
  Array.isArray(liste) ? liste.map(c => obj(c)?.sha).filter((s): s is string => typeof s === 'string') : null;

/**
 * Commits ajoutés depuis la marque, du plus ancien au plus récent, 30 au plus (les 30 plus anciens).
 * Marque introuvable (404, ou 422 quand GitHub ne connaît plus ce sha : historique réécrit) → `reecrit: true` et les
 * commits des dernières 24 h de la branche. La comparaison est demandée par pages de 30 (les plus anciens d'abord).
 * Null si GitHub est injoignable.
 */
export async function commitsDepuis(
  f: Recup, jeton: string, depot: string, marque: string, branche: string, fin?: AbortSignal,
): Promise<{ shas: string[]; reecrit?: true } | null> {
  const cmp = await lireAvecCode(f, `${HOTE}/repos/${depot}/compare/${encodeURIComponent(marque)}...${encodeURIComponent(branche)}?per_page=${MAX_COMMITS}`, jeton, fin);
  if (!cmp) return null;
  if (cmp.statut !== 404 && cmp.statut !== 422) {
    const c = obj(cmp.json);
    if (!c) return null;
    if (c.status === 'behind' || c.status === 'identical') return { shas: [] };
    const shas = shasDe(c.commits);
    return shas ? { shas: shas.slice(0, MAX_COMMITS) } : null;
  }
  const depuis = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const rec = await lireAvecCode(f, `${HOTE}/repos/${depot}/commits?sha=${encodeURIComponent(branche)}&since=${encodeURIComponent(depuis)}&per_page=100`, jeton, fin);
  const shas = rec && rec.statut !== 404 && rec.statut !== 422 ? shasDe(rec.json) : null;
  // GitHub répond du plus récent au plus ancien : on garde les 30 plus récents, rendus du plus ancien au plus récent.
  return shas ? { shas: shas.slice(0, MAX_COMMITS).reverse(), reecrit: true } : null;
}

const VERROUS = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'poetry.lock', 'Cargo.lock', 'Gemfile.lock', 'composer.lock']);
// Binaires (images, polices, sons et vidéos, archives, pdf, code compilé) : sans différence lisible, aucune clé lisible.
const BINAIRES = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'icns', 'tiff', 'heic',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'mov', 'avi', 'webm', 'wav', 'ogg', 'm4a',
  'pdf', 'zip', 'gz', 'tgz', 'tar', 'rar', '7z', 'jar', 'wasm', 'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'pyc',
]);
// Ignorés pour l'IA mais pas « binaires » : svg (du texte) et bases de données (peuvent contenir des secrets en clair).
const EXTENSIONS = new Set([...BINAIRES, 'svg', 'sqlite', 'db']);
const extension = (chemin: string) => {
  const nom = chemin.slice(chemin.lastIndexOf('/') + 1);
  return nom.includes('.') ? nom.slice(nom.lastIndexOf('.') + 1).toLowerCase() : '';
};

/** Binaire par extension : sans différence lisible, il n'est pas compté « clés non vérifiées ». */
export const estBinaire = (chemin: string): boolean => BINAIRES.has(extension(chemin));
const DOSSIERS = ['dist/', '.next/', 'build/', 'node_modules/', 'carnet/', 'docs/seances/'];

/** Verrous, images/binaires, `*.min.*`, `*.map`, dossiers générés : pas envoyé à l'IA (mais toujours passé au repérage des clés). */
export function fichierIgnore(chemin: string): boolean {
  const nom = chemin.slice(chemin.lastIndexOf('/') + 1);
  if (VERROUS.has(nom) || /\.min\./i.test(nom) || /\.map$/i.test(nom)) return true;
  if (EXTENSIONS.has(extension(chemin))) return true;
  return DOSSIERS.some(d => chemin.startsWith(d) || chemin.includes(`/${d}`));
}

/**
 * Un commit avec ses fichiers. Fichier sans `patch` → `enPartie: 'non fourni'` + `clesNonVerifiees`.
 * Patch > 40 Ko → `enPartie: 'trop gros'` MAIS le patch est conservé : le repérage des clés doit le lire en entier ;
 * c'est à `preparerLot` (tâche 3) de le retirer du lot envoyé à l'IA (comme celui des fichiers .env*).
 * Liste tronquée par GitHub (300 fichiers) → un fichier spécial « … » marqué `clesNonVerifiees`.
 * `statut` garde l'état GitHub (added, modified, removed, renamed). `rienACoder` si tous les fichiers sont ignorés.
 * Null si GitHub est injoignable ou la réponse illisible.
 */
export async function lireCommit(f: Recup, jeton: string, depot: string, sha: string, fin?: AbortSignal): Promise<CommitLot | null> {
  const r = await lire(f, `${HOTE}/repos/${depot}/commits/${encodeURIComponent(sha)}`, jeton, ACCEPT, fin);
  if (!r) return null;
  let c: Record<string, unknown> | null;
  try { c = obj(await r.json()); } catch { return null; }
  const meta = obj(c?.commit);
  if (!c || !meta || !Array.isArray(c.files)) return null;
  const date = Date.parse(String(obj(meta.author)?.date ?? obj(meta.committer)?.date ?? ''));
  const fichiers: FichierLot[] = [];
  for (const x of c.files) {
    const o = obj(x);
    if (!o || typeof o.filename !== 'string') continue;
    const fl: FichierLot = { chemin: o.filename };
    if (typeof o.status === 'string') fl.statut = o.status;
    if (typeof o.patch !== 'string' || o.patch === '') {
      fl.enPartie = 'non fourni';
      fl.clesNonVerifiees = true;
    } else {
      fl.patch = o.patch;
      if (o.patch.length > MAX_PATCH) fl.enPartie = 'trop gros';
    }
    fichiers.push(fl);
  }
  if (c.files.length >= MAX_FICHIERS_GITHUB) fichiers.push({ chemin: '…', clesNonVerifiees: true, enPartie: 'non fourni' });
  const lot: CommitLot = {
    sha: typeof c.sha === 'string' ? c.sha : sha,
    message: typeof meta.message === 'string' ? meta.message : '',
    date: Number.isFinite(date) ? date : 0,
    fichiers,
  };
  if (fichiers.length > 0 && fichiers.every(x => fichierIgnore(x.chemin))) lot.rienACoder = true;
  return lot;
}
