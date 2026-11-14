import { describe, expect, it, vi } from 'vitest';
import { commitsDepuis, fichierIgnore, lireCommit, teteDeBranche } from './github';

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const f = (routes: (url: string, init?: RequestInit) => Response | undefined) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => routes(String(url), init) ?? new Response('', { status: 404 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const D = 'mon-compte/app';

describe('teteDeBranche', () => {
  it('branche par défaut et sha de sa tête', async () => {
    const recup = f(u => u.endsWith(`/repos/${D}`) ? json({ default_branch: 'main' }) : u.endsWith(`/repos/${D}/branches/main`) ? json({ commit: { sha: 'abc' } }) : undefined);
    expect(await teteDeBranche(recup, 'j', D)).toEqual({ branche: 'main', sha: 'abc' });
  });
  it('dépôt vide (la branche par défaut n’existe pas encore) → « vide », pas une panne', async () => {
    const recup = f(u => u.endsWith(`/repos/${D}`) ? json({ default_branch: 'main' }) : undefined);
    expect(await teteDeBranche(recup, 'j', D)).toBe('vide');
  });
  it('GitHub injoignable → null', async () => {
    expect(await teteDeBranche(f(() => new Response('', { status: 500 })), 'j', D)).toBeNull();
    expect(await teteDeBranche((async () => { throw new Error('x'); }) as unknown as typeof fetch, 'j', D)).toBeNull();
  });
});

const c = (sha: string) => ({ sha });
describe('commitsDepuis', () => {
  it('du plus ancien au plus récent, 30 au plus (les 30 plus anciens)', async () => {
    const commits = Array.from({ length: 40 }, (_, i) => c(`s${i}`));
    const recup = f(u => u.includes('/compare/m1...main') ? json({ status: 'ahead', ahead_by: 40, commits }) : undefined);
    const r = await commitsDepuis(recup, 'j', D, 'm1', 'main');
    expect(r?.shas).toHaveLength(30);
    expect(r?.shas[0]).toBe('s0');
    expect(r?.shas[29]).toBe('s29');
    expect(r?.reecrit).toBeUndefined();
  });
  it('behind ou identical → aucun commit', async () => {
    for (const status of ['behind', 'identical']) {
      const recup = f(() => json({ status, commits: [c('x')] }));
      expect(await commitsDepuis(recup, 'j', D, 'm', 'main')).toEqual({ shas: [] });
    }
  });
  it('404 sur la marque → reecrit et commits des 24 dernières heures, du plus ancien au plus récent', async () => {
    const recup = f(u => u.includes('/compare/') ? new Response('', { status: 404 }) : u.includes('/commits?') ? json([c('n3'), c('n2'), c('n1')]) : undefined);
    const r = await commitsDepuis(recup, 'j', D, 'm', 'main');
    expect(r).toEqual({ shas: ['n1', 'n2', 'n3'], reecrit: true });
    const url = new URL(String(recup.mock.calls.at(-1)![0]));
    expect(url.searchParams.get('sha')).toBe('main');
    const depuis = Date.parse(url.searchParams.get('since')!);
    expect(Date.now() - depuis).toBeGreaterThan(23.9 * 3_600_000);
    expect(Date.now() - depuis).toBeLessThan(24.1 * 3_600_000);
  });
  it('422 sur la marque (sha inconnu de GitHub) → même repli que 404', async () => {
    const recup = f(u => u.includes('/compare/') ? new Response('', { status: 422 }) : u.includes('/commits?') ? json([c('n2'), c('n1')]) : undefined);
    expect(await commitsDepuis(recup, 'j', D, 'm', 'main')).toEqual({ shas: ['n1', 'n2'], reecrit: true });
  });
  it('la comparaison demande 30 commits par page', async () => {
    const recup = f(u => u.includes('/compare/') ? json({ status: 'ahead', commits: [c('s0')] }) : undefined);
    await commitsDepuis(recup, 'j', D, 'm1', 'main');
    const url = new URL(String(recup.mock.calls[0][0]));
    expect(url.pathname).toBe(`/repos/${D}/compare/m1...main`);
    expect(url.searchParams.get('per_page')).toBe('30');
  });
  it('repli : 30 au plus', async () => {
    const liste = Array.from({ length: 50 }, (_, i) => c(`n${i}`));
    const recup = f(u => u.includes('/compare/') ? new Response('', { status: 404 }) : json(liste));
    const r = await commitsDepuis(recup, 'j', D, 'm', 'main');
    expect(r?.shas).toHaveLength(30);
    expect(r?.shas[0]).toBe('n29');
  });
  it('GitHub injoignable → null', async () => {
    expect(await commitsDepuis(f(() => new Response('', { status: 500 })), 'j', D, 'm', 'main')).toBeNull();
    expect(await commitsDepuis((async () => { throw new Error('x'); }) as unknown as typeof fetch, 'j', D, 'm', 'main')).toBeNull();
  });
});

const commitGh = (files: unknown[], extra: object = {}) => ({ sha: 'abc', commit: { message: 'msg', author: { date: '2026-11-11T10:00:00Z' } }, files, ...extra });
describe('lireCommit', () => {
  const lit = (corps: unknown) => lireCommit(f(() => json(corps)), 'j', D, 'abc');
  it('fichiers avec patch et statut', async () => {
    const r = await lit(commitGh([{ filename: 'src/a.ts', status: 'modified', patch: '@@ +1 @@\n+x' }]));
    expect(r).toEqual({ sha: 'abc', message: 'msg', date: Date.parse('2026-11-11T10:00:00Z'), fichiers: [{ chemin: 'src/a.ts', patch: '@@ +1 @@\n+x', statut: 'modified' }] });
  });
  it('fichier sans patch → non fourni + clés non vérifiées', async () => {
    const r = await lit(commitGh([{ filename: 'src/a.ts', status: 'added' }]));
    expect(r?.fichiers[0]).toMatchObject({ chemin: 'src/a.ts', enPartie: 'non fourni', clesNonVerifiees: true });
    expect(r?.fichiers[0].patch).toBeUndefined();
  });
  it('patch de 41 Ko → trop gros ; patch conservé pour le repérage des clés', async () => {
    const gros = 'x'.repeat(41 * 1024);
    const r = await lit(commitGh([{ filename: 'a.ts', status: 'modified', patch: gros }]));
    expect(r?.fichiers[0].enPartie).toBe('trop gros');
    expect(r?.fichiers[0].patch).toBe(gros);
    const juste = await lit(commitGh([{ filename: 'a.ts', status: 'modified', patch: 'x'.repeat(40 * 1024) }]));
    expect(juste?.fichiers[0].enPartie).toBeUndefined();
  });
  it('301 fichiers → marqueur « … » ; 299 → pas de marqueur', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ filename: `f${i}.ts`, status: 'added', patch: '+a' }));
    const r = await lit(commitGh(mk(301)));
    expect(r?.fichiers).toHaveLength(302);
    expect(r?.fichiers.at(-1)).toEqual({ chemin: '…', clesNonVerifiees: true, enPartie: 'non fourni' });
    expect((await lit(commitGh(mk(299))))?.fichiers).toHaveLength(299);
  });
  it('rienACoder quand tous les fichiers sont ignorés', async () => {
    const r = await lit(commitGh([{ filename: 'pnpm-lock.yaml', status: 'modified', patch: '+a' }, { filename: 'logo.png', status: 'added' }]));
    expect(r?.rienACoder).toBe(true);
    const non = await lit(commitGh([{ filename: 'pnpm-lock.yaml', status: 'modified', patch: '+a' }, { filename: 'a.ts', status: 'modified', patch: '+a' }]));
    expect(non?.rienACoder).toBeUndefined();
  });
  it('injoignable ou illisible → null', async () => {
    expect(await lireCommit(f(() => new Response('', { status: 500 })), 'j', D, 'abc')).toBeNull();
    expect(await lireCommit(f(() => new Response('pas du json', { status: 200 })), 'j', D, 'abc')).toBeNull();
  });
});

