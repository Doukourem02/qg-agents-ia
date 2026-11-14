import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { memoire, type KV } from './memoire';
import { CLES } from './qg';
import { CLES_CLARA } from './clara/stats';
import { vuesQG } from './vues';
import { DEBIT_PAR_MINUTE, MODELE, SYSTEME, VERITE_CLE, converser, entreeValide, faitsKuroro, lireConversation, type ClientKuroro } from './kuroro';

// Mardi 10 novembre 2026, 10:00 à Abidjan (= UTC).
const NOW = Date.UTC(2026, 10, 10, 10, 0);
let kv: KV;
beforeEach(() => { kv = memoire(); });

const msg = (stop_reason: Anthropic.Message['stop_reason'], content: unknown[]) =>
  ({ id: 'm', type: 'message', role: 'assistant', model: MODELE, stop_reason, stop_sequence: null, content, usage: {} }) as unknown as Anthropic.Message;
const texte = (t: string) => msg('end_turn', [{ type: 'text', text: t, citations: null }]);
const outil = (input: unknown) => msg('tool_use', [{ type: 'tool_use', id: 'tu1', name: 'confier_mission', input }]);

/** Un faux client : renvoie les réponses prévues, dans l'ordre, et garde les requêtes. */
function faux(...reponses: (Anthropic.Message | Error)[]) {
  const create = vi.fn(async (p: Anthropic.MessageCreateParamsNonStreaming) => {
    void p;
    const r = reponses.shift();
    if (!r) throw new Error('plus de réponse prévue');
    if (r instanceof Error) throw r;
    return r;
  });
  return { client: { messages: { create } } as ClientKuroro, create };
}
const moi = (t: string) => ({ messages: [{ role: 'moi', texte: t }] });
const missions = async (agent: string) => kv.lrange(CLES.missions(agent), 0, -1);

