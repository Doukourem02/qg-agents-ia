// Ye parle à Sanity (le portfolio) par l'API HTTP, avec un `fetch` injecté : lire les fiches et les compétences, savoir
// si un brouillon est en cours, et — seulement après « Valider » — un unique patch avec ifRevisionID.
// Projet et dataset ne sont pas secrets (ils sont dans les adresses des images du portfolio). La clé
// SANITY_ECRITURE_PORTFOLIO (rôle Editor) ne part que vers api.sanity.io et n'est jamais journalisée.

import { PORTFOLIO_EN_LIGNE } from './etiquette';

export const PROJET_SANITY = 'abcd1234';
export const DATASET = 'production';
const VERSION = 'v2025-10-01';
const HOTE = `https://${PROJET_SANITY}.api.sanity.io/${VERSION}/data`;
const DELAI_MS = 15_000;
/** Le portfolio en ligne (aussi suivi par Luffy) et son Studio, où le patron crée lui-même une compétence. */
export const PORTFOLIO = PORTFOLIO_EN_LIGNE;
export const STUDIO = `${PORTFOLIO}/studio`;

type Recup = typeof fetch;
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const texte = (v: unknown) => (typeof v === 'string' ? v : '');

export type FicheBrute = {
  id: string; rev: string; title: string; kind: string; kindEn: string; status: string; description: string; descriptionEn: string;
  liveUrl: string; githubUrl: string; technologies: { _key: string; _ref: string }[]; order: number | null;
};
export type Portfolio = { fiches: FicheBrute[]; competences: { id: string; name: string }[]; brouillons: string[] };

const REQUETE = `{
  "fiches": *[_type == "project" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))]{ _id, _rev, title, kind, kindEn, status, description, descriptionEn, liveUrl, githubUrl, order, "technologies": coalesce(technologies[]{ _key, _ref }, []) },
  "competences": *[_type == "skill" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))]{ _id, name },
  "brouillons": *[_type == "project" && (_id in path("drafts.**") || _id in path("versions.**"))]._id
}`;

const entetes = (jeton: string | undefined): Record<string, string> => (jeton ? { Authorization: `Bearer ${jeton}` } : {});

async function requete(f: Recup, groq: string, jeton: string | undefined, params: Record<string, string> = {}): Promise<unknown> {
  const p = Object.entries(params).map(([k, v]) => `&${encodeURIComponent('$' + k)}=${encodeURIComponent(JSON.stringify(v))}`).join('');
  try {
    const r = await f(`${HOTE}/query/${DATASET}?query=${encodeURIComponent(groq)}&perspective=raw${p}`, { headers: entetes(jeton), signal: AbortSignal.timeout(DELAI_MS) });
    if (!r.ok) {
      // le code seulement (jamais la clé) : distinguer « clé refusée » (401/403) de « Sanity en panne » (5xx)
      console.error(`Ye : Sanity a répondu ${r.status} à la lecture`);
      return null;
    }
    return obj(await r.json())?.result ?? null;
  } catch {
    return null;
  }
}

/** Les fiches publiées, les compétences et les brouillons de fiches en cours. Null si Sanity ne répond pas. */
export async function lirePortfolio(f: Recup, jeton: string | undefined): Promise<Portfolio | null> {
  const r = obj(await requete(f, REQUETE, jeton));
  if (!r || !Array.isArray(r.fiches) || !Array.isArray(r.competences)) return null;
  const fiches = r.fiches.flatMap((x): FicheBrute[] => {
    const o = obj(x);
    if (!o || typeof o._id !== 'string' || typeof o._rev !== 'string') return [];
    const tech = Array.isArray(o.technologies) ? o.technologies.flatMap(t => { const q = obj(t); return q && typeof q._ref === 'string' ? [{ _key: texte(q._key), _ref: q._ref }] : []; }) : [];
    return [{
      id: o._id, rev: o._rev, title: texte(o.title), kind: texte(o.kind), kindEn: texte(o.kindEn), status: texte(o.status),
      description: texte(o.description), descriptionEn: texte(o.descriptionEn), liveUrl: texte(o.liveUrl), githubUrl: texte(o.githubUrl), technologies: tech,
      order: typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : null,
    }];
  });
  const competences = r.competences.flatMap(x => { const o = obj(x); return o && typeof o._id === 'string' && typeof o.name === 'string' ? [{ id: o._id, name: o.name }] : []; });
  const brouillons = Array.isArray(r.brouillons) ? r.brouillons.filter((x): x is string => typeof x === 'string') : [];
  return { fiches, competences, brouillons };
}

