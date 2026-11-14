import { randomBytes } from 'node:crypto';
import { chiffrer, dechiffrer } from '../chiffre';
import type { KV } from '../memoire';
import type { echangerCode, lireProfil } from './api';

// La connexion LinkedIn du QG : un `state` à usage unique contre les faux retours, et le jeton gardé chiffré
// (AES-256-GCM) dans Upstash. Le jeton n'est ni journalisé ni affiché.

export const URL_CONNEXION = 'https://mon-qg.vercel.app/api/linkedin/connexion';
export const RAPPEL_JOURS = 7;

const cleEtat = (etat: string) => `linkedin:etat:${etat}`;
export const CLE_CONNEXION = 'linkedin:connexion';
const CHAMP = 'actuelle';
const VALIDITE_ETAT_S = 600;
const VALIDITE_ETAT_MS = VALIDITE_ETAT_S * 1000;
const JOUR_MS = 24 * 3600 * 1000;

/** Un état aléatoire (32 caractères hexadécimaux), valable 10 minutes : une clé par état, qui s'efface seule. */
export async function nouvelEtat(kv: KV, now = Date.now()) {
  const etat = randomBytes(16).toString('hex');
  if (!(await kv.setnx(cleEtat(etat), String(now), VALIDITE_ETAT_S))) throw new Error('état déjà pris');
  return etat;
}

/** Vrai une seule fois pour un état connu et récent (le second `setnx` est atomique : un seul retour gagne). */
export async function consommerEtat(kv: KV, etat: string, now = Date.now()) {
  if (!/^[0-9a-f]{32}$/.test(etat)) return false;
  const quand = Number(await kv.get(cleEtat(etat)));
  if (!Number.isFinite(quand) || quand <= 0 || now - quand > VALIDITE_ETAT_MS) return false;
  return kv.setnx(`linkedin:etat-pris:${etat}`, '1', 3600);
}

export type Connexion = { jeton: string; auteur: string; nom: string; expire: number };

export async function enregistrerConnexion(
  kv: KV,
  c: { jeton: string; expireDans: number; auteur: string; nom: string },
  secret: string,
  now = Date.now(),
): Promise<Connexion> {
  const expire = now + c.expireDans * 1000;
  await kv.hset(CLE_CONNEXION, CHAMP, JSON.stringify({ jetonChiffre: chiffrer(c.jeton, secret), auteur: c.auteur, nom: c.nom, expire, quand: now }));
  return { jeton: c.jeton, auteur: c.auteur, nom: c.nom, expire };
}

type Brut = { jetonChiffre: string; auteur: string; nom: string; expire: number };

async function lireBrut(kv: KV): Promise<Brut | null> {
  const s = (await kv.hgetall(CLE_CONNEXION))[CHAMP];
  if (!s) return null;
  try {
    const b = JSON.parse(s) as Brut;
    return typeof b.jetonChiffre === 'string' && typeof b.expire === 'number' ? b : null;
  } catch { return null; }
}

/** La connexion en cours, jeton déchiffré ; null si absente, expirée, ou illisible avec ce secret. */
export async function lireConnexion(kv: KV, secret: string | undefined, now = Date.now()): Promise<Connexion | null> {
  if (!secret) return null;
  const b = await lireBrut(kv);
  if (!b || b.expire <= now) return null;
  try { return { jeton: dechiffrer(b.jetonChiffre, secret), auteur: b.auteur, nom: b.nom, expire: b.expire }; }
  catch { return null; }
}

/** Oublie la connexion (jeton refusé par LinkedIn) : les rappels de reconnexion apparaissent alors. */
export const oublierConnexion = (kv: KV) => kv.del(CLE_CONNEXION);

/** L'état de la connexion, sans jamais toucher au jeton. */
export async function statutLinkedIn(kv: KV, now = Date.now()): Promise<{ connecte: boolean; nom?: string; expire?: number; joursRestants?: number }> {
  const b = await lireBrut(kv);
  if (!b) return { connecte: false };
  if (b.expire <= now) return { connecte: false, nom: b.nom, expire: b.expire };
  return { connecte: true, nom: b.nom, expire: b.expire, joursRestants: Math.floor((b.expire - now) / JOUR_MS) };
}

/** Le retour de LinkedIn : vérifie l'état, échange le code, lit le profil, enregistre. Ne lève jamais. */
export async function traiterRetour(
  kv: KV,
  q: { code?: string | null; state?: string | null; error?: string | null },
  deps: { clientId: string; secret: string; echanger: typeof echangerCode; profil: typeof lireProfil },
  now = Date.now(),
): Promise<{ ok: true; connexion: Connexion } | { ok: false; raison: string }> {
  if (q.error) {
    // le code d'erreur de LinkedIn (ex. « unauthorized_scope_error »), réduit à des lettres : utile pour comprendre
    const code = q.error.replace(/[^a-z_]/gi, '').slice(0, 60);
    return { ok: false, raison: `LinkedIn a refusé ou annulé la connexion${code ? ` (${code})` : ''}` };
  }
  if (!q.state || !q.code) return { ok: false, raison: 'retour incomplet' };
  if (!(await consommerEtat(kv, q.state, now))) return { ok: false, raison: 'demande inconnue, périmée ou déjà utilisée' };
  let jeton: { jeton: string; expireDans: number };
  try { jeton = await deps.echanger(q.code, { clientId: deps.clientId, secret: deps.secret }); }
  catch { return { ok: false, raison: "LinkedIn n'a pas accepté le code" }; }
  let profil: { auteur: string; nom: string };
  try { profil = await deps.profil(jeton.jeton); }
  catch { return { ok: false, raison: 'le profil LinkedIn est illisible' }; }
  try {
    return { ok: true, connexion: await enregistrerConnexion(kv, { ...jeton, ...profil }, deps.secret, now) };
  } catch { return { ok: false, raison: "la connexion n'a pas pu être enregistrée" }; }
}
