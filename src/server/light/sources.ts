// Les sources de Light : GitHub, npm, endoflife.date et quelques flux. Tout le réseau passe par un `fetch` injecté.
import { lireManifeste, type Usage } from './versions';

export type Recup = typeof fetch;
export type Depot = { complet: string; compte: 'perso' | 'pro'; pousse: string; fork?: true };
export type Manifeste = { depot: string; fichier: string; nom?: string; usages: Usage[] };
export type Cycle = { produit: string; cycle: string; fin: string | null };
export type Lecture = { titre: string; url: string; source: string; date?: string };

const DELAI_MS = 15_000;
const HOTE_GITHUB = 'api.github.com';
const JOURS_ACTIF = 90;
const MAX_PACKAGES = 20;
const MAX_LECTURES = 15;
const MAX_PAGES = 10;

/** Slugs vérifiés sur endoflife.date le 2026-11-09 (`typescript` répond 404, donc absent). */
export const PRODUITS_FIN_DE_SUPPORT: readonly string[] = ['nodejs', 'nextjs', 'react-native'];

/** Flux vérifiés à la main (200, XML) le 2026-11-09. */
export const FLUX: readonly { source: string; url: string }[] = [
  { source: 'Next.js', url: 'https://nextjs.org/feed.xml' },
  { source: 'Vercel', url: 'https://vercel.com/atom' },
  { source: 'Expo', url: 'https://expo.dev/changelog/rss.xml' },
];

/** Réponse spéciale de `lireOuDelai` : le délai (15 s) ou l'échéance commune a coupé l'appel. */
const DELAI = Symbol('délai');

/**
 * Un GET avec délai ; le jeton ne part que vers api.github.com. Null si échec ou non 2xx, `DELAI` si coupé.
 * `fin` est l'échéance commune du relevé : une fois passée, plus aucun appel ne part (l'élément est sauté).
 */
async function lireOuDelai(f: Recup, url: string, jeton?: string, accept?: string, fin?: AbortSignal): Promise<Response | null | typeof DELAI> {
  if (fin?.aborted) return DELAI;
  const signal = fin ? AbortSignal.any([AbortSignal.timeout(DELAI_MS), fin]) : AbortSignal.timeout(DELAI_MS);
  try {
    const headers: Record<string, string> = {};
    if (accept) headers.Accept = accept;
    if (jeton && new URL(url).hostname === HOTE_GITHUB) headers.Authorization = `Bearer ${jeton}`;
    const r = await f(url, { headers, signal });
    return r.ok ? r : null;
  } catch (e) {
    const nom = e instanceof Error || e instanceof DOMException ? e.name : '';
    return signal.aborted || nom === 'TimeoutError' || nom === 'AbortError' ? DELAI : null;
  }
}

export async function lire(f: Recup, url: string, jeton?: string, accept?: string, fin?: AbortSignal): Promise<Response | null> {
  const r = await lireOuDelai(f, url, jeton, accept, fin);
  return r === DELAI ? null : r;
}

export async function lireJson(f: Recup, url: string, jeton?: string, fin?: AbortSignal): Promise<unknown> {
  const r = await lire(f, url, jeton, 'application/vnd.github+json', fin);
  if (!r) return null;
  try { return await r.json(); } catch { return null; }
}

function suivant(link: string | null): string | null {
  const m = link && /<([^>]+)>\s*;\s*rel="next"/.exec(link);
  if (!m) return null;
  try { return new URL(m[1]).hostname === HOTE_GITHUB ? m[1] : null; } catch { return null; }
}

