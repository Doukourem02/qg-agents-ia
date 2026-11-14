import { describe, expect, it, vi } from 'vitest';
import {
  dernieresVersions, finsDeSupport, lecturesCandidates, listerDepots, lireManifestes, PRODUITS_FIN_DE_SUPPORT,
} from './sources';

const NOW = Date.parse('2026-11-09T00:00:00Z');
const jours = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

type Table = Record<string, Response | (() => Response)>;
/** Faux fetch : table url → réponse ; tout le reste répond 404. Garde les appels pour les inspecter. */
function faux(table: Table) {
  const appels: { url: string; init?: RequestInit }[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    appels.push({ url, init });
    const r = table[url];
    if (!r) return new Response('nope', { status: 404 });
    return typeof r === 'function' ? r() : r.clone();
  }) as unknown as typeof fetch;
  return { f, appels };
}
const json = (o: unknown, init?: ResponseInit) => new Response(JSON.stringify(o), init);

describe('listerDepots', () => {
  const p1 = 'https://api.github.com/user/repos?affiliation=owner&per_page=100';
  const p2 = 'https://api.github.com/user/repos?affiliation=owner&per_page=100&page=2';

  it('garde les actifs, écarte vieux et archivés, suit la page 2, envoie le jeton', async () => {
    const { f, appels } = faux({
      [p1]: json([{ full_name: 'a/actif', archived: false, pushed_at: jours(10) }, { full_name: 'a/vieux', archived: false, pushed_at: jours(120) }],
        { headers: { Link: `<${p2}>; rel="next"` } }),
      [p2]: json([{ full_name: 'a/archive', archived: true, pushed_at: jours(1) }, { full_name: 'a/autre', archived: false, pushed_at: jours(5) }]),
    });
    const depots = await listerDepots(f, 'j', 'perso', NOW);
    expect(depots.map(d => d.complet)).toEqual(['a/actif', 'a/autre']);
    expect(depots[0]).toMatchObject({ compte: 'perso', pousse: jours(10) });
    expect((appels[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer j');
  });

  it('lève une erreur sans le jeton quand GitHub est injoignable', async () => {
    const f = (async () => { throw new Error('timeout avec SECRET123'); }) as unknown as typeof fetch;
    const err = await listerDepots(f, 'SECRET123', 'pro', NOW).catch(e => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('GitHub injoignable (pro)');
    expect((err as Error).message).not.toContain('SECRET123');
  });

  it('lève aussi sur une réponse 401', async () => {
    const { f } = faux({ [p1]: new Response('', { status: 401 }) });
    await expect(listerDepots(f, 'j', 'perso', NOW)).rejects.toThrow('GitHub injoignable (perso)');
  });

  it('ne suit pas un lien Link hors api.github.com', async () => {
    const { f, appels } = faux({
      [p1]: json([], { headers: { Link: '<https://evil.example/x?page=2>; rel="next"' } }),
    });
    await listerDepots(f, 'j', 'perso', NOW);
    expect(appels).toHaveLength(1);
  });
});

describe('lireManifestes', () => {
  const base = 'https://api.github.com/repos/a/r';
  const arbre = `${base}/git/trees/HEAD?recursive=1`;
  const contenu = (p: string) => `${base}/contents/${p}`;

  it('ignore node_modules, lit racine et apps/web, saute un 404, passe .nvmrc de la racine', async () => {
    const { f, appels } = faux({
      [arbre]: json({ tree: [
        { path: 'package.json', type: 'blob' }, { path: 'node_modules/x/package.json', type: 'blob' },
        { path: 'apps/web/package.json', type: 'blob' }, { path: 'apps/cassé/package.json', type: 'blob' },
        { path: 'docs', type: 'tree' },
      ] }),
      [contenu('package.json')]: new Response(JSON.stringify({ name: 'racine', dependencies: { next: '^16.0.0' } })),
      [contenu('apps/web/package.json')]: new Response(JSON.stringify({ name: 'web', dependencies: { react: '19.2.0' } })),
      [contenu('.nvmrc')]: new Response('22\n'),
    });
    const m = await lireManifestes(f, 'j', 'a/r');
    expect(m.map(x => x.fichier)).toEqual(['package.json', 'apps/web/package.json']);
    expect(m[0].nom).toBe('racine');
    expect(m[0].usages.map(u => u.paquet).sort()).toEqual(expect.arrayContaining(['next', 'node']));
    expect(m[1].usages.map(u => u.paquet)).toEqual(['react']);
    expect(appels.some(a => a.url.includes('node_modules'))).toBe(false);
    const raw = appels.find(a => a.url === contenu('package.json'))!;
    expect((raw.init?.headers as Record<string, string>).Accept).toBe('application/vnd.github.raw');
  });

  it('plafonne à 20 fichiers', async () => {
    const tree = Array.from({ length: 30 }, (_, i) => ({ path: `p${i}/package.json`, type: 'blob' }));
    const table: Table = { [arbre]: json({ tree }) };
    for (let i = 0; i < 30; i++) table[contenu(`p${i}/package.json`)] = new Response('{"dependencies":{"next":"16.0.0"}}');
    const { f } = faux(table);
    expect(await lireManifestes(f, 'j', 'a/r')).toHaveLength(20);
  });

  it('renvoie [] sans exception quand fetch rejette', async () => {
    const f = (async () => { throw new DOMException('délai', 'TimeoutError'); }) as unknown as typeof fetch;
    expect(await lireManifestes(f, 'j', 'a/r')).toEqual([]);
  });
});

describe('dernieresVersions', () => {
  it('saute un paquet inconnu', async () => {
    const { f } = faux({ 'https://registry.npmjs.org/expo/latest': json({ version: '58.0.19' }) });
    expect(await dernieresVersions(f, ['expo', 'inconnu'])).toEqual({ expo: '58.0.19' });
  });
  it('encode les paquets à portée et n envoie aucun jeton', async () => {
    const { f, appels } = faux({ 'https://registry.npmjs.org/%40upstash%2Fredis/latest': json({ version: '1.0.0' }) });
    expect(await dernieresVersions(f, ['@upstash/redis'])).toEqual({ '@upstash/redis': '1.0.0' });
    expect(JSON.stringify(appels[0].init?.headers ?? {})).not.toContain('Authorization');
  });
});

describe('finsDeSupport', () => {
  it('lit date, booléen faux et booléen vrai', async () => {
    const { f } = faux({
      'https://endoflife.date/api/nodejs.json': json([{ cycle: '20', eol: '2026-04-30' }, { cycle: '26', eol: false }, { cycle: '12', eol: true }]),
    });
    const c = await finsDeSupport(f, ['nodejs', 'typescript']);
    expect(c).toEqual([
      { produit: 'nodejs', cycle: '20', fin: '2026-04-30' },
      { produit: 'nodejs', cycle: '26', fin: null },
      { produit: 'nodejs', cycle: '12', fin: '1970-01-01' },
    ]);
  });
  it('expose les slugs vérifiés', () => {
    expect(PRODUITS_FIN_DE_SUPPORT).toEqual(['nodejs', 'nextjs', 'react-native']);
  });
});

describe('lecturesCandidates', () => {
  const rss = (items: string[]) => `<?xml version="1.0"?><rss><channel><title>T</title>${items.map(i => `<item>${i}</item>`).join('')}</channel></rss>`;
  const item = (n: number, proto = 'https') => `<title><![CDATA[Billet ${n} &amp; co]]></title><link>${proto}://nextjs.org/blog/${n}</link><pubDate>Tue, 03 Nov 2026 18:00:00 GMT</pubDate>`;

  it('écarte http: et lit Atom', async () => {
    const { f } = faux({
      'https://nextjs.org/feed.xml': new Response(rss([item(1), item(2, 'http')])),
      'https://vercel.com/atom': new Response('<feed><entry><title>Nouveau</title><link href="https://vercel.com/changelog/x"/><updated>2026-11-07</updated></entry></feed>'),
    });
    const l = await lecturesCandidates(f, undefined, []);
    expect(l.map(x => x.url)).toEqual(['https://nextjs.org/blog/1', 'https://vercel.com/changelog/x']);
    expect(l[0].titre).toBe('Billet 1 & co');
  });

  it('plafonne à 15', async () => {
    const releases = Array.from({ length: 3 }, (_, i) => ({ name: `v${i}`, html_url: `https://github.com/o/r/releases/${i}` }));
    const t: Table = {
      'https://nextjs.org/feed.xml': new Response(rss(Array.from({ length: 40 }, (_, i) => item(i)))),
      'https://vercel.com/atom': new Response(rss(Array.from({ length: 40 }, (_, i) => item(100 + i)))),
    };
    for (const p of ['a', 'b', 'c', 'd', 'e']) {
      t[`https://registry.npmjs.org/${p}/latest`] = json({ repository: { url: `git+https://github.com/o/${p}.git` } });
      t[`https://api.github.com/repos/o/${p}/releases?per_page=3`] = json(releases);
    }
    const g = faux(t);
    expect((await lecturesCandidates(g.f, 'tok', ['a', 'b', 'c', 'd', 'e'])).length).toBe(15);
  });

  it('lit les notes de version GitHub avec le jeton, sans le donner à npm', async () => {
    const { f, appels } = faux({
      'https://registry.npmjs.org/expo/latest': json({ repository: 'github:expo/expo' }),
      'https://api.github.com/repos/expo/expo/releases?per_page=3': json([{ name: 'SDK 58', html_url: 'https://github.com/expo/expo/releases/1', published_at: '2026-11-01' }]),
    });
    const l = await lecturesCandidates(f, 'tok', ['expo']);
    expect(l[0]).toMatchObject({ titre: 'SDK 58', source: 'expo', date: '2026-11-01' });
    const gh = appels.find(a => a.url.startsWith('https://api.github.com'))!;
    expect((gh.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const npm = appels.find(a => a.url.startsWith('https://registry.npmjs.org'))!;
    expect(JSON.stringify(npm.init?.headers ?? {})).not.toContain('tok');
  });
});

describe('échéance commune et délais', () => {
  /** Un fetch qui ne répond jamais : il ne s'arrête que si son signal est coupé. */
  const pendu = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, rej) => {
    init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
  })) as unknown as typeof fetch;

  it('l\'échéance coupe un appel en cours (combinée au délai de 15 s)', async () => {
    const fin = new AbortController();
    const p = dernieresVersions(pendu, ['expo'], fin.signal);
    fin.abort();
    expect(await p).toEqual({});
  });

  it('après l\'échéance, plus aucun appel : les éléments sont sautés', async () => {
    const fin = new AbortController(); fin.abort();
    const { f, appels } = faux({ 'https://registry.npmjs.org/expo/latest': json({ version: '58.0.19' }) });
    expect(await dernieresVersions(f, ['expo'], fin.signal)).toEqual({});
    expect(await finsDeSupport(f, ['nodejs'], fin.signal)).toEqual([]);
    expect(await lecturesCandidates(f, undefined, ['expo'], fin.signal)).toEqual([]);
    expect(await lireManifestes(f, 'j', 'a/r', fin.signal)).toEqual([]);
    await expect(listerDepots(f, 'j', 'perso', NOW, fin.signal)).rejects.toThrow('GitHub injoignable (perso)');
    expect(appels).toHaveLength(0);
  });

  it('un dépôt dont un fichier dépasse le délai : on arrête de le lire, rien n\'en sort', async () => {
    const base = 'https://api.github.com/repos/a/r';
    const appels: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input); appels.push(url);
      if (url.endsWith('/git/trees/HEAD?recursive=1')) return json({ tree: [{ path: 'a/package.json', type: 'blob' }, { path: 'b/package.json', type: 'blob' }] });
      if (url === `${base}/contents/a/package.json`) throw new DOMException('délai', 'TimeoutError');
      return new Response('{"dependencies":{"next":"16.0.0"}}');
    }) as unknown as typeof fetch;
    expect(await lireManifestes(f, 'j', 'a/r')).toEqual([]);
    expect(appels).not.toContain(`${base}/contents/b/package.json`);
  });
});