/**
 * Vrai si le patron a un brouillon de cette fiche en cours dans le Studio, ou une version dans une release
 * (`versions.<release>.<id>`) ; null si Sanity ne répond pas.
 */
export async function brouillonEnCours(f: Recup, jeton: string, id: string): Promise<boolean | null> {
  const r = await requete(f, '{ "id": *[_id == $id || _id in path($versions)][0]._id }', jeton, { id: `drafts.${id}`, versions: `versions.*.${id}` });
  const o = obj(r);
  return o ? typeof o.id === 'string' : null;
}

/** `inconnu` : la demande est partie mais la réponse manque (délai, coupure, 5xx) — le patch a pu se faire. */
export type Publie = { etat: 'ok' } | { etat: 'conflit' } | { etat: 'erreur' } | { etat: 'inconnu' };

/**
 * L'unique écriture de Ye : un patch `set` sur la fiche publiée, avec ifRevisionID = la révision lue. Sanity répond
 * 409 si la fiche a changé depuis : rien n'est écrit.
 */
export async function patcherFiche(f: Recup, jeton: string, id: string, rev: string, set: Record<string, unknown>): Promise<Publie> {
  try {
    const r = await f(`${HOTE}/mutate/${DATASET}?returnIds=true&visibility=sync`, {
      method: 'POST',
      headers: { ...entetes(jeton), 'content-type': 'application/json' },
      body: JSON.stringify({ mutations: [{ patch: { id, ifRevisionID: rev, set } }] }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (r.status === 409) return { etat: 'conflit' };
    if (r.status >= 500) return { etat: 'inconnu' };
    return r.ok ? { etat: 'ok' } : { etat: 'erreur' };
  } catch {
    return { etat: 'inconnu' };
  }
}

/** « https://github.com/Compte/Nom(.git)(/) » → « Compte/Nom » ; null pour tout autre lien. */
export function depotDeLien(lien: string): string | null {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(lien.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

// --- Créer une fiche (après « Ajouter » seulement) ------------------------------------------------------------------

const HOTE_IMAGES = `https://${PROJET_SANITY}.api.sanity.io/${VERSION}/assets/images/${DATASET}`;
const DELAI_IMAGE_MS = 60_000;

/** Envoie une image à Sanity ; rend l'identifiant de l'asset, ou null. Sanity dédoublonne : renvoyer la même image rend le même asset. */
export async function televerserImage(f: Recup, jeton: string, nom: string, octets: ArrayBuffer, type: string): Promise<string | null> {
  try {
    const r = await f(`${HOTE_IMAGES}?filename=${encodeURIComponent(nom)}`, {
      method: 'POST', headers: { ...entetes(jeton), 'content-type': type }, body: octets, signal: AbortSignal.timeout(DELAI_IMAGE_MS),
    });
    if (!r.ok) { console.error(`Ye : Sanity a répondu ${r.status} à l'envoi d'une image`); return null; }
    const id = obj(obj(await r.json())?.document)?._id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/** Le plus grand `order` des fiches publiées (null si aucune ou si Sanity ne répond pas). */
export async function dernierOrdre(f: Recup, jeton: string): Promise<number | null> {
  const r = obj(await requete(f, '{ "o": *[_type == "project" && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && defined(order)] | order(order desc)[0].order }', jeton));
  return r && typeof r.o === 'number' && Number.isFinite(r.o) ? r.o : null;
}

/** Le titre du document `id` ou de son brouillon (pour reconnaître une création déjà faite) ; undefined si aucun, null si Sanity ne répond pas. */
export async function titreExistant(f: Recup, jeton: string, id: string): Promise<string | undefined | null> {
  const r = obj(await requete(f, '{ "d": *[_id == $id || _id == $brouillon][0]{ title } }', jeton, { id, brouillon: `drafts.${id}` }));
  if (!r) return null;
  const d = obj(r.d);
  return d ? texte(d.title) : undefined;
}

/** L'unique création de Ye : `create` (jamais createOrReplace) ; 409 si l'identifiant existe déjà : rien n'est écrasé. */
export async function creerDocument(f: Recup, jeton: string, doc: Record<string, unknown>): Promise<Publie> {
  try {
    const r = await f(`${HOTE}/mutate/${DATASET}?returnIds=true&visibility=sync`, {
      method: 'POST',
      headers: { ...entetes(jeton), 'content-type': 'application/json' },
      body: JSON.stringify({ mutations: [{ create: doc }] }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (r.status === 409) return { etat: 'conflit' };
    if (r.status >= 500) return { etat: 'inconnu' };
    return r.ok ? { etat: 'ok' } : { etat: 'erreur' };
  } catch {
    return { etat: 'inconnu' };
  }
}
