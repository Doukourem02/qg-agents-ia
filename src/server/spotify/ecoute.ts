import type { KV } from '../memoire';
import { basic, CLE_CONNEXION, DELAI_MS, enregistrerJetons, JETON, lireJetons, lireJetonsGardes, type App, type Fetch, type Jetons } from './connexion';

// Ce que j'écoute sur mon vrai Spotify, pour la page. Seule cette vue sort du serveur : jamais de jeton.
// Le résultat est gardé 10 s dans Upstash, pour que plusieurs onglets ouverts ne sollicitent pas Spotify à chaque fois.

export type EnCours = {
  id: string;
  titre: string;
  artistes: string;
  album: string;
  /** La plus petite pochette d'au moins 64 px, en https ; chaîne vide s'il n'y en a pas. */
  pochette: string;
  dureeMs: number;
  progressionMs: number;
  joue: boolean;
  /** L'heure (serveur) à laquelle `progressionMs` a été mesurée. */
  quand: number;
};
export type VueEcoute = { connecte: boolean; enCours: EnCours | null };

export const CLE_CACHE = 'spotify:ecoute';
const CHAMP = 'vue';
export const CACHE_MS = 10_000;
/** Au-delà, une vue gardée n'est plus montrée quand Spotify ne répond pas. */
export const PERIME_MS = 120_000;
export const CLE_VERROU = 'spotify:rafraichit';
const VERROU_S = 15;
const LECTEUR = 'https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode';
/** On rafraîchit le jeton d'accès un peu avant son expiration. */
const MARGE_MS = 30_000;

const DECONNECTE: VueEcoute = { connecte: false, enCours: null };

type Image = { url?: unknown; width?: unknown };

/** La plus petite image d'au moins 64 px (ou sans largeur connue, en dernier recours), en https. */
export function pochette(images: unknown): string {
  if (!Array.isArray(images)) return '';
  const ok = (images as Image[]).filter((i): i is { url: string; width?: unknown } => typeof i?.url === 'string' && i.url.startsWith('https://'));
  const mesurees = ok.filter(i => typeof i.width === 'number' && i.width >= 64).sort((a, b) => (a.width as number) - (b.width as number));
  return mesurees[0]?.url ?? ok.find(i => typeof i.width !== 'number')?.url ?? '';
}

const txt = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const nb = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

/** La réponse de /me/player/currently-playing → ce que la page affiche. Seuls les morceaux et les épisodes comptent. */
export function versEnCours(d: unknown, now: number): EnCours | null {
  const r = d as { is_playing?: unknown; progress_ms?: unknown; item?: Record<string, unknown> | null } | null;
  const it = r?.item;
  if (!it || typeof it !== 'object') return null;
  const commun = { dureeMs: nb(it.duration_ms), progressionMs: nb(r.progress_ms), joue: r.is_playing === true, quand: now };
  const id = txt(it.id, 100) || txt(it.uri, 200) || txt(it.name);
  if (!id) return null;
  if (it.type === 'track') {
    const artistes = Array.isArray(it.artists) ? (it.artists as { name?: unknown }[]).map(a => txt(a?.name)).filter(Boolean).join(', ') : '';
    const album = it.album as { name?: unknown; images?: unknown } | undefined;
    return { id, titre: txt(it.name), artistes, album: txt(album?.name), pochette: pochette(album?.images), ...commun };
  }
  if (it.type === 'episode') {
    const show = it.show as { name?: unknown; images?: unknown } | undefined;
    return { id, titre: txt(it.name), artistes: txt(show?.name), album: txt(show?.name), pochette: pochette(it.images) || pochette(show?.images), ...commun };
  }
  return null;
}

type Cache = { vue: VueEcoute; quand: number };

async function lireCache(kv: KV): Promise<Cache | null> {
  const s = (await kv.hgetall(CLE_CACHE))[CHAMP];
  if (!s) return null;
  try {
    const c = JSON.parse(s) as Cache;
    return typeof c.quand === 'number' && c.vue && typeof c.vue.connecte === 'boolean' ? c : null;
  } catch { return null; }
}

/** La vue gardée, avec la progression avancée du temps écoulé (si le morceau joue). */
function avancer(c: Cache, now: number): VueEcoute {
  const e = c.vue.enCours;
  if (!e || !e.joue) return c.vue;
  const ecoule = Math.max(0, now - e.quand);
  return { connecte: c.vue.connecte, enCours: { ...e, progressionMs: Math.min(e.dureeMs || Infinity, e.progressionMs + ecoule), quand: now } };
}

async function garder(kv: KV, vue: VueEcoute, now: number) {
  await kv.hset(CLE_CACHE, CHAMP, JSON.stringify({ vue, quand: now } satisfies Cache));
}

