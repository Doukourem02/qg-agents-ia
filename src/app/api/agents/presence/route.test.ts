import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '@/server/memoire';
import { CLES } from '@/server/qg';
import { CLE_PRESENCE, lirePresence, presenceActive, presencesActives, PRESENCE_MAX } from '@/server/presence';

let kv: KV = memoire();
vi.mock('server-only', () => ({}));
vi.mock('@/server/kv', () => ({ getKV: () => ({ kv }) }));

const { POST } = await import('./route');
const poster = (corps: unknown, entetes: Record<string, string> = { 'x-vercel-protection-bypass': 'passe' }) =>
  POST(new Request('http://x/api/agents/presence', { method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, body: JSON.stringify(corps) }));
const journal = async () => (await kv.lrange(CLES.journal, 0, -1)).map(v => JSON.parse(v));
const etat = async () => JSON.parse((await kv.hgetall(CLES.etats)).stalker);

beforeEach(() => {
  kv = memoire();
  process.env.QG_PASSE_AGENTS = 'passe';
  delete process.env.QG_CLE_AGENTS;
});

describe('POST /api/agents/presence', () => {
  it('exige la preuve des agents', async () => {
    expect((await poster({ agent: 'stalker', actif: true }, {})).status).toBe(401);
    expect((await poster({ agent: 'stalker', actif: true }, { 'x-vercel-protection-bypass': 'faux' })).status).toBe(401);
    expect(await kv.hgetall(CLE_PRESENCE('stalker'))).toEqual({});
  });

  it('refuse un autre agent ou un « actif » mal formé', async () => {
    expect((await poster({ agent: 'luffy', actif: true })).status).toBe(400);
    expect((await poster({ agent: 'stalker', actif: 'oui' })).status).toBe(400);
    expect((await poster({ agent: 'stalker' })).status).toBe(400);
  });

  it('actif : présence notée, état « au travail » avec le projet, une seule entrée au journal malgré les signes répétés', async () => {
    for (let i = 0; i < 5; i++) expect((await poster({ agent: 'stalker', actif: true, projet: 'QG' })).status).toBe(200);
    expect(await lirePresence(kv, 'stalker')).toMatchObject({ actif: true, projet: 'QG' });
    expect(await etat()).toMatchObject({ agent: 'stalker', statut: 'au travail', tache: 'travaille avec toi sur QG', outil: 'C' });
    expect(await journal()).toHaveLength(1);
    // la fin : un état « termine » et une seule entrée de plus
    await poster({ agent: 'stalker', actif: false });
    await poster({ agent: 'stalker', actif: false });
    expect(await etat()).toMatchObject({ statut: 'termine', tache: 'a fini avec toi' });
    const j = await journal();
    expect(j).toHaveLength(2);
    expect(j.map(e => e.texte)).toEqual(['a fini avec toi', 'travaille avec toi sur QG']);
    expect(await presencesActives(kv)).toEqual([]);
  });

  it('sans projet : « travaille avec toi »', async () => {
    await poster({ agent: 'stalker', actif: true });
    expect((await etat()).tache).toBe('travaille avec toi');
    expect(await presencesActives(kv)).toEqual(['stalker']);
  });

  it('une présence compte 15 min après le dernier signe, pas plus', () => {
    const now = 1_000_000_000;
    expect(presenceActive({ actif: true, quand: now - PRESENCE_MAX + 1 }, now)).toBe(true);
    expect(presenceActive({ actif: true, quand: now - PRESENCE_MAX }, now)).toBe(false);
    expect(presenceActive({ actif: false, quand: now }, now)).toBe(false);
    expect(presenceActive(null, now)).toBe(false);
  });
});