describe('Kuroro converse avec Claude', () => {
  it('une salutation : il répond, aucune mission', async () => {
    const { client, create } = faux(texte('Salut frère ! Ça va bien, merci. Tu veux que je te résume ce qui t’attend ?'));
    const r = await converser(moi('Salut comment tu vas'), { client, kv, now: NOW });
    // une salutation pure : la réponse est écrite par le code (le salut de l'heure, puis ce qu'il attend de Kuroro)
    expect(r).toEqual({ texte: 'Bonjour patron, je vais bien, merci. Qu’est-ce que je peux faire pour toi ?' });
    expect(create).toHaveBeenCalledTimes(1);
    const p = create.mock.calls[0][0];
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.messages).toEqual([{ role: 'user', content: 'Salut comment tu vas' }]);
    expect(p.tools?.map(t => ('name' in t ? t.name : null))).toEqual(['confier_mission']);
    expect(await missions('isaac')).toEqual([]);
  });

  it('une question (« qui est en charge de mon Mac ») : réponse tirée des faits, rien n’est confié', async () => {
    const { client, create } = faux(texte('C’est Isaac, notre concierge Mac (pôle Mac & Outils).'));
    const r = await converser(moi('je voudrais savoir qui est en charge de mon Mac'), { client, kv, now: NOW });
    expect(r).toEqual({ texte: 'C’est Isaac, notre concierge Mac (pôle Mac & Outils).' });
    // les faits donnés au modèle disent qui s'occupe du Mac
    const system = String(create.mock.calls[0][0].system);
    expect(system).toContain('"id":"isaac"');
    expect(system).toContain('Concierge Mac');
    expect(system.endsWith('humeur_de_patron (son dernier message) : neutre. Naturel.')).toBe(true);
    expect(await missions('isaac')).toEqual([]);
  });

  it('l’humeur de mon dernier message vient à la fin du prompt (agacé, familier)', async () => {
    const { client, create } = faux(texte('Pardon patron.'));
    await converser({ messages: [{ role: 'moi', texte: 'salut frère' }, { role: 'kuroro', texte: 'Salut !' }, { role: 'moi', texte: 'fais gaffe, la prochaine fois je ne tolérerai plus les retards' }] }, { client, kv, now: NOW });
    const system = String(create.mock.calls[0][0].system);
    expect(system.slice(system.lastIndexOf('humeur_de_patron'))).toMatch(/^humeur_de_patron \(son dernier message\) : agacé \(.*je ne tolérerai plus.*\)\. Excuse-toi en une phrase, franchement.* Il te parle familier : .*ne l’appelle jamais « frère »/);
  });

  it('un ordre : l’outil dépose la mission une fois chez le bon agent ; la réponse (qui, statut, « c’est noté ») est écrite par le code', async () => {
    const { client, create } = faux(msg('tool_use', [{ type: 'text', text: 'D’accord, patron.', citations: null }, { type: 'tool_use', id: 'tu1', name: 'confier_mission', input: { agent: 'isaac', mission: 'Vider le cache de mon Mac' } }]));
    const r = await converser(moi('vide le cache de mon Mac'), { client, kv, now: NOW });
    expect(r).toEqual({ texte: expect.stringMatching(/^D’accord, patron\. C’est Isaac qui s’en occupe \(Mac & Outils\)\. .*C’est noté, je me charge de l’informer\. Il te répond sur Telegram dans une minute environ, si ton Mac est allumé\.$/), mission: { agent: 'isaac', nom: 'Isaac' } });
    // un seul appel : le modèle choisit l'agent, il n'écrit pas la confirmation
    expect(create).toHaveBeenCalledTimes(1);
    const boite = await missions('isaac');
    expect(boite).toHaveLength(1);
    expect(JSON.parse(boite[0])).toMatchObject({ agent: 'isaac', texte: 'Vider le cache de mon Mac' });
  });

  it('un vrai agent qui ne lit pas la barre, un agent prévu : la réponse le dit, avec le statut réel', async () => {
    const a = faux(outil({ agent: 'clara', mission: 'Trier mes mails' }));
    const r = await converser(moi('trie mes mails'), { client: a.client, kv, now: NOW }) as { texte: string };
    expect(r.texte).toMatch(/^Entendu\. C’est Clara qui s’en occupe \(Mac & Outils\)\. /);
    expect(r.texte).toContain('C’est noté, je me charge de l’informer. Le passage des missions n’est pas encore en service : elle la verra sur sa fiche, et elle sera faite dès sa mise en service.');
    const b = faux(outil({ agent: 'malenia', mission: 'Ranger mes notes' }));
    expect(await converser(moi('range mes notes Notion'), { client: b.client, kv, now: NOW }))
      .toEqual({ texte: 'Entendu. C’est le rôle de Malenia, pas encore en service : c’est noté, je garde la mission de côté.', mission: { agent: 'malenia', nom: 'Malenia' } });
  });

  it('une entrée d’outil invalide : rien n’est déposé, une erreur est rendue au modèle', async () => {
    for (const input of [{ agent: 'inconnu', mission: 'x' }, { agent: 'kuroro', mission: 'x' }, { agent: 'isaac', mission: '' }, { agent: 'isaac', mission: 'x'.repeat(301) }, { agent: 'isaac' }, null]) {
      expect(entreeValide(input)).toBeNull();
    }
    const { client, create } = faux(outil({ agent: 'personne', mission: 'vide le cache' }), texte('À qui veux-tu que je la confie ?'));
    const r = await converser(moi('vide le cache'), { client, kv, now: NOW });
    expect(r).toEqual({ texte: 'À qui veux-tu que je la confie ?' });
    const resultat = (create.mock.calls[1][0].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0];
    expect(resultat.is_error).toBe(true);
    for (const a of ['isaac', 'personne', 'kuroro']) expect(await missions(a)).toEqual([]);
  });

  it('au plus 2 tours d’outil : le dernier appel n’a plus l’outil', async () => {
    const { client, create } = faux(outil({ agent: 'nope', mission: 'a' }), outil({ agent: 'nope', mission: 'b' }), texte('Je ne sais pas à qui la confier.'));
    await converser(moi('fais un truc'), { client, kv, now: NOW });
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[2][0].tools).toBeUndefined();
  });

  it('pas de clé (pas de client) : repli, sans appel', async () => {
    expect(await converser(moi('salut'), { client: null, kv, now: NOW })).toEqual({ repli: true });
  });

  it('/demo : repli, jamais d’appel', async () => {
    const { client, create } = faux(texte('x'));
    expect(await converser({ ...moi('salut'), demo: true }, { client, kv, now: NOW })).toEqual({ repli: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('erreur de l’API ou refus : repli ; après un dépôt, jamais de repli (la page redéposerait)', async () => {
    expect(await converser(moi('salut'), { client: faux(new Error('timeout')).client, kv, now: NOW })).toEqual({ repli: true });
    expect(await converser(moi('salut'), { client: faux(msg('refusal', [])).client, kv, now: NOW })).toEqual({ repli: true });
    const r = await converser(moi('vide le cache de mon Mac'), { client: faux(outil({ agent: 'isaac', mission: 'Vider le cache' })).client, kv, now: NOW });
    expect(r).toEqual({ texte: expect.stringContaining('Telegram'), mission: { agent: 'isaac', nom: 'Isaac' } });
  });

  it(`débit : au-delà de ${DEBIT_PAR_MINUTE} appels par minute, repli ; la minute suivante repart`, async () => {
    for (let i = 0; i < DEBIT_PAR_MINUTE; i++) expect(await converser(moi('quoi de neuf'), { client: faux(texte('Rien de neuf.')).client, kv, now: NOW })).toEqual({ texte: 'Rien de neuf.' });
    const { client, create } = faux(texte('Rien de neuf.'));
    expect(await converser(moi('quoi de neuf'), { client, kv, now: NOW + 30_000 })).toEqual({ repli: true });
    expect(create).not.toHaveBeenCalled();
    expect(await converser(moi('quoi de neuf'), { client, kv, now: NOW + 60_000 })).toEqual({ texte: 'Rien de neuf.' });
  });

  it('les limites : 300 caractères par message, rôles connus, au plus les 12 derniers tours', async () => {
    expect(() => lireConversation(moi('x'.repeat(301)))).toThrow(/trop long/);
    expect(() => lireConversation({ messages: [{ role: 'system', texte: 'x' }] })).toThrow();
    expect(() => lireConversation({ messages: [{ role: 'moi', texte: 'a' }, { role: 'kuroro', texte: 'b' }] })).toThrow(/dernier/);
    const longue = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'kuroro' : 'moi', texte: `t${i}` }));
    longue.push({ role: 'moi', texte: 'fin' });
    const tours = lireConversation({ messages: longue });
    expect(tours.length).toBeLessThanOrEqual(12);
    expect(tours[0].role).toBe('moi');
    expect(tours.at(-1)).toEqual({ role: 'moi', texte: 'fin' });
  });

  it('rien du texte des messages dans les journaux', async () => {
    const espion = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await converser(moi('mon secret très privé'), { client: faux(new Error('boum')).client, kv, now: NOW });
    for (const c of [...espion.mock.calls, ...log.mock.calls]) expect(JSON.stringify(c)).not.toContain('secret très privé');
    espion.mockRestore(); log.mockRestore();
  });
});

