import { describe, expect, it, vi } from 'vitest';
import { memoire } from '@/server/memoire';
import { CLES_PAUL } from '@/server/paul/stockage';

const kv = memoire();
const fetchFaux = vi.fn(async () => new Response('', { status: 500 }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));
vi.stubGlobal('fetch', fetchFaux);

const { GET, POST } = await import('./route');
const poster = (corps: unknown, entetes: Record<string, string> = {}) =>
  POST(new Request('http://x/api/paul', { method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, body: JSON.stringify(corps) }));
const prop = {
  id: 'abcdef0123', lot: 'L1', depot: 'mon-compte/qg', branche: 'main', fichier: 'README.md', base: 'b', contenu: 'tout le README',
  raisons: [{ texte: 'r', source: 'README.md' }], diff: [{ sorte: '+', texte: 'x' }], ajoutees: 1, retirees: 0, quand: Date.now(), statut: 'attente',
};

describe('/api/paul', () => {
  it('GET : pas encore de passage', async () => {
    expect(await (await GET()).json()).toMatchObject({ passage: null, attente: [], refusQG: [], recentes: [] });
  });
  it('GET : la proposition en attente, sans le fichier complet', async () => {
    await kv.hset(CLES_PAUL.propositions, prop.id, JSON.stringify(prop));
    const v = await (await GET()).json();
    expect(v.attente).toHaveLength(1);
    expect(v.attente[0].contenu).toBeUndefined();
    expect(v.attente[0].diff).toEqual([{ sorte: '+', texte: 'x' }]);
  });
  it('POST avec le laissez-passer des routines : refusé (403), rien changé', async () => {
    expect((await poster({ valider: prop.id }, { 'x-vercel-protection-bypass': 'jeton' })).status).toBe(403);
    expect(JSON.parse((await kv.hgetall(CLES_PAUL.propositions))[prop.id]).statut).toBe('attente');
    expect(fetchFaux).not.toHaveBeenCalled();
  });
  it('POST avec la clé des agents (authorization) : refusé (403) comme les autres routes de la page', async () => {
    expect((await poster({ valider: prop.id }, { authorization: 'Bearer cle' })).status).toBe(403);
    expect(JSON.parse((await kv.hgetall(CLES_PAUL.propositions))[prop.id]).statut).toBe('attente');
    expect(fetchFaux).not.toHaveBeenCalled();
  });
  it('POST invalide : identifiant faux, les deux champs, aucun champ', async () => {
    expect((await poster({ valider: 'n\'importe quoi' })).status).toBe(400);
    expect((await poster({ valider: prop.id, refuser: prop.id })).status).toBe(400);
    expect((await poster({ autre: prop.id })).status).toBe(400);
  });
  it('POST { refuser } : refusée, rien n\'est écrit sur GitHub, la vue mise à jour revient', async () => {
    const r = await poster({ refuser: prop.id });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.message).toBe('Noté : je laisse README.md de qg tel quel.');
    expect(j.vue.attente).toEqual([]);
    expect(j.vue.recentes[0]).toMatchObject({ id: prop.id, statut: 'refusee' });
    expect(fetchFaux).not.toHaveBeenCalled();
  });
});
