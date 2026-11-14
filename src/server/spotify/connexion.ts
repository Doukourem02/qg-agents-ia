import { randomBytes } from 'node:crypto';
import { chiffrer, dechiffrer } from '../chiffre';
import type { KV } from '../memoire';

// La connexion Spotify du QG (OAuth, « Authorization Code ») : un `state` à usage unique contre les faux retours,
// et les jetons gardés chiffrés (AES-256-GCM, clé = SHA-256 du secret de l'application) dans Upstash.
// Aucun jeton ni secret n'est journalisé, affiché ou renvoyé à la page.

export const URL_CONNEXION = 'https://mon-qg.vercel.app/api/spotify/connexion';
export const REDIRECTION = 'https://mon-qg.vercel.app/api/spotify/retour';
export const PORTEE = 'user-read-currently-playing user-read-playback-state';
export const AUTORISATION = 'https://accounts.spotify.com/authorize';
export const JETON = 'https://accounts.spotify.com/api/token';
export const DELAI_MS = 10_000;

export type Fetch = typeof fetch;
export type App = { clientId: string; secret: string };

const cleEtat = (etat: string) => `spotify:etat:${etat}`;
export const CLE_CONNEXION = 'spotify:connexion';
const CHAMP = 'actuelle';
const VALIDITE_ETAT_S = 600;
const VALIDITE_ETAT_MS = VALIDITE_ETAT_S * 1000;

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
  return kv.setnx(`spotify:etat-pris:${etat}`, '1', 3600);
}

/** L'adresse où m'envoyer pour que j'autorise le QG à lire ce que j'écoute. */
export function urlAutorisation(clientId: string, etat: string) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECTION, state: etat, scope: PORTEE });
  return `${AUTORISATION}?${q}`;
}

export const basic = (app: App) => `Basic ${Buffer.from(`${app.clientId}:${app.secret}`).toString('base64')}`;

/** Les jetons Spotify, tels qu'ils sont gardés (chiffrés) : `expire` est l'heure d'expiration du jeton d'accès. */
export type Jetons = { refresh_token: string; access_token: string; expire: number };

/** Lit la réponse de accounts.spotify.com/api/token ; `refreshPrecedent` sert quand Spotify n'en renvoie pas de nouveau. */
export async function lireJetons(r: Response, now: number, refreshPrecedent?: string): Promise<Jetons | null> {
  const d = await r.json().catch(() => null) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null;
  if (typeof d?.access_token !== 'string' || typeof d.expires_in !== 'number') return null;
  const refresh = typeof d.refresh_token === 'string' && d.refresh_token ? d.refresh_token : refreshPrecedent;
  if (!refresh) return null;
  return { access_token: d.access_token, refresh_token: refresh, expire: now + d.expires_in * 1000 };
}

/** Échange le code reçu au retour contre les jetons ; lève sans jamais citer de jeton ni de secret. */
export async function echangerCode(code: string, app: App, f: Fetch = fetch, now = Date.now()): Promise<Jetons> {
  let r: Response;
  try {
    r = await f(JETON, {
      method: 'POST',
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { authorization: basic(app), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECTION }).toString(),
    });
  } catch { throw new Error('Spotify injoignable (échange du code)'); }
  if (!r.ok) throw new Error(`Spotify a refusé l'échange du code (${r.status})`);
  const j = await lireJetons(r, now);
  if (!j) throw new Error('Spotify : réponse inattendue (jetons)');
  return j;
}

export async function enregistrerJetons(kv: KV, j: Jetons, secret: string, now = Date.now()) {
  await kv.hset(CLE_CONNEXION, CHAMP, JSON.stringify({ chiffre: chiffrer(JSON.stringify(j), secret), quand: now }));
}

/** Les jetons déchiffrés ; null si absents ou illisibles avec ce secret. */
export async function lireJetonsGardes(kv: KV, secret: string): Promise<Jetons | null> {
  const s = (await kv.hgetall(CLE_CONNEXION))[CHAMP];
  if (!s) return null;
  try {
    const b = JSON.parse(s) as { chiffre?: unknown };
    if (typeof b.chiffre !== 'string') return null;
    const j = JSON.parse(dechiffrer(b.chiffre, secret)) as Jetons;
    return typeof j.refresh_token === 'string' && typeof j.access_token === 'string' && typeof j.expire === 'number' ? j : null;
  } catch { return null; }
}

/** Le retour de Spotify : vérifie l'état, échange le code, enregistre les jetons chiffrés. Ne lève jamais. */
export async function traiterRetour(
  kv: KV,
  q: { code?: string | null; state?: string | null; error?: string | null },
  deps: App & { fetch?: Fetch },
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; raison: string }> {
  if (q.error) {
    // le code d'erreur de Spotify (ex. « access_denied »), réduit à des lettres
    const code = q.error.replace(/[^a-z_]/gi, '').slice(0, 60);
    return { ok: false, raison: `Spotify a refusé ou annulé la connexion${code ? ` (${code})` : ''}` };
  }
  if (!q.state || !q.code) return { ok: false, raison: 'retour incomplet' };
  if (!(await consommerEtat(kv, q.state, now))) return { ok: false, raison: 'demande inconnue, périmée ou déjà utilisée' };
  let j: Jetons;
  try { j = await echangerCode(q.code, deps, deps.fetch ?? fetch, now); }
  catch { return { ok: false, raison: "Spotify n'a pas accepté le code" }; }
  try { await enregistrerJetons(kv, j, deps.secret, now); }
  catch { return { ok: false, raison: "la connexion n'a pas pu être enregistrée" }; }
  return { ok: true };
}