describe('Kuroro : les faits donnés au modèle', () => {
  it('contiennent la vérité clé, chaque agent, l’heure et l’astreinte ; ni secret, ni adresse, ni mail', async () => {
    await kv.hset(CLES_CLARA.vip, 'patron@exemple.com', JSON.stringify({ adresse: 'patron@exemple.com', depuis: NOW }));
    await kv.lpush(CLES.journal, JSON.stringify({ quand: NOW - 60_000, agent: 'L', type: 'etat', texte: 'lit https://exemple.com/secret et ecrit a moi@exemple.com', origine: 'agent' }));
    const old = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-cle';
    const faits = faitsKuroro(await vuesQG(kv, NOW), NOW);
    const json = JSON.stringify(faits);
    process.env.ANTHROPIC_API_KEY = old;
    // la vérité clé est dans les règles (une seule fois dans le prompt)
    expect(json).not.toContain(VERITE_CLE);
    expect(faits.heure_abidjan).toBe('il est 10:00, mardi matin (10 novembre 2026)');
    expect(faits.astreinte_cette_nuit).toBeTruthy();
    expect(faits.agents.map(a => a.id)).toContain('malenia');
    expect(faits.agents.find(a => a.id === 'isaac')).toMatchObject({ en_service: true, lit_les_missions_de_la_barre: true });
    expect(faits.agents.find(a => a.id === 'clara')).toMatchObject({ en_service: true });
    expect(faits.agents.find(a => a.id === 'clara')).not.toHaveProperty('lit_les_missions_de_la_barre');
    expect(faits.agents.find(a => a.id === 'malenia')).toMatchObject({ en_service: false });
    expect(json).not.toMatch(/https?:|www\.|@|sk-ant|KV_REST|TOKEN/i);
    expect(SYSTEME).toContain('Isaac lit ses missions tout de suite');
  });

  it('l’heure vient en dernier : tout ce qui la précède reste identique d’une minute à l’autre (le modèle local le garde en mémoire)', async () => {
    const vues = await vuesQG(kv, NOW);
    expect(Object.keys(faitsKuroro(vues, NOW)).at(-1)).toBe('heure_abidjan');
    const sans = (f: object) => JSON.stringify({ ...f, heure_abidjan: undefined });
    expect(sans(faitsKuroro(vues, NOW + 60_000))).toBe(sans(faitsKuroro(vues, NOW)));
  });
});
