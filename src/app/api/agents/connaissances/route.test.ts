import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '@/server/memoire';
import FICHIER from '@/data/connaissances.json';
import { lireConnaissances } from '@/server/connaissances';

let kv: KV = memoire();
vi.mock('server-only', () => ({}));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));

const { POST } = await import('./route');
const poster = (corps: string, entetes: Record<string, string> = { 'x-vercel-protection-bypass': 'passe' }) =>
  POST(new Request('http://x/api/agents/connaissances', { method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, body: corps }));

beforeEach(() => {
  kv = memoire();
  process.env.QG_PASSE_AGENTS = 'passe';
  delete process.env.QG_CLE_AGENTS;
});

describe('POST /api/agents/connaissances', () => {
  it('exige la preuve des agents', async () => {
    expect((await poster(JSON.stringify(FICHIER), {})).status).toBe(401);
    expect((await poster(JSON.stringify(FICHIER), { 'x-vercel-protection-bypass': 'faux' })).status).toBe(401);
  });
  it('range une version valide, lue ensuite par Kuroro', async () => {
    const c = JSON.parse(JSON.stringify(FICHIER));
    c.projet.quoi = 'Version de la semaine.';
    const r = await poster(JSON.stringify(c));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, personnages: 17 });
    expect((await lireConnaissances(kv)).projet.quoi).toBe('Version de la semaine.');
  });
  it('refuse JSON cassé, forme fausse et corps énorme', async () => {
    expect((await poster('{cassé')).status).toBe(400);
    expect((await poster(JSON.stringify({ projet: { quoi: 'x' }, personnages: [] }))).status).toBe(400);
    expect((await poster(JSON.stringify({ x: 'a'.repeat(20_000) }))).status).toBe(413);
  });
});
