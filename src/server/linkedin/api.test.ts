import { describe, expect, it } from 'vitest';
import { Refus } from '../qg';
import {
  ErreurPublication, jetonRefuse, PORTEE, REDIRECTION, commentaireLinkedIn, creerPost, echangerCode, lireProfil, televerser, urlAutorisation,
  type Fetch,
} from './api';

type Appel = { url: string; init: RequestInit };
function faux(...reponses: (Response | Error)[]) {
  const appels: Appel[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    appels.push({ url: String(url), init });
    const r = reponses.shift();
    if (!r) throw new Error('plus de réponse prévue');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as Fetch;
  return { f, appels };
}
const json = (o: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: h });
const entetes = (a: Appel) => new Headers(a.init.headers);

describe('la connexion', () => {
  it('construit l’adresse d’autorisation', () => {
    const u = urlAutorisation('ID', 'e1');
    expect(u.startsWith('https://www.linkedin.com/oauth/v2/authorization?')).toBe(true);
    const q = new URL(u).searchParams;
    expect(Object.fromEntries(q)).toEqual({ response_type: 'code', client_id: 'ID', redirect_uri: REDIRECTION, state: 'e1', scope: PORTEE });
  });
  it('échange le code contre un jeton', async () => {
    const { f, appels } = faux(json({ access_token: 't', expires_in: 5184000 }));
    expect(await echangerCode('CODE', { clientId: 'ID', secret: 'SEC' }, f)).toEqual({ jeton: 't', expireDans: 5184000 });
    expect(appels[0].url).toBe('https://www.linkedin.com/oauth/v2/accessToken');
    expect(appels[0].init.method).toBe('POST');
    expect(entetes(appels[0]).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(appels[0].init.body)))).toEqual({
      grant_type: 'authorization_code', code: 'CODE', redirect_uri: REDIRECTION, client_id: 'ID', client_secret: 'SEC',
    });
  });
  it('refuse en 502 sans révéler le code ni le secret', async () => {
    const { f } = faux(json({ error: 'bad CODE-XYZ SEC-123' }, 400));
    const e = await echangerCode('CODE-XYZ', { clientId: 'ID', secret: 'SEC-123' }, f).catch(x => x);
    expect(e).toBeInstanceOf(Refus);
    expect(e.code).toBe(502);
    expect(e.message).not.toContain('CODE-XYZ');
    expect(e.message).not.toContain('SEC-123');
  });
  it('lit le profil', async () => {
    const { f, appels } = faux(json({ sub: 'abc', name: 'Le patron D' }));
    expect(await lireProfil('t', f)).toEqual({ auteur: 'urn:li:person:abc', nom: 'Le patron D' });
    expect(appels[0].url).toBe('https://api.linkedin.com/v2/userinfo');
    expect(entetes(appels[0]).get('authorization')).toBe('Bearer t');
  });
});

describe('le téléversement', () => {
  const init = (cle: 'image' | 'document') => json({ value: { uploadUrl: 'https://www.linkedin.com/dms-uploads/x', [cle]: `urn:li:${cle}:1` } });
  it('envoie une image', async () => {
    const { f, appels } = faux(init('image'), new Response(null, { status: 201 }));
    expect(await televerser('t', 'urn:li:person:abc', 'image', new Uint8Array([1, 2]), f)).toBe('urn:li:image:1');
    expect(appels[0].url).toBe('https://api.linkedin.com/rest/images?action=initializeUpload');
    expect(JSON.parse(String(appels[0].init.body))).toEqual({ initializeUploadRequest: { owner: 'urn:li:person:abc' } });
    expect(entetes(appels[0]).get('linkedin-version')).toBe('202610');
    expect(entetes(appels[0]).get('x-restli-protocol-version')).toBe('2.0.0');
    expect(appels[1].url).toBe('https://www.linkedin.com/dms-uploads/x');
    expect(appels[1].init.method).toBe('PUT');
    expect(entetes(appels[1]).get('authorization')).toBe('Bearer t');
    expect(appels[1].init.body).toEqual(new Uint8Array([1, 2]));
  });
  it('envoie un document', async () => {
    const { f, appels } = faux(init('document'), new Response(null, { status: 201 }));
    expect(await televerser('t', 'a', 'document', new Uint8Array([1]), f)).toBe('urn:li:document:1');
    expect(appels[0].url).toBe('https://api.linkedin.com/rest/documents?action=initializeUpload');
  });
  it.each([401, 403])('un %i à la préparation ou à l’envoi : jeton à refaire', async status => {
    const e1 = await televerser('t', 'a', 'image', new Uint8Array([1]), faux(json({}, status)).f).catch(x => x);
    expect(jetonRefuse(e1)).toBe(true);
    const ok = json({ value: { uploadUrl: 'https://www.linkedin.com/up', image: 'urn:li:image:1' } });
    const e2 = await televerser('t', 'a', 'image', new Uint8Array([1]), faux(ok, new Response(null, { status })).f).catch(x => x);
    expect(jetonRefuse(e2)).toBe(true);
    const e3 = await televerser('t', 'a', 'image', new Uint8Array([1]), faux(json({}, 500)).f).catch(x => x);
    expect(jetonRefuse(e3)).toBe(false);
  });
  it('refuse en 502 si l’envoi échoue', async () => {
    const { f } = faux(init('image'), new Response('boom', { status: 500 }));
    const e = await televerser('t', 'a', 'image', new Uint8Array([1]), f).catch(x => x);
    expect(e).toBeInstanceOf(Refus);
    expect(e.code).toBe(502);
  });
});