describe('fichierIgnore', () => {
  it('verrous', () => {
    for (const p of ['pnpm-lock.yaml', 'a/package-lock.json', 'yarn.lock', 'bun.lockb', 'poetry.lock', 'Cargo.lock', 'Gemfile.lock', 'composer.lock']) expect(fichierIgnore(p), p).toBe(true);
  });
  it('images, binaires, polices, médias', () => {
    for (const p of ['a.png', 'b/c.JPG', 'd.svg', 'e.woff2', 'f.mp4', 'g.pdf', 'h.ico', 'i.zip', 'j.ttf']) expect(fichierIgnore(p), p).toBe(true);
  });
  it('min, map, dossiers générés', () => {
    for (const p of ['a.min.js', 'b.min.css', 'a.js.map', 'dist/x.js', 'app/dist/x.js', '.next/a', 'build/a', 'node_modules/a/b.js', 'carnet/1.md', 'docs/seances/x.md']) expect(fichierIgnore(p), p).toBe(true);
  });
  it('code et .env ne sont pas ignorés', () => {
    for (const p of ['src/a.ts', '.env', '.env.local', 'README.md', 'docs/plan.md', 'rebuild/a.ts', 'lock.ts']) expect(fichierIgnore(p), p).toBe(false);
  });
});

describe('jeton', () => {
  it('ne part que vers api.github.com', async () => {
    const recup = f(() => json({ default_branch: 'main', commit: { sha: 'a' } }));
    await teteDeBranche(recup, 'SECRET', D);
    for (const [, init] of recup.mock.calls) expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer SECRET' });
  });
});
