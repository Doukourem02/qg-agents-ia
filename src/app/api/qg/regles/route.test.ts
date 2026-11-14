import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '@/server/memoire';
import { CLES } from '@/server/qg';
import { CLE_REGLES } from '@/server/regles';

let kv: KV = memoire();
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));

const route = await import('./route');
const agents = await import('../../agents/regles/route');
type Methode = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const appel = (m: Methode, corps?: unknown, entetes: Record<string, string> = {}) =>
  route[m](new Request('http://x/api/qg/regles', { method: m, headers: { 'content-type': 'application/json', ...entetes }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) }));
const json = async (r: Response) => (await r.json()) as { regles: { id: string; texte: string }[] };

beforeEach(() => {
  kv = memoire();
  process.env.QG_PASSE_AGENTS = 'passe';
  delete process.env.QG_CLE_AGENTS;
});

describe('/api/qg/regles (la page)', () => {
  it('ajoute, modifie, retire ; rien au journal', async () => {
    expect(await json(await appel('GET'))).toEqual({ regles: [] });
    const { regles: [r] } = await json(await appel('POST', { texte: 'Toujours en français.' }));
    expect(r.texte).toBe('Toujours en français.');
    expect((await json(await appel('PATCH', { id: r.id, texte: 'En français, toujours.' }))).regles.map(x => x.texte)).toEqual(['En français, toujours.']);
    expect((await json(await appel('DELETE', { id: r.id }))).regles).toEqual([]);
    expect(await kv.lrange(CLES.journal, 0, -1)).toEqual([]);
  });
  it('refuse le laissez-passer des routines et la clé des agents, sur chaque méthode', async () => {
    await kv.hset(CLE_REGLES, 'abcdefgh', JSON.stringify({ texte: 'x', quand: 1 }));
    for (const entetes of [{ 'x-vercel-protection-bypass': 'passe' }, { authorization: 'Bearer cle' }] as Record<string, string>[]) {
      expect((await appel('GET', undefined, entetes)).status).toBe(403);
      expect((await appel('POST', { texte: 'y' }, entetes)).status).toBe(403);
      expect((await appel('PATCH', { id: 'abcdefgh', texte: 'y' }, entetes)).status).toBe(403);
      expect((await appel('DELETE', { id: 'abcdefgh' }, entetes)).status).toBe(403);
    }
    expect(Object.keys(await kv.hgetall(CLE_REGLES))).toEqual(['abcdefgh']);
  });
  it('erreurs propres : corps vide, id inconnu, trop long', async () => {
    expect((await appel('POST', {})).status).toBe(400);
    expect((await appel('POST', { texte: 'x'.repeat(201) })).status).toBe(400);
    expect((await appel('PATCH', { id: 'inconnu1', texte: 'x' })).status).toBe(404);
    expect((await appel('DELETE', { id: '../x' })).status).toBe(400);
  });
});

describe('GET /api/agents/regles (les agents)', () => {
  const lire = (entetes: Record<string, string> = {}) => agents.GET(new Request('http://x/api/agents/regles', { headers: entetes }));
  it('exige la preuve des agents', async () => {
    expect((await lire()).status).toBe(401);
    expect((await lire({ 'x-vercel-protection-bypass': 'faux' })).status).toBe(401);
  });
  it('renvoie seulement les textes, dans l\'ordre', async () => {
    await appel('POST', { texte: 'Première.' });
    await appel('POST', { texte: 'Deuxième.' });
    const r = await lire({ 'x-vercel-protection-bypass': 'passe' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ regles: ['Première.', 'Deuxième.'] });
  });
});
