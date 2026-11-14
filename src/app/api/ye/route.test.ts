import { describe, expect, it, vi } from 'vitest';
import { memoire } from '@/server/memoire';
import { CLES_YE } from '@/server/ye/stockage';

const kv = memoire();
const fetchFaux = vi.fn(async () => new Response('', { status: 500 }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));
vi.stubGlobal('fetch', fetchFaux);

const { GET, POST } = await import('./route');
const poster = (corps: unknown, entetes: Record<string, string> = {}) =>
  POST(new Request('http://x/api/ye', { method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, body: JSON.stringify(corps) }));
const prop = {
  id: 'abcdef0123', lot: 'L', ficheId: 'f', rev: 'r', titre: 'Boutique Shop', depot: 'mon-compte/shop', set: { kind: 'Boutique' },
  changements: [{ champ: 'kind', avant: 'Site', apres: 'Boutique' }], raisons: [], quand: Date.now(), statut: 'attente',
};
const question = { id: 'abcdef0124', techno: 'Payload', cle: 'payload', titre: 'Boutique Shop', source: 'package.json', quand: Date.now(), statut: 'attente' };

describe('/api/ye', () => {
  it('GET : pas encore de passage', async () => {
    expect(await (await GET()).json()).toMatchObject({ passage: null, attente: [], questions: [] });
  });
  it('POST avec le laissez-passer des routines ou la clé des agents : refusé (403), rien changé', async () => {
    await kv.hset(CLES_YE.propositions, prop.id, JSON.stringify(prop));
    await kv.hset(CLES_YE.questions, question.id, JSON.stringify(question));
    expect((await poster({ valider: prop.id }, { 'x-vercel-protection-bypass': 'jeton' })).status).toBe(403);
    expect((await poster({ oui: question.id }, { authorization: 'Bearer cle' })).status).toBe(403);
    expect(JSON.parse((await kv.hgetall(CLES_YE.propositions))[prop.id]).statut).toBe('attente');
    expect(fetchFaux).not.toHaveBeenCalled();
  });
  it('POST invalide : deux actions, aucune, identifiant faux', async () => {
    expect((await poster({ valider: prop.id, refuser: prop.id })).status).toBe(400);
    expect((await poster({ autre: prop.id })).status).toBe(400);
    expect((await poster({ non: 'x' })).status).toBe(400);
  });
  it('POST { refuser } et { non } : notés, rien n\'est publié', async () => {
    const r = await (await poster({ refuser: prop.id })).json();
    expect(r.message).toBe('Noté : je laisse la fiche « Boutique Shop » telle quelle.');
    expect((await (await poster({ non: question.id })).json()).message).toBe('Noté : je ne te demanderai plus pour Payload.');
    expect(fetchFaux).not.toHaveBeenCalled();
  });
});
