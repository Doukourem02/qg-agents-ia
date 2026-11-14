import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '@/server/memoire';
import { CLES } from '@/server/qg';

let kv: KV = memoire();
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));

const demande = await import('@/app/api/qg/kuroro/demande/route');
const lecture = await import('@/app/api/qg/kuroro/reponse/route');
const suivante = await import('./suivante/route');
const reponse = await import('./reponse/route');
const eveil = await import('@/app/api/qg/kuroro/eveil/route');
const reveiller = (h: Record<string, string> = {}) => eveil.POST(new Request('http://qg/api/qg/kuroro/eveil', { method: 'POST', headers: h }));

const AGENT = { authorization: 'Bearer cle' };
const json = { 'content-type': 'application/json' };
const deposer = (corps: unknown, h: Record<string, string> = {}) =>
  demande.POST(new Request('http://qg/api/qg/kuroro/demande', { method: 'POST', headers: { ...json, ...h }, body: JSON.stringify(corps) }));
const lire = (id: string, h: Record<string, string> = {}) => lecture.GET(new Request(`http://qg/api/qg/kuroro/reponse?id=${encodeURIComponent(id)}`, { headers: h }));
const prendre = (h: Record<string, string> = AGENT, q = '?vu=1') => suivante.GET(new Request(`http://qg/api/agents/kuroro/suivante${q}`, { headers: h }));
const repondre = (corps: unknown, h: Record<string, string> = AGENT) =>
  reponse.POST(new Request('http://qg/api/agents/kuroro/reponse', { method: 'POST', headers: { ...json, ...h }, body: JSON.stringify(corps) }));
const conv = { messages: [{ role: 'moi', texte: 'vide le cache de mon Mac' }] };

beforeEach(() => {
  kv = memoire();
  process.env.QG_CLE_AGENTS = 'cle';
  delete process.env.QG_PASSE_AGENTS;
});

describe('Kuroro par le Mac : les routes', () => {
  it('les routes de la page refusent la clé des agents et le laissez-passer', async () => {
    expect((await deposer(conv, AGENT)).status).toBe(403);
    expect((await deposer(conv, { 'x-vercel-protection-bypass': 'x' })).status).toBe(403);
    expect((await lire('abc', AGENT)).status).toBe(403);
    expect((await reveiller(AGENT)).status).toBe(403);
  });

  it('les routes du Mac exigent la preuve des agents', async () => {
    expect((await prendre({})).status).toBe(401);
    expect((await prendre({ authorization: 'Bearer faux' })).status).toBe(401);
    expect((await repondre({ id: 'x', texte: 'ok' }, {})).status).toBe(401);
  });

  it('sans Mac vu : { mac: false } ; une conversation invalide : 400 ; un id mal formé : 400', async () => {
    expect(await (await deposer(conv)).json()).toEqual({ mac: false });
    expect((await deposer({ messages: [{ role: 'moi', texte: 'x'.repeat(301) }] })).status).toBe(400);
    expect((await lire('../x')).status).toBe(400);
  });

  it('le réveil : la page réveille, le Mac le lit dans « suivante » (sans se signaler s’il ne le demande pas)', async () => {
    expect(await (await reveiller()).json()).toEqual({ reveil: true });
    expect(await (await reveiller()).json()).toEqual({ reveil: false });
    expect(await (await prendre(AGENT, '')).json()).toMatchObject({ eveil: true, isaac: false, demande: null, prechauffage: { modele: 'qwen3:8b' } });
    expect(await (await deposer(conv)).json()).toEqual({ mac: false });
    await prendre(AGENT, '?allume=1');
    expect(await (await deposer(conv)).json()).toHaveProperty('id');
  });

  it('le tour complet : demande, le Mac prend, répond avec une mission ; le serveur la dépose et confirme honnêtement', async () => {
    expect(await (await prendre()).json()).toEqual({ eveil: false, isaac: false, demande: null }); // le Mac est vu
    const r = await deposer(conv);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const { id } = await r.json();
    expect(await (await lire(id)).json()).toEqual({ statut: 'attente' });
    const { demande: d } = await (await prendre()).json();
    expect(d).toMatchObject({ id, messages: conv.messages, modele: 'qwen3:8b' });
    expect(d.systeme).toContain('Isaac lit ses missions tout de suite');
    expect((await repondre({ id, texte: 'ok', mission: { agent: 'bob', mission: 'x' } })).status).toBe(400);
    expect(await kv.lrange(CLES.missions('isaac'), 0, -1)).toEqual([]);
    expect(await (await lire(id)).json()).toEqual({ statut: 'expiree' });
  });

  it('une mission valide : déposée une seule fois par le serveur, confirmation écrite par le code', async () => {
    await prendre();
    const { id } = await (await deposer(conv)).json();
    await prendre();
    const r = await repondre({ id, texte: 'Isaac a vidé ton cache.', mission: { agent: 'isaac', mission: 'Vider le cache du Mac' } });
    expect(await r.json()).toEqual({ ok: true, mission: { agent: 'isaac', nom: 'Isaac' } });
    expect((await repondre({ id, texte: 'ok', mission: { agent: 'isaac', mission: 'Vider le cache du Mac' } })).status).toBe(409);
    expect(await kv.lrange(CLES.missions('isaac'), 0, -1)).toHaveLength(1);
    const l = await (await lire(id)).json();
    expect(l).toMatchObject({ statut: 'prete', mission: { agent: 'isaac', nom: 'Isaac' } });
    expect(l.texte).toContain('Il te répond sur Telegram dans une minute environ, si ton Mac est allumé.');
    expect(l.texte).not.toContain('vidé');
  });
});
