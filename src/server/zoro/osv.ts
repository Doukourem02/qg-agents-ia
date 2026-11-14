// Les failles connues d'une liste de dépendances, lues dans la base publique OSV (lecture seule).

import type { Dependance, Faille, Gravite } from './types';

const OSV = 'https://api.osv.dev';
const DELAI_MS = 15_000;
const TAILLE_LOT = 1000;
const PARALLELE = 8;
const PAGES_MAX = 20;
const RESUME_MAX = 120;

// --- Versions -------------------------------------------------------------------------------

/** Compare deux versions segment par segment, en nombres (« 1.10 » > « 1.9 ») ; les étiquettes (-beta, +build) sont ignorées. */
export function comparerVersions(a: string, b: string): number {
  const segments = (v: string) => v.trim().replace(/^v/i, '').split(/[-+]/)[0].split('.').map((s) => parseInt(s, 10) || 0);
  const x = segments(a);
  const y = segments(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// --- Gravité --------------------------------------------------------------------------------

const POIDS_AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const POIDS_AC: Record<string, number> = { L: 0.77, H: 0.44 };
const POIDS_UI: Record<string, number> = { N: 0.85, R: 0.62 };
const POIDS_CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

/** Arrondi au dixième supérieur, tel que défini par la spécification CVSS 3.1 (annexe A). */
function arrondiHaut(x: number): number {
  const n = Math.round(x * 100000);
  return n % 10000 === 0 ? n / 100000 : (Math.floor(n / 10000) + 1) / 10;
}

/** Note de base CVSS 3.0 / 3.1 (0 à 10) calculée depuis le vecteur ; null si le vecteur est incomplet ou d'une autre version. */
export function scoreCVSS3(vecteur: string): number | null {
  const parts = vecteur.split('/');
  if (!/^CVSS:3\.[01]$/.test(parts[0] ?? '')) return null;
  const m: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const [k, v] = p.split(':');
    if (k && v) m[k] = v;
  }
  const portee = m.S;
  const av = POIDS_AV[m.AV], ac = POIDS_AC[m.AC], ui = POIDS_UI[m.UI];
  const c = POIDS_CIA[m.C], i = POIDS_CIA[m.I], a = POIDS_CIA[m.A];
  const pr = m.PR === 'N' ? 0.85 : m.PR === 'L' ? (portee === 'C' ? 0.68 : 0.62) : m.PR === 'H' ? (portee === 'C' ? 0.5 : 0.27) : undefined;
  if ((portee !== 'U' && portee !== 'C') || [av, ac, ui, c, i, a, pr].some((x) => x === undefined)) return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = portee === 'U' ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  if (impact <= 0) return 0;
  const exploitable = 8.22 * av * ac * pr! * ui;
  return portee === 'U' ? arrondiHaut(Math.min(impact + exploitable, 10)) : arrondiHaut(Math.min(1.08 * (impact + exploitable), 10));
}

function graviteDepuisNote(note: number): Gravite {
  return note >= 9 ? 'critique' : note >= 7 ? 'haute' : note >= 4 ? 'moyenne' : 'basse';
}

const objet = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/** Gravité d'une fiche OSV : l'étiquette GitHub si elle existe, sinon la note CVSS, sinon « moyenne ». */
export function graviteOSV(vuln: unknown): Gravite {
  const v = objet(vuln);
  if (!v) return 'moyenne';
  const etiquette = objet(v.database_specific)?.severity;
  if (typeof etiquette === 'string') {
    const e = etiquette.toUpperCase();
    if (e === 'CRITICAL') return 'critique';
    if (e === 'HIGH') return 'haute';
    if (e === 'MODERATE' || e === 'MEDIUM') return 'moyenne';
    if (e === 'LOW') return 'basse';
  }
  if (Array.isArray(v.severity)) {
    for (const s of v.severity) {
      const score = objet(s)?.score;
      const note = typeof score === 'number' ? score : typeof score === 'string' ? (/^\d+(\.\d+)?$/.test(score.trim()) ? parseFloat(score) : scoreCVSS3(score)) : null;
      if (note !== null && Number.isFinite(note)) return graviteDepuisNote(note);
    }
  }
  return 'moyenne';
}

/** La plus petite version corrigée (« fixed ») strictement supérieure à la version utilisée, pour ce paquet ; null sinon. */
function corrigeeEn(vuln: unknown, d: Dependance): string | null {
  const affected = objet(vuln)?.affected;
  if (!Array.isArray(affected)) return null;
  let meilleure: string | null = null;
  for (const a of affected) {
    const pkg = objet(objet(a)?.package);
    if (!pkg || pkg.name !== d.nom || pkg.ecosystem !== d.ecosysteme) continue;
    const ranges = objet(a)?.ranges;
    if (!Array.isArray(ranges)) continue;
    for (const r of ranges) {
      // Les plages GIT portent des hash de commit, pas des versions : on ne lit que SEMVER et ECOSYSTEM.
      const type = objet(r)?.type;
      if (type !== 'SEMVER' && type !== 'ECOSYSTEM') continue;
      const events = objet(r)?.events;
      if (!Array.isArray(events)) continue;
      for (const e of events) {
        const fixed = objet(e)?.fixed;
        if (typeof fixed !== 'string' || comparerVersions(fixed, d.version) <= 0) continue;
        if (meilleure === null || comparerVersions(fixed, meilleure) < 0) meilleure = fixed;
      }
    }
  }
  return meilleure;
}

// --- Réseau ---------------------------------------------------------------------------------

/** Un appel JSON à OSV avec délai de 15 s ; null si échec, non 2xx, coupé ou illisible. */
async function appeler(f: typeof fetch, chemin: string, corps: unknown, fin?: AbortSignal): Promise<unknown> {
  if (fin?.aborted) return null;
  const signal = fin ? AbortSignal.any([AbortSignal.timeout(DELAI_MS), fin]) : AbortSignal.timeout(DELAI_MS);
  try {
    const r = await f(`${OSV}${chemin}`, corps === undefined ? { signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps), signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const cleDep = (d: Dependance) => `${d.ecosysteme}\u0000${d.nom}\u0000${d.version}`;
const ids = (x: unknown): string[] => (Array.isArray(x) ? x.flatMap((v) => (typeof objet(v)?.id === 'string' ? [objet(v)!.id as string] : [])) : []);

/**
 * Les failles connues de ces dépendances. Null si OSV est injoignable, coupé ou incomplet : on ne dit jamais « aucune faille » sans l'avoir lu.
 * `fin` est l'échéance commune du tour : une fois passée, plus aucun appel ne part.
 */
export async function chercherFailles(deps: Dependance[], f: typeof fetch, fin?: AbortSignal): Promise<Faille[] | null> {
  // Une entrée par (écosystème, paquet, version) ; « direct de production » si l'une des occurrences l'est.
  const uniques = new Map<string, Dependance>();
  for (const d of deps) {
    const k = cleDep(d);
    const deja = uniques.get(k);
    uniques.set(k, deja ? { ...deja, directeProd: deja.directeProd || d.directeProd } : d);
  }
  const liste = [...uniques.values()];
  if (liste.length === 0) return [];
  if (fin?.aborted) return null;

  // 1. Les identifiants de failles de chaque dépendance (lots de 1000).
  const idsParDep: string[][] = [];
  for (let debut = 0; debut < liste.length; debut += TAILLE_LOT) {
    const lot = liste.slice(debut, debut + TAILLE_LOT);
    const rep = objet(await appeler(f, '/v1/querybatch', { queries: lot.map((d) => ({ package: { name: d.nom, ecosystem: d.ecosysteme }, version: d.version })) }, fin));
    const resultats = rep?.results;
    if (!Array.isArray(resultats) || resultats.length !== lot.length) return null;
    for (let i = 0; i < lot.length; i++) {
      const res = objet(resultats[i]);
      const trouves = ids(res?.vulns);
      let page = typeof res?.next_page_token === 'string' ? res.next_page_token : null;
      for (let n = 0; page; n++) {
        if (n >= PAGES_MAX) return null;
        const suite = objet(await appeler(f, '/v1/query', { package: { name: lot[i].nom, ecosystem: lot[i].ecosysteme }, version: lot[i].version, page_token: page }, fin));
        if (!suite) return null;
        trouves.push(...ids(suite.vulns));
        page = typeof suite.next_page_token === 'string' ? suite.next_page_token : null;
      }
      idsParDep.push(trouves);
    }
  }

  // 2. Le détail de chaque identifiant, une seule fois, quelques-uns à la fois.
  const aLire = [...new Set(idsParDep.flat())];
  const details = new Map<string, unknown>();
  let echec = false;
  let suivant = 0;
  const travailleur = async () => {
    while (!echec) {
      const id = aLire[suivant++];
      if (id === undefined) return;
      const d = await appeler(f, `/v1/vulns/${encodeURIComponent(id)}`, undefined, fin);
      if (!objet(d)) { echec = true; return; }
      details.set(id, d);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLELE, aLire.length) }, travailleur));
  if (echec) return null;

  // 3. Une faille par (paquet, version, id).
  const failles: Faille[] = [];
  liste.forEach((d, i) => {
    for (const id of new Set(idsParDep[i])) {
      const v = details.get(id);
      const resume = objet(v)?.summary;
      failles.push({
        id, paquet: d.nom, version: d.version, gravite: graviteOSV(v), corrigeeEn: corrigeeEn(v, d),
        directeProd: d.directeProd, resume: typeof resume === 'string' ? resume.slice(0, RESUME_MAX) : '',
      });
    }
  });
  return failles;
}
