// Zoro lit GitHub (lecture seule) : dépôts actifs, dépendances, état des tests, date d'expiration de la clé.
import { encoderChemin, lire, listerDepots, type Recup } from '../light/sources';
import { fichiersDeDependances, lireDependances } from './dependances';
import type { Dependance, EtatCI } from './types';

const COMPTE = 'mon-compte';
const HOTE = 'https://api.github.com';
const DELAI_MS = 15_000;
const ECHECS = new Set(['failure', 'timed_out', 'startup_failure']);

/** Accepte le nom court (« app_livraison ») ou complet (« mon-compte/app_livraison »). */
const complet = (depot: string) => (depot.includes('/') ? depot : `${COMPTE}/${depot}`);

/** « 2026-12-01 10:00:00 +0100 » (ou « ... UTC ») → ms UTC ; null si le format n'est pas reconnu. */
function lireExpiration(brut: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})$/.exec(brut.trim());
  if (!m) return null;
  const zone = m[3] === 'UTC' || m[3] === 'Z' ? 'Z' : m[3].includes(':') ? m[3] : `${m[3].slice(0, 3)}:${m[3].slice(3)}`;
  const t = Date.parse(`${m[1]}T${m[2]}${zone}`);
  return Number.isFinite(t) ? t : null;
}

/**
 * Dépôts actifs du compte perso (non archivés, poussés dans les 90 derniers jours) et expiration de la clé.
 * `expiration` : ms UTC ; `null` = l'en-tête est absent (ou illisible) ; `undefined` = GitHub injoignable.
 * Si la liste des dépôts ne peut pas être lue, la fonction LÈVE `GitHub injoignable` : l'appelant marque alors
 * toute la partie GitHub comme non lue.
 */
export async function depotsActifs(
  f: Recup, jeton: string, now: number, fin?: AbortSignal,
): Promise<{ depots: { depot: string; pousse: number }[]; expiration: number | null | undefined }> {
  const liste = await listerDepots(f, jeton, 'perso', now, fin);
  const depots = liste.map(d => ({ depot: d.complet.slice(d.complet.indexOf('/') + 1), pousse: Date.parse(d.pousse) }));
  const r = await lire(f, `${HOTE}/user`, jeton, 'application/vnd.github+json', fin);
  if (!r) return { depots, expiration: undefined };
  const entete = r.headers.get('github-authentication-token-expiration');
  return { depots, expiration: entete ? lireExpiration(entete) : null };
}

/** Dépendances d'un dépôt (arbre complet, puis contenu brut des fichiers suivis). Null si quoi que ce soit n'a pas pu être lu. */
export async function dependancesDuDepot(f: Recup, jeton: string, depot: string, fin?: AbortSignal): Promise<Dependance[] | null> {
  const base = `${HOTE}/repos/${complet(depot)}`;
  const r = await lire(f, `${base}/git/trees/HEAD?recursive=1`, jeton, 'application/vnd.github+json', fin);
  if (!r) return null;
  let arbre: { tree?: unknown; truncated?: unknown } | null;
  try { arbre = (await r.json()) as typeof arbre; } catch { return null; }
  if (!arbre || !Array.isArray(arbre.tree) || arbre.truncated === true) return null;
  const chemins = (arbre.tree as { path?: unknown; type?: unknown }[])
    .filter(e => e.type === 'blob' && typeof e.path === 'string')
    .map(e => e.path as string);
  const choisis = fichiersDeDependances(chemins);
  if (choisis.length === 0) return [];
  const fichiers: Record<string, string> = {};
  for (const chemin of choisis) {
    const c = await lire(f, `${base}/contents/${encoderChemin(chemin)}`, jeton, 'application/vnd.github.raw', fin);
    if (!c) return null;
    try { fichiers[chemin] = await c.text(); } catch { return null; }
  }
  return lireDependances(fichiers);
}

type Lu = { ok: true; json: unknown } | { ok: false; raison: string };
const INJOIGNABLE = { ok: false, raison: 'GitHub injoignable' } as const;