export async function listerDepots(f: Recup, jeton: string, compte: 'perso' | 'pro', now: number, fin?: AbortSignal): Promise<Depot[]> {
  const limite = now - JOURS_ACTIF * 86_400_000;
  const depots: Depot[] = [];
  let url: string | null = 'https://api.github.com/user/repos?affiliation=owner&per_page=100';
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const r = await lire(f, url, jeton, 'application/vnd.github+json', fin);
    let liste: unknown;
    try { liste = r ? await r.json() : null; } catch { liste = null; }
    if (!r || !Array.isArray(liste)) throw new Error(`GitHub injoignable (${compte})`);
    for (const d of liste as Record<string, unknown>[]) {
      const pousse = typeof d.pushed_at === 'string' ? d.pushed_at : '';
      const t = Date.parse(pousse);
      if (typeof d.full_name === 'string' && d.archived !== true && Number.isFinite(t) && t >= limite) {
        depots.push({ complet: d.full_name, compte, pousse, ...(d.fork === true ? { fork: true as const } : {}) });
      }
    }
    url = suivant(r.headers.get('link'));
  }
  return depots;
}

export const encoderChemin = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** Un dépôt dont un appel dépasse le délai n'est plus lu : il ne rend rien (pas de relevé partiel). */
export async function lireManifestes(f: Recup, jeton: string, depot: string, fin?: AbortSignal): Promise<Manifeste[]> {
  const base = `https://api.github.com/repos/${depot}`;
  const r = await lireOuDelai(f, `${base}/git/trees/HEAD?recursive=1`, jeton, 'application/vnd.github+json', fin);
  if (!r || r === DELAI) return [];
  let arbre: { tree?: unknown } | null;
  try { arbre = (await r.json()) as { tree?: unknown } | null; } catch { return []; }
  if (!arbre || !Array.isArray(arbre.tree)) return [];
  const chemins = (arbre.tree as { path?: unknown; type?: unknown }[])
    .filter(e => e.type === 'blob' && typeof e.path === 'string')
    .map(e => e.path as string)
    .filter(p => (p === 'package.json' || p.endsWith('/package.json')) && !p.split('/').includes('node_modules'))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_PACKAGES);

  const brut = async (chemin: string): Promise<string | null | typeof DELAI> => {
    const r = await lireOuDelai(f, `${base}/contents/${encoderChemin(chemin)}`, jeton, 'application/vnd.github.raw', fin);
    if (!r || r === DELAI) return r;
    try { return await r.text(); } catch { return null; }
  };

  // .nvmrc / .node-version : seulement à côté du package.json racine.
  let nvmrc: string | undefined;
  if (chemins.includes('package.json')) {
    for (const nom of ['.nvmrc', '.node-version']) {
      const t = await brut(nom);
      if (t === DELAI) return [];
      if (t !== null) { nvmrc = t; break; }
    }
  }

  const resultat: Manifeste[] = [];
  for (const fichier of chemins) {
    const texte = await brut(fichier);
    if (texte === DELAI) return [];
    if (texte === null) continue;
    const m = lireManifeste(texte, fichier === 'package.json' && nvmrc !== undefined ? { nvmrc } : {});
    resultat.push({ depot, fichier, nom: m.nom, usages: m.usages });
  }
  return resultat;
}

export async function dernieresVersions(f: Recup, paquets: string[], fin?: AbortSignal): Promise<Record<string, string>> {
  const sortie: Record<string, string> = {};
  await Promise.all(paquets.map(async p => {
    const r = await lire(f, `https://registry.npmjs.org/${encodeURIComponent(p)}/latest`, undefined, undefined, fin);
    if (!r) return;
    try {
      const j = (await r.json()) as { version?: unknown };
      if (typeof j.version === 'string') sortie[p] = j.version;
    } catch { /* paquet sauté */ }
  }));
  return sortie;
}

/** `eol: true` sans date = déjà terminé : on note `1970-01-01` (date passée) pour garder `fin: string | null`. */
const DEJA_FINI = '1970-01-01';

