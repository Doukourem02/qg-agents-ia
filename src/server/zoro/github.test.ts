import { describe, expect, it, vi } from 'vitest';
import { dependancesDuDepot, depotsActifs, etatCI } from './github';

const NOW = Date.UTC(2026, 10, 11, 12, 0);
const json = (o: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status: 200, headers });
const f = (routes: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => (await routes(String(url), init)) ?? new Response('', { status: 404 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const depotsListe = [
  { full_name: 'mon-compte/app_livraison', archived: false, pushed_at: '2026-11-01T10:00:00Z' },
  { full_name: 'mon-compte/vieux', archived: false, pushed_at: '2026-01-01T10:00:00Z' },
  { full_name: 'mon-compte/archive', archived: true, pushed_at: '2026-11-01T10:00:00Z' },
];

describe('depotsActifs', () => {
  it('dépôts actifs : non archivés, poussés < 90 jours, compte perso ; nom court sans « mon-compte/ »', async () => {
    const recup = f(u => u.includes('/user/repos') ? json(depotsListe) : u.endsWith('/user') ? json({}) : undefined);
    const r = await depotsActifs(recup, 'jeton', NOW);
    expect(r.depots).toEqual([{ depot: 'app_livraison', pousse: Date.parse('2026-11-01T10:00:00Z') }]);
  });

  it('expiration : « 2026-12-01 10:00:00 +0100 » → ms UTC ; en-tête absent → null', async () => {
    const avec = f(u => u.includes('/user/repos') ? json([]) : u.endsWith('/user') ? json({}, { 'github-authentication-token-expiration': '2026-12-01 10:00:00 +0100' }) : undefined);
    expect((await depotsActifs(avec, 'j', NOW)).expiration).toBe(Date.UTC(2026, 11, 1, 9, 0));
    const utc = f(u => u.includes('/user/repos') ? json([]) : u.endsWith('/user') ? json({}, { 'github-authentication-token-expiration': '2026-12-01 10:00:00 UTC' }) : undefined);
    expect((await depotsActifs(utc, 'j', NOW)).expiration).toBe(Date.UTC(2026, 11, 1, 10, 0));
    const sans = f(u => u.includes('/user/repos') ? json([]) : u.endsWith('/user') ? json({}) : undefined);
    expect((await depotsActifs(sans, 'j', NOW)).expiration).toBeNull();
  });

  it('expiration : appel /user raté → undefined ; liste illisible → exception', async () => {
    const panne = f(u => u.includes('/user/repos') ? json([]) : undefined);
    expect((await depotsActifs(panne, 'j', NOW)).expiration).toBeUndefined();
    const tout = f(() => new Response('', { status: 500 }));
    await expect(depotsActifs(tout, 'j', NOW)).rejects.toThrow('GitHub injoignable');
  });
});

const run = (conclusion: string, created_at: string) => ({ conclusion, created_at, status: 'completed' });
function fauxCI(opts: { workflows?: number; runs?: unknown[]; runsStatus?: number; runsHeaders?: Record<string, string>; reseau?: boolean }) {
  return f(u => {
    if (opts.reseau) throw new TypeError('réseau');
    if (u.endsWith('/repos/mon-compte/x')) return json({ default_branch: 'dev' });
    if (u.endsWith('/actions/workflows')) return json({ total_count: opts.workflows ?? 1 });
    if (u.includes('/actions/runs')) return opts.runsStatus ? new Response('', { status: opts.runsStatus, headers: opts.runsHeaders }) : json({ workflow_runs: opts.runs ?? [] });
    return undefined;
  });
}

describe('etatCI', () => {
  it('CI : dernier en échec → rouge, depuis = début de la série d\'échecs en cours', async () => {
    const recup = fauxCI({ runs: [run('failure', '2026-09-30T08:00:00Z'), run('failure', '2026-09-25T08:00:00Z'), run('success', '2026-09-20T08:00:00Z')] });
    expect(await etatCI(recup, 'j', 'mon-compte/x')).toEqual({ etat: 'rouge', depuis: Date.UTC(2026, 8, 25, 8, 0), passages: 3, echecs: 2 });
    const url = recup.mock.calls.map(c => String(c[0])).find(u => u.includes('/actions/runs'))!;
    expect(url).toContain('branch=dev');
    expect(url).toContain('status=completed');
    expect(url).toContain('per_page=30');
  });

  it('CI : annulés et ignorés ne comptent pas ; série d\'échecs interrompue par un succès', async () => {
    const recup = fauxCI({ runs: [run('failure', '2026-09-30T08:00:00Z'), run('cancelled', '2026-09-28T08:00:00Z'), run('success', '2026-09-25T08:00:00Z'), run('timed_out', '2026-09-20T08:00:00Z')] });
    expect(await etatCI(recup, 'j', 'mon-compte/x')).toEqual({ etat: 'rouge', depuis: Date.UTC(2026, 8, 30, 8, 0), passages: 3, echecs: 2 });
  });

  it('CI : dernier passage réussi → vert avec le compte des échecs sur 30', async () => {
    const recup = fauxCI({ runs: [run('success', '2026-09-30T08:00:00Z'), run('failure', '2026-09-25T08:00:00Z')] });
    expect(await etatCI(recup, 'j', 'mon-compte/x')).toEqual({ etat: 'vert', passages: 2, echecs: 1 });
  });

  it('CI : 403 avec limite de débit atteinte → injoignable, pas « droit manquant »', async () => {
    const attendu = { etat: 'illisible', raison: 'GitHub injoignable' };
    expect(await etatCI(fauxCI({ runsStatus: 403, runsHeaders: { 'x-ratelimit-remaining': '0' } }), 'j', 'mon-compte/x')).toEqual(attendu);
    expect(await etatCI(fauxCI({ runsStatus: 403, runsHeaders: { 'retry-after': '60' } }), 'j', 'mon-compte/x')).toEqual(attendu);
  });

  it('CI : workflows présents mais aucun passage terminé compté → illisible', async () => {
    const attendu = { etat: 'illisible', raison: 'aucun passage terminé' };
    expect(await etatCI(fauxCI({ runs: [] }), 'j', 'mon-compte/x')).toEqual(attendu);
    expect(await etatCI(fauxCI({ runs: [run('cancelled', '2026-09-30T08:00:00Z'), run('skipped', '2026-09-29T08:00:00Z')] }), 'j', 'mon-compte/x')).toEqual(attendu);
  });

  it('CI : par workflow — « tests » échoue, « deploy » passe plus tard → rouge (jamais « tout passe »), depuis = début de la série de « tests »', async () => {
    const w = (workflow_id: number, conclusion: string, created_at: string) => ({ ...run(conclusion, created_at), workflow_id });
    const recup = fauxCI({ runs: [
      w(2, 'success', '2026-10-05T08:00:00Z'), // deploy, le plus récent
      w(1, 'failure', '2026-10-04T08:00:00Z'), // tests
      w(2, 'success', '2026-10-03T08:00:00Z'),
      w(1, 'failure', '2026-10-02T08:00:00Z'),
      w(1, 'cancelled', '2026-10-01T12:00:00Z'), // ignoré
      w(1, 'success', '2026-10-01T08:00:00Z'),
    ] });
    expect(await etatCI(recup, 'j', 'mon-compte/x')).toEqual({ etat: 'rouge', depuis: Date.UTC(2026, 9, 2, 8, 0), passages: 5, echecs: 2 });
  });

  it('CI : deux workflows en échec → depuis = le plus ancien début de série ; chaque workflow repassé au vert → vert', async () => {
    const w = (workflow_id: number, conclusion: string, created_at: string) => ({ ...run(conclusion, created_at), workflow_id });
    const deux = fauxCI({ runs: [
      w(1, 'failure', '2026-10-05T08:00:00Z'), w(2, 'failure', '2026-10-04T08:00:00Z'),
      w(2, 'failure', '2026-10-01T08:00:00Z'), w(1, 'success', '2026-10-03T08:00:00Z'),
    ] });
    expect(await etatCI(deux, 'j', 'mon-compte/x')).toEqual({ etat: 'rouge', depuis: Date.UTC(2026, 9, 1, 8, 0), passages: 4, echecs: 3 });
    const verts = fauxCI({ runs: [
      w(1, 'success', '2026-10-05T08:00:00Z'), w(2, 'success', '2026-10-04T08:00:00Z'), w(2, 'failure', '2026-10-03T08:00:00Z'),
    ] });
    expect(await etatCI(verts, 'j', 'mon-compte/x')).toEqual({ etat: 'vert', passages: 3, echecs: 1 });
  });

  it('CI : aucun workflow (total_count 0) → sans-tests', async () => {
    expect(await etatCI(fauxCI({ workflows: 0 }), 'j', 'mon-compte/x')).toEqual({ etat: 'sans-tests' });
  });

  it('CI : 403 ou 404 sur les runs → droit manquant ; GitHub injoignable → injoignable ; jamais vert', async () => {
    for (const code of [403, 404]) {
      expect(await etatCI(fauxCI({ runsStatus: code }), 'j', 'mon-compte/x')).toEqual({ etat: 'illisible', raison: 'droit Actions manquant' });
    }
    expect(await etatCI(fauxCI({ reseau: true }), 'j', 'mon-compte/x')).toEqual({ etat: 'illisible', raison: 'GitHub injoignable' });
    expect(await etatCI(fauxCI({ runsStatus: 500 }), 'j', 'mon-compte/x')).toEqual({ etat: 'illisible', raison: 'GitHub injoignable' });
  });
});

function fauxDepot(opts: { arbre?: unknown; fichiers?: Record<string, string> }) {
  return f(u => {
    if (u.includes('/git/trees/HEAD')) return opts.arbre === undefined ? undefined : json(opts.arbre);
    const m = /\/contents\/(.+)$/.exec(u);
    if (m && opts.fichiers?.[decodeURIComponent(m[1])] !== undefined) return new Response(opts.fichiers[decodeURIComponent(m[1])], { status: 200 });
    return undefined;
  });
}
const arbre = (...chemins: string[]) => ({ truncated: false, tree: chemins.map(path => ({ path, type: 'blob' })) });

describe('dependancesDuDepot', () => {
  it('arbre illisible ou tronqué → null', async () => {
    expect(await dependancesDuDepot(fauxDepot({}), 'j', 'mon-compte/x')).toBeNull();
    expect(await dependancesDuDepot(fauxDepot({ arbre: { truncated: true, tree: [] } }), 'j', 'mon-compte/x')).toBeNull();
  });

  it('fichier de dépendances illisible → null', async () => {
    expect(await dependancesDuDepot(fauxDepot({ arbre: arbre('package.json') }), 'j', 'mon-compte/x')).toBeNull();
  });

  it('aucun manifeste → []', async () => {
    expect(await dependancesDuDepot(fauxDepot({ arbre: arbre('README.md', 'src/a.ts') }), 'j', 'mon-compte/x')).toEqual([]);
  });

  it('lit les fichiers choisis et rend les dépendances', async () => {
    const recup = fauxDepot({ arbre: arbre('README.md', 'package.json'), fichiers: { 'package.json': JSON.stringify({ dependencies: { lodash: '4.17.20' } }) } });
    const r = await dependancesDuDepot(recup, 'j', 'mon-compte/x');
    expect(r).toEqual([{ nom: 'lodash', version: '4.17.20', ecosysteme: 'npm', directeProd: true }]);
  });
});
