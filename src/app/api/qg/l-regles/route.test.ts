import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '@/server/memoire';
import { CLES } from '@/server/qg';
import { ajouterRegle, lireMemoire } from '@/server/l/memoire';

let kv: KV = memoire();
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));

const route = await import('./route');
type Methode = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const appel = (m: Methode, corps?: unknown, entetes: Record<string, string> = {}) =>
  route[m](new Request('http://x/api/qg/l-regles', { method: m, headers: { 'content-type': 'application/json', ...entetes }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) }));

beforeEach(() => { kv = memoire(); });

describe('/api/qg/l-regles', () => {
  it('ajoute, corrige, retire les leçons de L ; rien au journal', async () => {
    await ajouterRegle(kv, 'Posts courts.');
    expect(await (await appel('GET')).json()).toEqual({ regles: ['Posts courts.'] });
    expect(await (await appel('POST', { regle: 'Pas de tiret long.' })).json()).toEqual({ regles: ['Posts courts.', 'Pas de tiret long.'] });
    expect(await (await appel('PATCH', { ancienne: 'Posts courts.', regle: 'Moins de 1200 caractères.' })).json()).toEqual({ regles: ['Moins de 1200 caractères.', 'Pas de tiret long.'] });
    expect(await (await appel('DELETE', { regle: 'Pas de tiret long.' })).json()).toEqual({ regles: ['Moins de 1200 caractères.'] });
    expect((await lireMemoire(kv)).regles).toEqual(['Moins de 1200 caractères.']);
    expect(await kv.lrange(CLES.journal, 0, -1)).toEqual([]);
  });
  it('refuse les routines ; erreurs propres', async () => {
    await ajouterRegle(kv, 'a');
    for (const entetes of [{ 'x-vercel-protection-bypass': 'p' }, { authorization: 'Bearer c' }] as Record<string, string>[]) {
      expect((await appel('GET', undefined, entetes)).status).toBe(403);
      expect((await appel('POST', { regle: 'b' }, entetes)).status).toBe(403);
      expect((await appel('PATCH', { ancienne: 'a', regle: 'b' }, entetes)).status).toBe(403);
      expect((await appel('DELETE', { regle: 'a' }, entetes)).status).toBe(403);
    }
    expect((await lireMemoire(kv)).regles).toEqual(['a']);
    expect((await appel('POST', {})).status).toBe(400);
    expect((await appel('PATCH', { ancienne: 'zz', regle: 'b' })).status).toBe(404);
    expect((await appel('DELETE', { regle: 'zz' })).status).toBe(404);
  });
});
