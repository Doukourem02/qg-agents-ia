import { describe, expect, it } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLE_CONNEXION, consommerEtat, enregistrerJetons, lireJetonsGardes, nouvelEtat, traiterRetour, urlAutorisation } from './connexion';
import { CLE_CACHE, CLE_VERROU, lireEcoute, pochette, versEnCours } from './ecoute';

const T0 = 1_800_000_000_000;
const APP = { clientId: 'client-id', secret: 'SECRET-APP' };
const ACCES = 'ACCES-SECRET-1', RAFRAICHIR = 'RAFRAICHIR-SECRET-1';

type Appel = { url: string; init?: RequestInit };
/** Un faux fetch : chaque appel prend la réponse suivante de la liste. */
function faux(...reponses: (() => Response)[]) {
  const appels: Appel[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    appels.push({ url: String(url), init });
    const r = reponses.shift();
    if (!r) throw new Error('appel inattendu');
    return r();
  }) as typeof fetch;
  return { f, appels };
}
const json = (d: unknown, status = 200) => () => Response.json(d, { status });
const vide = (status: number) => () => new Response(null, { status });

const MORCEAU = {
  is_playing: true, progress_ms: 42_000, currently_playing_type: 'track',
  item: {
    type: 'track', id: 'trk1', name: 'Nights', duration_ms: 307_000, uri: 'spotify:track:trk1',
    artists: [{ name: 'Frank Ocean' }, { name: 'Invité' }],
    album: { name: 'Blonde', images: [
      { url: 'https://i.scdn.co/640', width: 640, height: 640 },
      { url: 'https://i.scdn.co/300', width: 300, height: 300 },
      { url: 'https://i.scdn.co/64', width: 64, height: 64 },
      { url: 'https://i.scdn.co/32', width: 32, height: 32 },
    ] },
  },
};

async function connecte(kv: KV, expire = T0 + 3600_000) {
  await enregistrerJetons(kv, { access_token: ACCES, refresh_token: RAFRAICHIR, expire }, APP.secret, T0);
}

describe('état Spotify', () => {
  it('se consomme une fois', async () => {
    const kv = memoire(); const e = await nouvelEtat(kv, T0);
    expect(e).toMatch(/^[0-9a-f]{32}$/);
    expect(await consommerEtat(kv, e, T0 + 1000)).toBe(true);
    expect(await consommerEtat(kv, e, T0 + 2000)).toBe(false);
  });
  it('inconnu ou trop vieux : refusé', async () => {
    const kv = memoire(); const e = await nouvelEtat(kv, T0);
    expect(await consommerEtat(kv, 'a'.repeat(32), T0)).toBe(false);
    expect(await consommerEtat(kv, e, T0 + 11 * 60_000)).toBe(false);
  });
  it("l'adresse d'autorisation porte les bons paramètres", () => {
    const u = new URL(urlAutorisation('cid', 'e'.repeat(32)));
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(u.searchParams.get('redirect_uri')).toBe('https://mon-qg.vercel.app/api/spotify/retour');
    expect(u.searchParams.get('scope')).toBe('user-read-currently-playing user-read-playback-state');
    expect(u.searchParams.get('response_type')).toBe('code');
  });
});

describe('retour de Spotify', () => {
  it('échange le code (Basic) et garde les jetons chiffrés', async () => {
    const kv = memoire(); const e = await nouvelEtat(kv, T0);
    const { f, appels } = faux(json({ access_token: ACCES, refresh_token: RAFRAICHIR, expires_in: 3600, token_type: 'Bearer' }));
    expect(await traiterRetour(kv, { code: 'CODE', state: e }, { ...APP, fetch: f }, T0)).toEqual({ ok: true });
    expect(appels[0].url).toBe('https://accounts.spotify.com/api/token');
    const h = appels[0].init!.headers as Record<string, string>;
    expect(h.authorization).toBe(`Basic ${Buffer.from('client-id:SECRET-APP').toString('base64')}`);
    const corps = new URLSearchParams(String(appels[0].init!.body));
    expect(corps.get('grant_type')).toBe('authorization_code');
    expect(corps.get('code')).toBe('CODE');
    expect(appels[0].init!.signal).toBeInstanceOf(AbortSignal);
    const brut = JSON.stringify(await kv.hgetall(CLE_CONNEXION));
    expect(brut).not.toContain(ACCES);
    expect(brut).not.toContain(RAFRAICHIR);
    expect(await lireJetonsGardes(kv, APP.secret)).toEqual({ access_token: ACCES, refresh_token: RAFRAICHIR, expire: T0 + 3600_000 });
    expect(await lireJetonsGardes(kv, 'autre secret')).toBeNull();
  });
  it('le même état ne sert pas deux fois', async () => {
    const kv = memoire(); const e = await nouvelEtat(kv, T0);
    const { f } = faux(json({ access_token: ACCES, refresh_token: RAFRAICHIR, expires_in: 3600 }));
    await traiterRetour(kv, { code: 'C', state: e }, { ...APP, fetch: f }, T0);
    const r = await traiterRetour(kv, { code: 'C', state: e }, { ...APP, fetch: f }, T0);
    expect(r).toEqual({ ok: false, raison: 'demande inconnue, périmée ou déjà utilisée' });
  });
  it("code d'erreur nettoyé", async () => {
    const r = await traiterRetour(memoire(), { error: 'access_denied<script>' }, APP, T0);
    expect(r).toEqual({ ok: false, raison: 'Spotify a refusé ou annulé la connexion (access_deniedscript)' });
  });
  it('code refusé par Spotify', async () => {
    const kv = memoire(); const e = await nouvelEtat(kv, T0);
    const { f } = faux(json({ error: 'invalid_grant' }, 400));
    expect(await traiterRetour(kv, { code: 'C', state: e }, { ...APP, fetch: f }, T0)).toEqual({ ok: false, raison: "Spotify n'a pas accepté le code" });
    expect(await kv.hgetall(CLE_CONNEXION)).toEqual({});
  });
});