describe('l’adresse de téléversement', () => {
  it.each(['http://www.linkedin.com/x', 'https://evil.example/x', 'https://linkedin.com.evil.example/x', 'https://notlinkedin.com/x', 'pas une adresse'])('refuse %s sans envoyer le jeton', async (u) => {
    const { f, appels } = faux(json({ value: { uploadUrl: u, image: 'urn:li:image:1' } }));
    const e = await televerser('t', 'a', 'image', new Uint8Array([1]), f).catch(x => x);
    expect(e).toBeInstanceOf(Refus);
    expect(e.code).toBe(502);
    expect(appels).toHaveLength(1);
  });
  it('accepte linkedin.com, licdn.com et leurs sous-domaines', async () => {
    for (const u of ['https://www.linkedin.com/x', 'https://dms.licdn.com/x', 'https://linkedin.com/x']) {
      const { f, appels } = faux(json({ value: { uploadUrl: u, image: 'i' } }), new Response(null, { status: 201 }));
      await televerser('t', 'a', 'image', new Uint8Array([1]), f);
      expect(appels).toHaveLength(2);
    }
  });
});

describe('le post', () => {
  const base = { auteur: 'urn:li:person:abc', commentaire: 'Salut' };
  const attendu = {
    author: 'urn:li:person:abc', commentary: 'Salut', visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
  };
  it('publie un post simple et renvoie son URN', async () => {
    const { f, appels } = faux(new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:9' } }));
    expect(await creerPost('t', base, f)).toBe('urn:li:share:9');
    expect(appels[0].url).toBe('https://api.linkedin.com/rest/posts');
    expect(appels[0].init.method).toBe('POST');
    expect(JSON.parse(String(appels[0].init.body))).toEqual(attendu);
    expect(entetes(appels[0]).get('linkedin-version')).toBe('202610');
    expect(appels[0].init.signal).toBeInstanceOf(AbortSignal);
  });
  it('joint le média', async () => {
    const { f, appels } = faux(new Response(null, { status: 201, headers: { 'x-restli-id': 'u' } }));
    await creerPost('t', { ...base, media: { id: 'urn:li:image:1', titre: 'T' } }, f);
    expect(JSON.parse(String(appels[0].init.body))).toEqual({ ...attendu, content: { media: { id: 'urn:li:image:1', title: 'T' } } });
  });
  it.each([401, 403])('un %i : refus net, jeton à refaire', async status => {
    const e = await creerPost('t', base, faux(json({}, status)).f).catch(x => x);
    expect(e).toBeInstanceOf(ErreurPublication);
    expect(e.incertain).toBe(false);
    expect(jetonRefuse(e)).toBe(true);
  });
  it('un refus net n’est pas incertain', async () => {
    const e = await creerPost('t', base, faux(json({ message: 'x' }, 422)).f).catch(x => x);
    expect(e).toBeInstanceOf(ErreurPublication);
    expect(e.incertain).toBe(false);
  });
  it.each([
    ['un 503', () => json({}, 503)],
    ['un 408', () => json({}, 408)],
    ['un fetch qui lève', () => new Error('réseau')],
    ['un délai dépassé (AbortError)', () => new DOMException('trop long', 'AbortError')],
    ['un 201 sans identifiant', () => new Response(null, { status: 201 })],
  ])('est incertain après %s', async (_n, rep) => {
    const e = await creerPost('t', base, faux(rep()).f).catch(x => x);
    expect(e).toBeInstanceOf(ErreurPublication);
    expect(e.incertain).toBe(true);
  });
});

describe('le texte', () => {
  it('échappe le balisage et met en forme les hashtags', () => {
    expect(commentaireLinkedIn('Next.js (App) #1 *gras* @moi', ['#NextJS', '#IA']))
      .toBe('Next.js \\(App\\) \\#1 \\*gras\\* \\@moi\n\n{hashtag|\\#|NextJS} {hashtag|\\#|IA}');
  });
  it('nettoie les hashtags pour ne pas casser le balisage', () => {
    expect(commentaireLinkedIn('a', ['#Next JS}', '|é\\_x', '#', '#{}']))
      .toBe('a\n\n{hashtag|\\#|NextJS} {hashtag|\\#|é_x}');
  });
  it('échappe le \\ en premier et tous les caractères réservés', () => {
    expect(commentaireLinkedIn('\\|{}@[]()<>#*_~', [])).toBe('\\\\\\|\\{\\}\\@\\[\\]\\(\\)\\<\\>\\#\\*\\_\\~');
  });
});