/** Un GET JSON qui distingue 403/404 (droit manquant) d'une panne ; le jeton ne part que vers api.github.com. */
async function lireCI(f: Recup, url: string, jeton: string, fin?: AbortSignal): Promise<Lu> {
  if (fin?.aborted) return INJOIGNABLE;
  const signal = fin ? AbortSignal.any([AbortSignal.timeout(DELAI_MS), fin]) : AbortSignal.timeout(DELAI_MS);
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (new URL(url).hostname === 'api.github.com') headers.Authorization = `Bearer ${jeton}`;
    const r = await f(url, { headers, signal });
    const limite = r.status === 403 && (r.headers.get('x-ratelimit-remaining') === '0' || r.headers.has('retry-after'));
    if (limite) return INJOIGNABLE;
    if (r.status === 403 || r.status === 404) return { ok: false, raison: 'droit Actions manquant' };
    if (!r.ok) return INJOIGNABLE;
    return { ok: true, json: await r.json() };
  } catch {
    return INJOIGNABLE;
  }
}

/**
 * État des tests (GitHub Actions) sur la branche par défaut : 30 derniers passages terminés, tous workflows confondus.
 * Échecs : failure, timed_out, startup_failure ; ignorés : cancelled, skipped, neutral, etc. Jamais « vert » si une lecture a raté.
 * Chaque workflow est jugé sur son propre dernier passage compté : un workflow qui passe ne cache jamais un autre en échec.
 * Rouge si au moins un workflow est en échec ; « depuis » = le plus ancien début de série parmi ceux en échec.
 * `passages` et `echecs` : totaux sur les 30 passages.
 */
export async function etatCI(f: Recup, jeton: string, depot: string, fin?: AbortSignal): Promise<EtatCI> {
  const base = `${HOTE}/repos/${complet(depot)}`;
  const illisible = (l: { raison: string }): EtatCI => ({ etat: 'illisible', raison: l.raison });

  const infos = await lireCI(f, base, jeton, fin);
  if (!infos.ok) return illisible(infos);
  const branche = (infos.json as { default_branch?: unknown } | null)?.default_branch;
  if (typeof branche !== 'string' || !branche) return illisible(INJOIGNABLE);

  const flux = await lireCI(f, `${base}/actions/workflows`, jeton, fin);
  if (!flux.ok) return illisible(flux);
  const total = (flux.json as { total_count?: unknown } | null)?.total_count;
  if (typeof total !== 'number') return illisible(INJOIGNABLE);
  if (total === 0) return { etat: 'sans-tests' };

  const lot = await lireCI(f, `${base}/actions/runs?branch=${encodeURIComponent(branche)}&status=completed&per_page=30`, jeton, fin);
  if (!lot.ok) return illisible(lot);
  const brut = (lot.json as { workflow_runs?: unknown } | null)?.workflow_runs;
  if (!Array.isArray(brut)) return illisible(INJOIGNABLE);

  const runs = (brut as { conclusion?: unknown; created_at?: unknown; workflow_id?: unknown }[])
    .flatMap(r => {
      const t = typeof r.created_at === 'string' ? Date.parse(r.created_at) : NaN;
      if (!Number.isFinite(t) || typeof r.conclusion !== 'string') return [];
      const groupe = String(r.workflow_id ?? ''); // sans identifiant : un même groupe
      if (r.conclusion === 'success') return [{ t, echec: false, groupe }];
      return ECHECS.has(r.conclusion) ? [{ t, echec: true, groupe }] : [];
    })
    .sort((a, b) => b.t - a.t);

  if (runs.length === 0) return { etat: 'illisible', raison: 'aucun passage terminé' };
  const passages = runs.length;
  const echecs = runs.filter(r => r.echec).length;

  const parFlux = new Map<string, typeof runs>();
  for (const r of runs) parFlux.set(r.groupe, [...(parFlux.get(r.groupe) ?? []), r]);
  let depuis: number | null = null;
  for (const liste of parFlux.values()) {
    if (!liste[0].echec) continue; // son dernier passage compté a réussi
    let debut = liste[0].t;
    for (const r of liste) { if (!r.echec) break; debut = r.t; }
    depuis = depuis === null ? debut : Math.min(depuis, debut);
  }
  return depuis === null ? { etat: 'vert', passages, echecs } : { etat: 'rouge', depuis, passages, echecs };
}