describe('pochette et morceau', () => {
  it('la plus petite image d’au moins 64 px, en https', () => {
    expect(pochette(MORCEAU.item.album.images)).toBe('https://i.scdn.co/64');
    expect(pochette([{ url: 'http://x/64', width: 64 }, { url: 'https://x/300', width: 300 }])).toBe('https://x/300');
    expect(pochette(undefined)).toBe('');
  });
  it('un morceau est bien lu', () => {
    expect(versEnCours(MORCEAU, T0)).toEqual({
      id: 'trk1', titre: 'Nights', artistes: 'Frank Ocean, Invité', album: 'Blonde', pochette: 'https://i.scdn.co/64',
      dureeMs: 307_000, progressionMs: 42_000, joue: true, quand: T0,
    });
  });
  it('un épisode : titre et nom de l’émission', () => {
    const e = versEnCours({ is_playing: false, progress_ms: 1000, item: { type: 'episode', id: 'ep1', name: 'Épisode 3', duration_ms: 60_000, images: [{ url: 'https://i/e', width: 300 }], show: { name: 'Mon podcast' } } }, T0);
    expect(e).toMatchObject({ id: 'ep1', titre: 'Épisode 3', artistes: 'Mon podcast', pochette: 'https://i/e', joue: false });
  });
  it('une publicité ou rien : null', () => {
    expect(versEnCours({ is_playing: true, item: null, currently_playing_type: 'ad' }, T0)).toBeNull();
    expect(versEnCours({ is_playing: true, item: { type: 'ad', id: 'x' } }, T0)).toBeNull();
  });
});