/** Oublie la connexion (Spotify refuse nos jetons) : la page propose alors « Connecter Spotify ». */
export async function oublierSpotify(kv: KV) {
  await kv.del(CLE_CONNEXION);
  await kv.del(CLE_CACHE);
}

type Rafraichi = { jetons: Jetons } | { refuse: true } | { injoignable: true };

async function rafraichir(j: Jetons, app: App, f: Fetch, now: number): Promise<Rafraichi> {
  let r: Response;
  try {
    r = await f(JETON, {
      method: 'POST',
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { authorization: basic(app), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: j.refresh_token }).toString(),
    });
  } catch { return { injoignable: true }; }
  // 400 (invalid_grant) ou 401 : l'autorisation a été retirée ou l'application a changé
  if (r.status === 400 || r.status === 401) return { refuse: true };
  if (!r.ok) return { injoignable: true };
  const n = await lireJetons(r, now, j.refresh_token);
  return n ? { jetons: n } : { injoignable: true };
}

/**
 * Ce que j'écoute en ce moment. Rafraîchit le jeton d'accès s'il a expiré (et garde le nouveau jeton de
 * rafraîchissement si Spotify en renvoie un). 204 : rien en cours. 401 après un rafraîchissement : déconnecté.
 * 429 ou panne : la dernière vue gardée. Ne lève que si le stockage lui-même est en panne.
 */
export async function lireEcoute(kv: KV, deps: App & { fetch?: Fetch }, now = Date.now()): Promise<VueEcoute> {
  const f = deps.fetch ?? fetch;
  let j = await lireJetonsGardes(kv, deps.secret);
  if (!j) return DECONNECTE;
  const cache = await lireCache(kv);
  if (cache && cache.vue.connecte && now - cache.quand >= 0 && now - cache.quand < CACHE_MS) return avancer(cache, now);
  // Spotify en panne ou 429 : la dernière vue gardée, mais pas indéfiniment (au-delà de 2 min, plus rien en cours)
  const repli = (): VueEcoute =>
    (cache?.vue.connecte && now - cache.quand <= PERIME_MS ? avancer(cache, now) : { connecte: true, enCours: null });

  let rafraichi = false;
  /** D'autres jetons que les nôtres ont été enregistrés entre-temps (un autre onglet ou une autre instance a rafraîchi). */
  const autresJetons = (g: Jetons | null): g is Jetons => !!g && (g.refresh_token !== j!.refresh_token || g.expire !== j!.expire || g.access_token !== j!.access_token);
  const renouveler = async (): Promise<'ok' | 'refuse' | 'injoignable'> => {
    // un seul rafraîchissement à la fois : si Spotify fait tourner le jeton de rafraîchissement, le perdant
    // d'une course recevrait invalid_grant et effacerait une connexion pourtant valide
    if (!(await kv.setnx(CLE_VERROU, '1', VERROU_S))) {
      const g = await lireJetonsGardes(kv, deps.secret);
      if (autresJetons(g) && g.expire - MARGE_MS > now) { j = g; rafraichi = true; return 'ok'; }
      return 'injoignable';
    }
    try {
      const depart = j!.refresh_token;
      const r = await rafraichir(j!, deps, f, now);
      if ('injoignable' in r) return 'injoignable';
      const g = await lireJetonsGardes(kv, deps.secret);
      if ('refuse' in r) {
        // refusé, mais quelqu'un a rafraîchi entre-temps : on prend ses jetons, sans déconnecter
        if (autresJetons(g)) { j = g; rafraichi = true; return 'ok'; }
        return 'refuse';
      }
      j = r.jetons;
      rafraichi = true;
      // n'écrase jamais des jetons plus récents par les nôtres
      if (!g || g.refresh_token === depart) await enregistrerJetons(kv, j, deps.secret, now);
      return 'ok';
    } finally {
      await kv.del(CLE_VERROU);
    }
  };

  if (j.expire - MARGE_MS <= now) {
    const r = await renouveler();
    if (r === 'refuse') { await oublierSpotify(kv); return DECONNECTE; }
    if (r === 'injoignable') return repli();
  }

  for (;;) {
    let r: Response;
    try { r = await f(LECTEUR, { headers: { authorization: `Bearer ${j.access_token}` }, signal: AbortSignal.timeout(DELAI_MS) }); }
    catch { return repli(); }
    if (r.status === 401) {
      if (rafraichi) { await oublierSpotify(kv); return DECONNECTE; }
      const n = await renouveler();
      if (n === 'refuse') { await oublierSpotify(kv); return DECONNECTE; }
      if (n === 'injoignable') return repli();
      continue;
    }
    if (r.status === 429 || !(r.ok || r.status === 204)) return repli();
    const enCours = r.status === 204 ? null : versEnCours(await r.json().catch(() => null), now);
    const vue: VueEcoute = { connecte: true, enCours };
    await garder(kv, vue, now);
    return vue;
  }
}
