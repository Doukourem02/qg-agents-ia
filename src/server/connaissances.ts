import type { KV } from './memoire';
import { Refus } from './qg';
import { AGENTS } from '@/sim/routing';
import FICHIER from '@/data/connaissances.json';

// Ce que Kuroro sait du projet et des personnages (Notion + le projet), injecté dans son prompt avec les faits en direct.
// La version du dépôt (src/data/connaissances.json) sert de base ; la routine hebdomadaire de Kuroro en envoie une
// plus fraîche (POST /api/agents/connaissances, scripts/connaissances.mjs), rangée dans KV et lue en priorité.
// Jamais d'adresse web, de mail ni de numéro : c'est lu par un petit modèle et répété au patron.

export type Personnage = { id: string; nom: string; statut: string; role: string } & Partial<Record<ChampPersonnage, string>>;
export type Connaissances = { projet: Record<string, string | string[]>; personnages: Personnage[] };

export const CLE_CONNAISSANCES = 'qg:connaissances';
/** Au-delà, le prompt du modèle local devient trop lourd. */
export const MAX_CONNAISSANCES = 8_000;
const MAX_CHAMP = 400;
const MAX_LISTE = 10;
const MAX_CLES_PROJET = 12;
export const CHAMPS_PERSONNAGE = ['clin', 'statut', 'role', 'routine', 'fait', 'parler', 'interdit', 'ou'] as const;
type ChampPersonnage = (typeof CHAMPS_PERSONNAGE)[number];

const URL_OU_DOMAINE = /https?:\/\/|www\.|\b[\w-]+\.(?:com|fr|ci|io|app|dev|net|org|so|ai|co)\b/i;
const NUMERO = /(?:\d[\s.-]?){9,}/;

function texte(v: unknown, ou: string): string {
  const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!t) throw new Refus(`« ${ou} » : texte attendu`);
  if (t.length > MAX_CHAMP) throw new Refus(`« ${ou} » trop long (${MAX_CHAMP} caractères au plus)`);
  if (t.includes('@')) throw new Refus(`« ${ou} » : pas de mail`);
  if (URL_OU_DOMAINE.test(t)) throw new Refus(`« ${ou} » : pas d'adresse web`);
  if (NUMERO.test(t)) throw new Refus(`« ${ou} » : pas de numéro`);
  return t;
}

const objet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Les connaissances vérifiées et nettoyées, ou un refus (422) qui dit ce qui ne va pas. */
export function connaissancesValides(v: unknown): Connaissances {
  if (!objet(v)) throw new Refus('objet attendu');
  const { projet, personnages } = v;
  if (!objet(projet)) throw new Refus('« projet » : objet attendu');
  const cles = Object.keys(projet);
  if (!cles.length || cles.length > MAX_CLES_PROJET) throw new Refus(`« projet » : 1 à ${MAX_CLES_PROJET} rubriques`);
  const p: Connaissances['projet'] = {};
  for (const k of cles) {
    if (!/^[a-z_]{1,30}$/.test(k)) throw new Refus(`« projet.${k} » : nom de rubrique invalide`);
    const val = projet[k];
    if (Array.isArray(val)) {
      if (!val.length || val.length > MAX_LISTE) throw new Refus(`« projet.${k} » : 1 à ${MAX_LISTE} lignes`);
      p[k] = val.map((x, i) => texte(x, `projet.${k}[${i}]`));
    } else p[k] = texte(val, `projet.${k}`);
  }
  if (!Array.isArray(personnages)) throw new Refus('« personnages » : liste attendue');
  const vus = new Set<string>();
  const liste = personnages.map((x, i): Personnage => {
    if (!objet(x)) throw new Refus(`« personnages[${i}] » : objet attendu`);
    const id = x.id;
    if (typeof id !== 'string' || !AGENTS.some(a => a.id === id)) throw new Refus(`« personnages[${i}].id » inconnu`);
    if (vus.has(id)) throw new Refus(`« ${id} » en double`);
    vus.add(id);
    for (const k of Object.keys(x)) if (k !== 'id' && k !== 'nom' && !(CHAMPS_PERSONNAGE as readonly string[]).includes(k)) throw new Refus(`« ${id}.${k} » : champ inconnu`);
    const fiche: Personnage = { id, nom: texte(x.nom, `${id}.nom`), statut: texte(x.statut, `${id}.statut`), role: texte(x.role, `${id}.role`) };
    for (const k of CHAMPS_PERSONNAGE) if (x[k] !== undefined && k !== 'statut' && k !== 'role') fiche[k] = texte(x[k], `${id}.${k}`);
    return fiche;
  });
  const manquants = AGENTS.filter(a => !vus.has(a.id)).map(a => a.id);
  if (manquants.length) throw new Refus(`personnages manquants : ${manquants.join(', ')}`);
  const c = { projet: p, personnages: liste };
  const taille = JSON.stringify(c).length;
  if (taille > MAX_CONNAISSANCES) throw new Refus(`trop long : ${taille} caractères (${MAX_CONNAISSANCES} au plus)`);
  return c;
}

/** La version du dépôt, vérifiée une fois. */
export const CONNAISSANCES_DEPOT: Connaissances = connaissancesValides(FICHIER);

/** La routine hebdomadaire : remplace la version de KV. */
export async function enregistrerConnaissances(kv: KV, corps: unknown, now = Date.now()) {
  const c = connaissancesValides(corps);
  await kv.hset(CLE_CONNAISSANCES, 'json', JSON.stringify(c));
  await kv.hset(CLE_CONNAISSANCES, 'quand', String(now));
  return { ok: true, personnages: c.personnages.length, caracteres: JSON.stringify(c).length };
}

/** La version de KV si elle existe et reste valide, sinon celle du dépôt. Jamais d'erreur : Kuroro doit pouvoir répondre. */
export async function lireConnaissances(kv: KV): Promise<Connaissances> {
  try {
    const brut = (await kv.hmget(CLE_CONNAISSANCES, ['json'])).json;
    if (brut) return connaissancesValides(JSON.parse(brut));
  } catch { /* version KV abîmée ou KV injoignable : celle du dépôt */ }
  return CONNAISSANCES_DEPOT;
}