export async function finsDeSupport(f: Recup, produits: string[], fin?: AbortSignal): Promise<Cycle[]> {
  const lots = await Promise.all(produits.map(async produit => {
    const r = await lire(f, `https://endoflife.date/api/${encodeURIComponent(produit)}.json`, undefined, undefined, fin);
    if (!r) return [];
    try {
      const liste = (await r.json()) as unknown;
      if (!Array.isArray(liste)) return [];
      return (liste as Record<string, unknown>[]).flatMap((c): Cycle[] => {
        if (c.cycle === undefined || c.cycle === null) return [];
        const eol = c.eol;
        const finCycle = typeof eol === 'string' ? eol : eol === true ? DEJA_FINI : null;
        return [{ produit, cycle: String(c.cycle), fin: finCycle }];
      });
    } catch { return []; }
  }));
  return lots.flat();
}

// --- Lectures -------------------------------------------------------------

function nettoyer(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/** RSS (`<item>`) ou Atom (`<entry>`), par expressions simples. */
function lireFlux(xml: string, source: string): Lecture[] {
  const sortie: Lecture[] = [];
  for (const m of xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)) {
    const bloc = m[0];
    const titre = /<title[^>]*>([\s\S]*?)<\/title>/.exec(bloc)?.[1];
    let url = /<link[^>]*>([^<]+)<\/link>/.exec(bloc)?.[1];
    if (!url) {
      const balises = [...bloc.matchAll(/<link\b[^>]*>/g)].map(x => x[0]);
      const b = balises.find(x => !/rel="(?!alternate")/.test(x)) ?? balises[0];
      url = b && /href="([^"]+)"/.exec(b)?.[1];
    }
    const date = /<(?:pubDate|updated|published)>([^<]+)</.exec(bloc)?.[1];
    if (titre && url) sortie.push({ titre: nettoyer(titre), url: nettoyer(url), source, ...(date ? { date: date.trim() } : {}) });
  }
  return sortie;
}

function depotGithub(repository: unknown): string | null {
  const brut = typeof repository === 'string' ? repository
    : repository && typeof repository === 'object' ? (repository as { url?: unknown }).url : null;
  if (typeof brut !== 'string') return null;
  const m = /(?:github:|github\.com[/:])([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[#/].*)?$/.exec(brut);
  return m ? `${m[1]}/${m[2]}` : null;
}

export async function lecturesCandidates(
  f: Recup, jetonGithub: string | undefined, paquetsQuiOntBouge: string[], fin?: AbortSignal,
): Promise<Lecture[]> {
  const parPaquet = await Promise.all(paquetsQuiOntBouge.map(async (paquet): Promise<Lecture[]> => {
    const npm = (await lireJson(f, `https://registry.npmjs.org/${encodeURIComponent(paquet)}/latest`, undefined, fin)) as { repository?: unknown } | null;
    const depot = npm ? depotGithub(npm.repository) : null;
    if (!depot) return [];
    const notes = await lireJson(f, `https://api.github.com/repos/${depot}/releases?per_page=3`, jetonGithub, fin);
    if (!Array.isArray(notes)) return [];
    return (notes as Record<string, unknown>[]).flatMap((n): Lecture[] => {
      const titre = (typeof n.name === 'string' && n.name) || (typeof n.tag_name === 'string' && n.tag_name) || '';
      if (!titre || typeof n.html_url !== 'string') return [];
      return [{ titre, url: n.html_url, source: paquet, ...(typeof n.published_at === 'string' ? { date: n.published_at } : {}) }];
    });
  }));

  const parFlux = await Promise.all(FLUX.map(async ({ source, url }): Promise<Lecture[]> => {
    const r = await lire(f, url, undefined, 'application/rss+xml, application/atom+xml, application/xml', fin);
    if (!r) return [];
    try { return lireFlux(await r.text(), source).slice(0, 5); } catch { return []; }
  }));

  return [...parPaquet.flat(), ...parFlux.flat()]
    .filter(l => { try { return new URL(l.url).protocol === 'https:'; } catch { return false; } })
    .slice(0, MAX_LECTURES);
}
