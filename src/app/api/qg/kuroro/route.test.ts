import { describe, expect, it, vi } from 'vitest';
import { memoire } from '@/server/memoire';

const kv = memoire();
const connection = vi.fn(async () => undefined);
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));

const { POST } = await import('./route');
const appel = (corps: unknown, headers: Record<string, string> = {}) =>
  POST(new Request('http://qg/api/qg/kuroro', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corps) }));
const corps = { messages: [{ role: 'moi', texte: 'salut' }] };

describe('POST /api/qg/kuroro', () => {
  it('refuse le laissez-passer des routines et la clé des agents : réservé à la page', async () => {
    expect((await appel(corps, { 'x-vercel-protection-bypass': 'x' })).status).toBe(403);
    expect((await appel(corps, { authorization: 'Bearer x' })).status).toBe(403);
  });

  it('sans ANTHROPIC_API_KEY : { repli: true }, sans cache', async () => {
    const old = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const r = await appel(corps);
    process.env.ANTHROPIC_API_KEY = old;
    expect(connection).toHaveBeenCalled();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ repli: true });
  });

  it('un corps invalide : 400', async () => {
    expect((await appel({ messages: [{ role: 'moi', texte: 'x'.repeat(301) }] })).status).toBe(400);
    expect((await appel({})).status).toBe(400);
  });
});
