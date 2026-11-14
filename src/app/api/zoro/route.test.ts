import { describe, expect, it, vi } from 'vitest';
import { memoire } from '@/server/memoire';
import { CLES_ZORO, rapportDemande } from '@/server/zoro/mac';

const kv = memoire();
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));
vi.mock('@/server/zoro/reel', () => ({
  depsZoro: () => ({ fetch: async () => new Response('{}', { status: 500 }), envoyer: vi.fn(), jeton: undefined, linkedin: async () => null }),
}));

const route = await import('./route');
const { GET, POST } = route;
const poster = (entetes: Record<string, string> = {}) => POST(new Request('http://x/api/zoro', { method: 'POST', headers: entetes }));

describe('/api/zoro', () => {
  it('le POST fait un tour entier (jusqu\'à 240 s) : même durée maximale que la route d\'agent, 300 s', async () => {
    expect((route as { maxDuration?: number }).maxDuration).toBe(300);
    const agent = await import('../agents/zoro/[action]/route');
    expect(agent.maxDuration).toBe(300);
  });
  it('POST avec le laissez-passer des routines : refusé (403), aucun tour', async () => {
    expect((await poster({ 'x-vercel-protection-bypass': 'jeton' })).status).toBe(403);
    expect(await kv.hgetall(CLES_ZORO.tour)).toEqual({});
  });
  it('GET : pas encore de tour', async () => {
    const v = await (await GET()).json();
    expect(v).toMatchObject({ dernier: null, historique: [] });
  });
  it('POST : un tour « verifier » puis la demande d\'un rapport frais du Mac ; ni historique', async () => {
    const r = await poster();
    expect(r.status).toBe(200);
    const v = await r.json();
    expect(v.dernier).toMatchObject({ type: 'verifier' });
    expect(v.historique).toEqual([]);
    expect(await rapportDemande(kv)).toBe(true);
  });
  it('POST pendant un tour en cours : { occupe: true }', async () => {
    await kv.setnx(CLES_ZORO.verrou, '1', 60);
    expect((await (await poster()).json()).occupe).toBe(true);
  });
});
