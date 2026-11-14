import { describe, expect, it, vi } from 'vitest';
import { memoire } from '@/server/memoire';
import { CLES_LEA } from '@/server/lea/relecture';

const kv = memoire();
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));

const { GET, POST } = await import('./route');
const poster = (corps: unknown, entetes: Record<string, string> = {}) =>
  POST(new Request('http://x/api/lea', { method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, body: JSON.stringify(corps) }));
const constat = { id: 'ia|L1|00', depot: 'a', sha: 's', message: 'm', fichier: 'f', ligne: 1, gravite: 'grave', quoi: 'q', conseil: 'c', source: 'lea', quand: 1, statut: 'ouvert' };

describe('/api/lea', () => {
  it('GET : pas encore de relecture', async () => {
    expect(await (await GET()).json()).toMatchObject({ passage: null, absente: true, constats: [], relectures: [] });
  });
  it('POST avec le laissez-passer des routines : refusé (403), rien changé', async () => {
    await kv.hset(CLES_LEA.constats, constat.id, JSON.stringify(constat));
    expect((await poster({ vu: constat.id }, { 'x-vercel-protection-bypass': 'jeton' })).status).toBe(403);
    expect(JSON.parse((await kv.hgetall(CLES_LEA.constats))[constat.id]).statut).toBe('ouvert');
  });
  it('POST avec un identifiant invalide ou un autre champ : refusé', async () => {
    expect((await poster({ vu: 'n\'importe quoi' })).status).toBe(400);
    expect((await poster({ vu: 12 })).status).toBe(400);
    expect((await poster({ autre: 'ia|L1|00' })).status).toBe(400);
  });
  it('POST sur un constat inconnu : 404', async () => {
    expect((await poster({ vu: 'ia|inconnu|00' })).status).toBe(404);
  });
  it('POST { vu } : le constat passe à « vu » et la vue mise à jour revient', async () => {
    const r = await poster({ vu: constat.id });
    expect(r.status).toBe(200);
    expect((await r.json()).constats[0]).toMatchObject({ id: constat.id, statut: 'vu' });
  });
});
