import { describe, expect, it, vi } from 'vitest';
import { memoire } from '@/server/memoire';
import { CLE_VISITE } from '@/server/comptes-rendus';

const kv = memoire();
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));

const { GET, POST } = await import('./route');
const poster = (corps: unknown, entetes: Record<string, string> = {}) =>
  POST(new Request('http://x/api/qg/comptes-rendus', { method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, body: JSON.stringify(corps) }));

describe('/api/qg/comptes-rendus', () => {
  it('GET : liste vide et première visite', async () => {
    expect(await (await GET()).json()).toMatchObject({ depuis: null, liste: [] });
  });
  it('POST { vu: true } enregistre la visite ; autre corps refusé ; laissez-passer des routines refusé', async () => {
    expect((await poster({ vu: false })).status).toBe(400);
    expect((await poster({ vu: true }, { 'x-vercel-protection-bypass': 'j' })).status).toBe(403);
    expect(await kv.hgetall(CLE_VISITE)).toEqual({});
    expect((await poster({ vu: true }, { authorization: 'Bearer x' })).status).toBe(403);
    expect((await poster({ vu: true })).status).toBe(200);
    expect(Number((await kv.hgetall(CLE_VISITE)).quand)).toBeGreaterThan(0);
    expect((await (await GET()).json()).depuis).toBeGreaterThan(0);
  });
});
