import { describe, expect, it, vi } from 'vitest';
import { memoire } from '@/server/memoire';
import { CLES_CLARA } from '@/server/clara/stats';

const kv = memoire();
const connection = vi.fn(async () => undefined);
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));

const { POST } = await import('./route');
const poster = (corps: unknown, entetes: Record<string, string> = {}) =>
  POST(new Request('http://x/api/clara', { method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, body: JSON.stringify(corps) }));
const banni = () => kv.hset(CLES_CLARA.bannis, 'b1', JSON.stringify({ adresse: 'spam@x.com', depuis: 5, deplaces: 1, dernierUid: 9 }));

describe('POST /api/clara', () => {
  it('F8 : le laissez-passer des routines est refusé (403) : seule la page change VIP et bannis', async () => {
    await banni();
    const r = await poster({ debannir: 'b1' }, { 'x-vercel-protection-bypass': 'jeton' });
    expect(r.status).toBe(403);
    expect(Object.keys(await kv.hgetall(CLES_CLARA.bannis))).toEqual(['b1']);
    expect((await poster({ vip: 'a@b.com', ajout: true }, { 'x-vercel-protection-bypass': 'jeton' })).status).toBe(403);
    expect(await kv.hgetall(CLES_CLARA.vip)).toEqual({});
  });
  it('F8 : « debannir » mal formé refusé ; bien formé accepté ; connection() attendu', async () => {
    await banni();
    for (const d of ['B1!', 'clara:verrou', 'a'.repeat(17)]) expect((await poster({ debannir: d })).status).toBe(400);
    expect(Object.keys(await kv.hgetall(CLES_CLARA.bannis))).toEqual(['b1']);
    connection.mockClear();
    expect((await poster({ debannir: 'b1' })).status).toBe(200);
    expect(connection).toHaveBeenCalled();
    expect(await kv.hgetall(CLES_CLARA.bannis)).toEqual({});
  });
});