describe('lireEcoute', () => {
  it('non connecté : connecte false, sans appel à Spotify', async () => {
    const { f, appels } = faux();
    expect(await lireEcoute(memoire(), { ...APP, fetch: f }, T0)).toEqual({ connecte: false, enCours: null });
    expect(appels).toHaveLength(0);
  });
  it('204 : rien en cours', async () => {
    const kv = memoire(); await connecte(kv);
    const { f, appels } = faux(vide(204));
    expect(await lireEcoute(kv, { ...APP, fetch: f }, T0)).toEqual({ connecte: true, enCours: null });
    expect(appels[0].url).toContain('https://api.spotify.com/v1/me/player/currently-playing');
    expect((appels[0].init!.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCES}`);
    expect(appels[0].init!.signal).toBeInstanceOf(AbortSignal);
  });
  it('un morceau en cours', async () => {
    const kv = memoire(); await connecte(kv);
    const { f } = faux(json(MORCEAU));
    const v = await lireEcoute(kv, { ...APP, fetch: f }, T0);
    expect(v.connecte).toBe(true);
    expect(v.enCours).toMatchObject({ id: 'trk1', titre: 'Nights', artistes: 'Frank Ocean, Invité', joue: true });
  });
  it('jeton expiré : rafraîchi, et le nouveau jeton de rafraîchissement est gardé', async () => {
    const kv = memoire(); await connecte(kv, T0 - 1);
    const { f, appels } = faux(json({ access_token: 'ACCES-2', refresh_token: 'RAFRAICHIR-2', expires_in: 3600 }), json(MORCEAU));
    const v = await lireEcoute(kv, { ...APP, fetch: f }, T0);
    expect(v.enCours?.id).toBe('trk1');
    const corps = new URLSearchParams(String(appels[0].init!.body));
    expect(corps.get('grant_type')).toBe('refresh_token');
    expect(corps.get('refresh_token')).toBe(RAFRAICHIR);
    expect((appels[1].init!.headers as Record<string, string>).authorization).toBe('Bearer ACCES-2');
    expect(await lireJetonsGardes(kv, APP.secret)).toEqual({ access_token: 'ACCES-2', refresh_token: 'RAFRAICHIR-2', expire: T0 + 3600_000 });
    expect(JSON.stringify(await kv.hgetall(CLE_CONNEXION))).not.toContain('ACCES-2');
  });
  it('rafraîchi sans nouveau jeton de rafraîchissement : on garde l’ancien', async () => {
    const kv = memoire(); await connecte(kv, T0 - 1);
    const { f } = faux(json({ access_token: 'ACCES-2', expires_in: 3600 }), vide(204));
    await lireEcoute(kv, { ...APP, fetch: f }, T0);
    expect((await lireJetonsGardes(kv, APP.secret))?.refresh_token).toBe(RAFRAICHIR);
  });
  it('401, puis 401 après rafraîchissement : déconnecté, connexion effacée', async () => {
    const kv = memoire(); await connecte(kv);
    const { f } = faux(vide(401), json({ access_token: 'ACCES-2', expires_in: 3600 }), vide(401));
    expect(await lireEcoute(kv, { ...APP, fetch: f }, T0)).toEqual({ connecte: false, enCours: null });
    expect(await kv.hgetall(CLE_CONNEXION)).toEqual({});
    expect(await lireJetonsGardes(kv, APP.secret)).toBeNull();
  });
  it('401 puis rafraîchissement accepté : le morceau', async () => {
    const kv = memoire(); await connecte(kv);
    const { f } = faux(vide(401), json({ access_token: 'ACCES-2', expires_in: 3600 }), json(MORCEAU));
    expect((await lireEcoute(kv, { ...APP, fetch: f }, T0)).enCours?.id).toBe('trk1');
  });
  it('rafraîchissement refusé (invalid_grant) : déconnecté', async () => {
    const kv = memoire(); await connecte(kv, T0 - 1);
    const { f } = faux(json({ error: 'invalid_grant' }, 400));
    expect(await lireEcoute(kv, { ...APP, fetch: f }, T0)).toEqual({ connecte: false, enCours: null });
    expect(await kv.hgetall(CLE_CONNEXION)).toEqual({});
  });
  it('429 : la dernière valeur gardée', async () => {
    const kv = memoire(); await connecte(kv);
    const { f } = faux(json(MORCEAU), vide(429));
    await lireEcoute(kv, { ...APP, fetch: f }, T0);
    const v = await lireEcoute(kv, { ...APP, fetch: f }, T0 + 20_000);
    expect(v.enCours).toMatchObject({ id: 'trk1', progressionMs: 62_000 });
  });
  it('gardé 10 s : plusieurs onglets ne sollicitent pas Spotify', async () => {
    const kv = memoire(); await connecte(kv);
    const { f, appels } = faux(json(MORCEAU), vide(204));
    await lireEcoute(kv, { ...APP, fetch: f }, T0);
    const v = await lireEcoute(kv, { ...APP, fetch: f }, T0 + 5_000);
    expect(appels).toHaveLength(1);
    expect(v.enCours).toMatchObject({ id: 'trk1', progressionMs: 47_000, quand: T0 + 5_000 });
    expect(await lireEcoute(kv, { ...APP, fetch: f }, T0 + 10_000)).toEqual({ connecte: true, enCours: null });
    expect(appels).toHaveLength(2);
  });
  it('panne réseau : pas d’exception', async () => {
    const kv = memoire(); await connecte(kv);
    const f = (async () => { throw new Error('réseau'); }) as typeof fetch;
    expect(await lireEcoute(kv, { ...APP, fetch: f }, T0)).toEqual({ connecte: true, enCours: null });
  });
  it('la vue ne contient jamais de jeton, ni dans le cache', async () => {
    const kv = memoire(); await connecte(kv, T0 - 1);
    const { f } = faux(json({ access_token: 'ACCES-2', refresh_token: 'RAFRAICHIR-2', expires_in: 3600 }), json(MORCEAU));
    const v = await lireEcoute(kv, { ...APP, fetch: f }, T0);
    const tout = JSON.stringify(v) + JSON.stringify(await kv.hgetall(CLE_CACHE));
    for (const s of [ACCES, RAFRAICHIR, 'ACCES-2', 'RAFRAICHIR-2', APP.secret]) expect(tout).not.toContain(s);
    expect(Object.keys(v).sort()).toEqual(['connecte', 'enCours']);
    expect(Object.keys(v.enCours!).sort()).toEqual(['album', 'artistes', 'dureeMs', 'id', 'joue', 'pochette', 'progressionMs', 'quand', 'titre']);
  });
});

describe('rafraîchissements concurrents', () => {
  /** Spotify fait tourner le jeton de rafraîchissement : l'ancien est refusé (invalid_grant) une fois utilisé. */
  function spotifyRotatif() {
    let valide = RAFRAICHIR, n = 0, rafraichissements = 0;
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://accounts.spotify.com/api/token')) {
        rafraichissements++;
        const rt = new URLSearchParams(String(init?.body)).get('refresh_token');
        await new Promise(r => setTimeout(r, 5));
        if (rt !== valide) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        n++; valide = `RAFRAICHIR-${n + 1}`;
        return Response.json({ access_token: `ACCES-${n + 1}`, refresh_token: valide, expires_in: 3600 });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    return { f, valide: () => valide, rafraichissements: () => rafraichissements };
  }
  it('deux requêtes après expiration : un seul rafraîchissement, aucune déconnexion', async () => {
    const kv = memoire(); await connecte(kv, T0 - 1);
    const s = spotifyRotatif();
    const r = await Promise.all([lireEcoute(kv, { ...APP, fetch: s.f }, T0), lireEcoute(kv, { ...APP, fetch: s.f }, T0)]);
    expect(r.every(v => v.connecte)).toBe(true);
    expect(s.rafraichissements()).toBe(1);
    expect((await lireJetonsGardes(kv, APP.secret))?.refresh_token).toBe(s.valide());
    expect(await kv.get(CLE_VERROU)).toBeNull();
  });
  it('refus, mais une autre instance a rafraîchi entre-temps : on prend ses jetons, sans déconnecter', async () => {
    const kv = memoire(); await connecte(kv, T0 - 1);
    const appels: string[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('/api/token')) {
        // l'autre instance gagne la course et enregistre de nouveaux jetons pendant notre appel
        await enregistrerJetons(kv, { access_token: 'ACCES-AUTRE', refresh_token: 'RAFRAICHIR-AUTRE', expire: T0 + 3600_000 }, APP.secret, T0);
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      appels.push((init!.headers as Record<string, string>).authorization);
      return Response.json(MORCEAU);
    }) as typeof fetch;
    const v = await lireEcoute(kv, { ...APP, fetch: f }, T0);
    expect(v).toMatchObject({ connecte: true, enCours: { id: 'trk1' } });
    expect(appels).toEqual(['Bearer ACCES-AUTRE']);
    expect((await lireJetonsGardes(kv, APP.secret))?.refresh_token).toBe('RAFRAICHIR-AUTRE');
  });
  it("n'écrase pas des jetons plus récents par des plus anciens", async () => {
    const kv = memoire(); await connecte(kv, T0 - 1);
    const f = (async (url: string | URL | Request) => {
      if (String(url).includes('/api/token')) {
        await enregistrerJetons(kv, { access_token: 'ACCES-AUTRE', refresh_token: 'RAFRAICHIR-AUTRE', expire: T0 + 3600_000 }, APP.secret, T0);
        return Response.json({ access_token: 'ACCES-MIEN', refresh_token: 'RAFRAICHIR-MIEN', expires_in: 3600 });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await lireEcoute(kv, { ...APP, fetch: f }, T0);
    expect((await lireJetonsGardes(kv, APP.secret))?.refresh_token).toBe('RAFRAICHIR-AUTRE');
  });
  it('verrou pris par une autre requête : pas de rafraîchissement, pas de déconnexion', async () => {
    const kv = memoire(); await connecte(kv, T0 - 1);
    await kv.setnx(CLE_VERROU, '1', 15);
    const { f, appels } = faux();
    expect(await lireEcoute(kv, { ...APP, fetch: f }, T0)).toEqual({ connecte: true, enCours: null });
    expect(appels).toHaveLength(0);
    expect(await lireJetonsGardes(kv, APP.secret)).not.toBeNull();
  });
});

describe('vue gardée périmée', () => {
  it('Spotify ne répond plus depuis plus de 2 min : plus rien en cours', async () => {
    const kv = memoire(); await connecte(kv);
    const { f } = faux(json(MORCEAU), vide(429), vide(503));
    await lireEcoute(kv, { ...APP, fetch: f }, T0);
    expect((await lireEcoute(kv, { ...APP, fetch: f }, T0 + 119_000)).enCours?.id).toBe('trk1');
    expect(await lireEcoute(kv, { ...APP, fetch: f }, T0 + 121_000)).toEqual({ connecte: true, enCours: null });
  });
});
