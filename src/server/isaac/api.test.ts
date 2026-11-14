import { describe, expect, it } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES, deposerMission, Refus } from '../qg';
import type { Bouton } from '../telegram';
import { CLES_ISAAC, codeDe, deciderIsaac, traiterActionIsaac, type Proposition } from './api';

const GO = 1024 ** 3;
const NOW = Date.parse('2026-11-10T10:00:00Z');
const JOUR = 86_400_000;
const MIN = 60_000;
const prop = (id: string, extra: Record<string, unknown> = {}) => ({
  id, genre: 'cache', libelle: `caches de ${id}`, taille: 3 * GO, impact: 'ils se refont tout seuls', cibles: [`/Users/m/Library/Caches/${id}`], ...extra,
});

function banc() {
  const kv = memoire();
  const envois: { texte: string; boutons?: Bouton[][] }[] = [];
  const deps = { envoyer: async (texte: string, boutons?: Bouton[][]) => { envois.push({ texte, boutons }); } };
  const agir = (action: string, corps: Record<string, unknown> = {}, now = NOW) => traiterActionIsaac(kv, action, corps, deps, now);
  return { kv, envois, agir };
}
const toutes = async (kv: KV) => Object.fromEntries(Object.entries(await kv.hgetall(CLES_ISAAC.propositions)).map(([k, v]) => [k, JSON.parse(v) as Proposition]));
const aFaire = async (b: ReturnType<typeof banc>) => (await b.agir('a-faire')) as { acceptees: Proposition[]; missions: { texte: string }[] };
const journal = async (kv: KV) => (await kv.lrange(CLES.journal, 0, 50)).map(v => JSON.parse(v) as { agent: string; texte: string });

describe('Isaac : proposer', () => {
  it('un seul message pour 3 propositions, une rangée de boutons chacune', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('cache:cursor', { libelle: 'caches de Cursor' }), prop('nm:qg'), prop('sim:vieux')] });
    expect(b.envois).toHaveLength(1);
    const { texte, boutons } = b.envois[0];
    expect(texte.split('\n')[0]).toBe('🧹 Isaac propose de libérer de la place :');
    expect(texte).toContain('• caches de Cursor — 3,0 Go — ils se refont tout seuls');
    expect(boutons).toHaveLength(3);
    expect(boutons![0]).toEqual([{ texte: 'Oui · caches de Cursor', donnee: `isc:o:${codeDe('cache:cursor')}` }, { texte: 'Non', donnee: `isc:n:${codeDe('cache:cursor')}` }]);
  });
  it('libellé long : tronqué à ~24 caractères dans le bouton', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('x', { libelle: 'caches de Visual Studio Code et plus encore' })] });
    expect(b.envois[0].boutons![0][0].texte.length).toBeLessThanOrEqual('Oui · '.length + 24);
    expect(b.envois[0].boutons![0][0].texte.endsWith('…')).toBe(true);
  });
  it('la 4e proposition est ignorée', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: ['a', 'b', 'c', 'd'].map(i => prop(i)) });
    expect(Object.keys(await toutes(b.kv)).sort()).toEqual(['a', 'b', 'c']);
    expect(b.envois[0].boutons).toHaveLength(3);
  });
  it('refusé il y a 10 jours : pas reproposé ; il y a 31 jours : reproposé', async () => {
    const b = banc();
    await b.kv.hset(CLES_ISAAC.refus, 'recent', String(NOW - 10 * JOUR));
    await b.kv.hset(CLES_ISAAC.refus, 'ancien', String(NOW - 31 * JOUR));
    await b.agir('proposer', { propositions: [prop('recent'), prop('ancien')] });
    expect(Object.keys(await toutes(b.kv))).toEqual(['ancien']);
    expect(b.envois).toHaveLength(1);
  });
  it('rien à proposer : aucun message', async () => {
    const b = banc();
    await b.kv.hset(CLES_ISAAC.refus, 'a', String(NOW - JOUR));
    await b.agir('proposer', { propositions: [prop('a')] });
    expect(b.envois).toHaveLength(0);
  });
  it('déjà proposée ou acceptée : pas reproposée', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('a'), prop('b')] });
    await deciderIsaac(b.kv, 'b', true, NOW);
    await b.agir('proposer', { propositions: [prop('a'), prop('b')] });
    expect(b.envois).toHaveLength(1);
    expect((await toutes(b.kv)).b.statut).toBe('oui');
  });
  it('journalise « propose : … »', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('a')] });
    expect((await journal(b.kv))[0]).toMatchObject({ agent: 'isaac', texte: expect.stringContaining('propose : caches de a') });
  });
  it('proposition illisible : refus', async () => {
    const b = banc();
    await expect(b.agir('proposer', { propositions: [{ id: 'x' }] })).rejects.toBeInstanceOf(Refus);
  });
});

describe('Isaac : boutons Telegram (64 octets)', () => {
  it.each([['70 caractères', 'cache:' + 'x'.repeat(64)], ['accentué', 'nm:projet-été-éléphant-à-côté-' + 'é'.repeat(30)]])('id %s : callback_data <= 64 octets, le clic se résout', async (_n, id) => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop(id)] });
    for (const bt of b.envois[0].boutons![0]) expect(Buffer.byteLength(bt.donnee)).toBeLessThanOrEqual(64);
    const code = b.envois[0].boutons![0][0].donnee.split(':')[2];
    expect(await deciderIsaac(b.kv, code, true, NOW)).toContain('Noté');
    expect((await toutes(b.kv))[id].statut).toBe('oui');
  });
  it('envoi en échec : les propositions rangées sont retirées et pourront revenir', async () => {
    const b = banc();
    const casse = { envoyer: async () => { throw new Error('telegram en panne'); } };
    await expect(traiterActionIsaac(b.kv, 'proposer', { propositions: [prop('a')] }, casse, NOW)).rejects.toThrow('telegram');
    expect(await toutes(b.kv)).toEqual({});
    expect(await b.kv.hgetall(CLES_ISAAC.codes)).toEqual({});
    await b.agir('proposer', { propositions: [prop('a')] });
    expect(b.envois).toHaveLength(1);
  });
});

describe('Isaac : Oui / Non', () => {
  it('Oui deux fois : statut « oui » une seule fois, puis « déjà noté »', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('a')] });
    expect(await deciderIsaac(b.kv, 'a', true, NOW)).toContain('Noté');
    const decide = (await toutes(b.kv)).a.decide;
    expect(await deciderIsaac(b.kv, 'a', true, NOW + 5000)).toBe('Tu as déjà dit Oui pour « caches de a » : je l\'efface dans la minute, si ton Mac est allumé.');
    expect(await deciderIsaac(b.kv, 'a', false, NOW + 6000)).toContain('déjà dit Oui'); // un Non tardif ne défait rien
    const a = (await toutes(b.kv)).a;
    expect(a.statut).toBe('oui');
    expect(a.decide).toBe(decide);
  });
  it('Non : statut « non » et horodatage dans isaac:refus', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('a')] });
    await deciderIsaac(b.kv, 'a', false, NOW);
    expect((await toutes(b.kv)).a.statut).toBe('non');
    expect((await b.kv.hgetall(CLES_ISAAC.refus)).a).toBe(String(NOW));
  });
  it('proposition inconnue : réponse polie, rien créé', async () => {
    const b = banc();
    expect(await deciderIsaac(b.kv, 'zzz', true)).toContain('inconnue');
    expect(await toutes(b.kv)).toEqual({});
  });
});

describe('Isaac : a-faire (RF 1)', () => {
  it('ne rend que « oui », jamais « proposee » ni « non », et ne marque rien', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('a'), prop('b'), prop('c')] });
    await deciderIsaac(b.kv, 'a', true, NOW);
    await deciderIsaac(b.kv, 'b', false, NOW);
    for (let i = 0; i < 3; i++) expect((await aFaire(b)).acceptees.map(p => p.id)).toEqual(['a']); // rejoué : pareil
    expect((await toutes(b.kv)).a.statut).toBe('oui');
  });
  it('rien d\'accepté : liste vide, et « vu » est posé', async () => {
    const b = banc();
    expect((await aFaire(b)).acceptees).toEqual([]);
    expect((await b.kv.hgetall(CLES_ISAAC.vu)).relais).toBe(String(NOW));
  });
  it('« vide le cache » déposé pour Kuroro arrive dans les missions d\'Isaac, journalisé', async () => {
    const b = banc();
    await deposerMission(b.kv, { texte: 'vide le cache' }, NOW);
    const r = await aFaire(b);
    expect(r.missions.map(m => m.texte)).toEqual(['vide le cache']);
    expect((await aFaire(b)).missions).toEqual([]);
    expect((await journal(b.kv)).some(e => e.agent === 'isaac' && e.texte.startsWith('mission prise : vide le cache'))).toBe(true);
  });
});

describe('Isaac : fait', () => {
  it('passe à « faite », n\'est plus rendu, Telegram « Fait », journal « libère »', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('a')] });
    await deciderIsaac(b.kv, 'a', true, NOW);
    await b.agir('fait', { id: 'a', libere: 9 * GO, libre: 35 * GO });
    const a = (await toutes(b.kv)).a;
    expect(a).toMatchObject({ statut: 'faite', libere: 9 * GO });
    expect((await aFaire(b)).acceptees).toEqual([]);
    expect(b.envois.at(-1)!.texte).toBe('🧹 Fait : 9,0 Go libérés. Il reste 35,0 Go libres.');
    expect((await journal(b.kv))[0].texte).toContain('libère 9,0 Go');
  });
  it('refus du Mac : « refusee-mac », plus rendu', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('a')] });
    await deciderIsaac(b.kv, 'a', true, NOW);
    await b.agir('fait', { id: 'a', refus: true, raison: 'Cursor est ouvert' });
    expect((await toutes(b.kv)).a).toMatchObject({ statut: 'refusee-mac', raison: 'Cursor est ouvert' });
    expect((await aFaire(b)).acceptees).toEqual([]);
    expect(b.envois.at(-1)!.texte).toBe("Isaac n'a rien supprimé pour caches de a : Cursor est ouvert.");
    await b.agir('proposer', { propositions: [prop('a')] }, NOW + 23 * 3_600_000);
    expect(b.envois).toHaveLength(2); // proposition initiale + message du refus : pas reproposé avant 24 h
    await b.agir('proposer', { propositions: [prop('a')] }, NOW + 25 * 3_600_000);
    expect(b.envois).toHaveLength(3);
  });
  it('« fait » sur une proposition jamais acceptée : 409, rien ne change', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('a')] });
    await expect(b.agir('fait', { id: 'a', libere: 1, libre: 1 })).rejects.toMatchObject({ code: 409 });
    expect((await toutes(b.kv)).a.statut).toBe('proposee');
  });
  it('proposition inconnue : 404 ; action inconnue : 404', async () => {
    const b = banc();
    await expect(b.agir('fait', { id: 'zzz', libere: 1, libre: 1 })).rejects.toMatchObject({ code: 404 });
    await expect(b.agir('zzz')).rejects.toMatchObject({ code: 404 });
  });
});

describe('Isaac : rapport', () => {
  it('range la place et « vu », sans journal', async () => {
    const b = banc();
    await b.agir('rapport', { libre: 30 * GO, total: 500 * GO });
    expect(JSON.parse((await b.kv.hgetall(CLES_ISAAC.place)).mesure)).toMatchObject({ libre: 30 * GO, total: 500 * GO });
    expect((await b.kv.hgetall(CLES_ISAAC.vu)).relais).toBe(String(NOW));
    expect(await journal(b.kv)).toEqual([]);
  });
});

describe('Isaac : mission (suivi jusqu\'au bout)', () => {
  const etats = async (kv: KV) => JSON.parse((await kv.hgetall(CLES.etats)).isaac) as { tache: string; outil: string };
  it('prise : état en direct (le journal l\'a déjà par a-faire), outil Mac', async () => {
    const b = banc();
    await b.agir('mission', { id: 'm1', texte: 'vide le cache', etat: 'prise' });
    expect(await etats(b.kv)).toMatchObject({ tache: 'mission prise : vide le cache', outil: 'Mac' });
    expect(await journal(b.kv)).toEqual([]);
    expect(b.envois).toEqual([]);
  });
  it('proposee : journal « mission : propositions envoyées », pas de Telegram (le message des propositions suffit)', async () => {
    const b = banc();
    await b.agir('mission', { id: 'm1', texte: 'vide le cache', etat: 'proposee' });
    expect((await journal(b.kv)).map(e => e.texte)).toEqual(['mission : propositions envoyées']);
    expect(b.envois).toEqual([]);
  });
  it('rien : journal et Telegram avec la place libre', async () => {
    const b = banc();
    await b.agir('mission', { id: 'm1', texte: 'fais de la place', etat: 'rien', libre: 26.4 * GO });
    expect((await journal(b.kv)).map(e => e.texte)).toEqual(['mission : rien à libérer']);
    expect(b.envois.map(e => e.texte)).toEqual(['Isaac n\'a rien trouvé à libérer pour l\'instant (26,4 Go libres).']);
  });
  it('rien sans libre : Telegram sans chiffre', async () => {
    const b = banc();
    await b.agir('mission', { id: 'm1', texte: 'x', etat: 'rien' });
    expect(b.envois.map(e => e.texte)).toEqual(['Isaac n\'a rien trouvé à libérer pour l\'instant.']);
  });
  it('rejoué (même id, même état) : une seule fois', async () => {
    const b = banc();
    await b.agir('mission', { id: 'm1', texte: 'x', etat: 'rien', libre: GO });
    await b.agir('mission', { id: 'm1', texte: 'x', etat: 'rien', libre: GO });
    expect(b.envois).toHaveLength(1);
    expect(await journal(b.kv)).toHaveLength(1);
  });
  it('Telegram en échec : rien n\'est retenu, le relais pourra redire', async () => {
    const kv = memoire();
    let n = 0;
    const deps = { envoyer: async () => { n++; if (n === 1) throw new Error('telegram'); } };
    await expect(traiterActionIsaac(kv, 'mission', { id: 'm1', texte: 'x', etat: 'rien' }, deps, NOW)).rejects.toThrow('telegram');
    await traiterActionIsaac(kv, 'mission', { id: 'm1', texte: 'x', etat: 'rien' }, deps, NOW);
    expect(n).toBe(2);
  });
  it('refuse un état inconnu, un id manquant ou un libre invalide', async () => {
    const b = banc();
    await expect(b.agir('mission', { id: 'm1', texte: 'x', etat: 'faite' })).rejects.toBeInstanceOf(Refus);
    await expect(b.agir('mission', { texte: 'x', etat: 'rien' })).rejects.toBeInstanceOf(Refus);
    await expect(b.agir('mission', { id: 'm1', texte: 'x', etat: 'rien', libre: -1 })).rejects.toBeInstanceOf(Refus);
  });
});

describe('Isaac : relecture finale', () => {
  const proposerEt = async (b: ReturnType<typeof banc>, ids: string[], now = NOW) => b.agir('proposer', { propositions: ids.map(id => prop(id)) }, now);
  it('un Oui donné plus de 7 jours après la proposition : refusé, marqué expirée', async () => {
    const b = banc();
    await proposerEt(b, ['a']);
    expect(await deciderIsaac(b.kv, 'a', true, NOW + 8 * JOUR)).toMatch(/trop ancienne/);
    expect((await toutes(b.kv)).a.statut).toBe('expiree');
  });
  it('a-faire ne rend pas un « oui » de plus de 7 jours (expiré)', async () => {
    const b = banc();
    await proposerEt(b, ['a', 'b']);
    await deciderIsaac(b.kv, 'a', true, NOW + JOUR);
    await deciderIsaac(b.kv, 'b', true, NOW + JOUR);
    const r = (await b.agir('a-faire', {}, NOW + 8 * JOUR)) as { acceptees: Proposition[] };
    expect(r.acceptees).toEqual([]);
    expect((await toutes(b.kv)).a.statut).toBe('expiree');
  });
  it('une proposition restée sans réponse 7 jours peut être reproposée', async () => {
    const b = banc();
    await proposerEt(b, ['a']);
    const r = (await proposerEt(b, ['a'], NOW + 8 * JOUR)) as { proposees: string[] };
    expect(r.proposees).toEqual(['a']);
  });
  it('proposer dit ce qui attend déjà une réponse et ce qui a été écarté (refusé, en pause)', async () => {
    const b = banc();
    await proposerEt(b, ['a', 'r']);
    await deciderIsaac(b.kv, 'r', false, NOW);
    const r = await proposerEt(b, ['a', 'r', 'n'], NOW + JOUR);
    expect(r).toEqual({ proposees: ['n'], enAttente: ['a'], ecartees: ['r'] });
  });
  it('faits : tous les résultats d\'un passage en un seul message, avec les missions', async () => {
    const b = banc();
    await proposerEt(b, ['a', 'b', 'c']);
    for (const id of ['a', 'b', 'c']) await deciderIsaac(b.kv, id, true, NOW);
    b.envois.length = 0;
    await b.agir('faits', {
      resultats: [{ id: 'a', libere: 9 * GO }, { id: 'b', libere: GO }, { id: 'c', refus: true, raison: 'utilisé récemment' }],
      libre: 35 * GO, missions: [{ id: 'm1', texte: 'vide le cache', etat: 'attente' }],
    }, NOW + MIN);
    expect(b.envois.map(e => e.texte)).toEqual([[
      '🧹 Fait : 9,0 Go libérés (caches de a).',
      '🧹 Fait : 1,0 Go libérés (caches de b).',
      'Isaac n\'a rien supprimé pour caches de c : utilisé récemment.',
      'Il reste 35,0 Go libres.',
      'Tes propositions attendent déjà ta réponse sur Telegram.',
    ].join('\n')]);
    const t = await toutes(b.kv);
    expect([t.a.statut, t.b.statut, t.c.statut]).toEqual(['faite', 'faite', 'refusee-mac']);
    expect(t.a.faite).toBe(NOW + MIN);
  });
  it('faits rejoué : rien de neuf, aucun message', async () => {
    const b = banc();
    await proposerEt(b, ['a']);
    await deciderIsaac(b.kv, 'a', true, NOW);
    const corps = { resultats: [{ id: 'a', libere: GO }], libre: 30 * GO };
    await b.agir('faits', corps);
    b.envois.length = 0;
    expect(await b.agir('faits', corps)).toMatchObject({ ignores: ['a'] });
    expect(b.envois).toEqual([]);
  });
  it('faits n\'accepte un résultat que pour une proposition au statut « oui »', async () => {
    const b = banc();
    await proposerEt(b, ['a']);
    b.envois.length = 0;
    expect(await b.agir('faits', { resultats: [{ id: 'a', libere: GO }], libre: GO })).toMatchObject({ ignores: ['a'] });
    expect((await toutes(b.kv)).a.statut).toBe('proposee');
    expect(b.envois).toEqual([]);
  });
  it('missions : « attente » et « ecartee », jamais « rien trouvé »', async () => {
    const b = banc();
    await b.agir('faits', { resultats: [], libre: 30 * GO, missions: [{ id: 'm1', texte: 'x', etat: 'ecartee' }] });
    expect(b.envois.map(e => e.texte)).toEqual(['Rien de nouveau : ce que j\'ai trouvé, tu l\'as refusé il y a peu.']);
    expect((await journal(b.kv)).map(e => e.texte)).toEqual(['mission : rien de nouveau']);
  });
  it('fait (ancienne action) range aussi la date « faite »', async () => {
    const b = banc();
    await proposerEt(b, ['a']);
    await deciderIsaac(b.kv, 'a', true, NOW);
    await b.agir('fait', { id: 'a', libere: GO, libre: GO }, NOW + 3 * MIN);
    expect((await toutes(b.kv)).a.faite).toBe(NOW + 3 * MIN);
  });
});

describe('Isaac : une mission alors que des propositions attendent', () => {
  const proposerEt = async (b: ReturnType<typeof banc>, ids: string[], now = NOW) => b.agir('proposer', { propositions: ids.map(id => prop(id)) }, now);
  it('dit lesquelles attendent et où répondre, au lieu d’une phrase vague', async () => {
    const b = banc();
    await proposerEt(b, ['a', 'b']);
    b.envois.length = 0;
    await b.agir('faits', { resultats: [], missions: [{ id: 'm2', texte: 'vide le cache', etat: 'attente' }] }, NOW + MIN);
    expect(b.envois.map(e => e.texte)).toEqual([
      'Je t\'ai déjà proposé de libérer « caches de a » et « caches de b ». Ces propositions sont plus haut dans la conversation : réponds Oui ou Non sous chacune, et je m\'en occupe.',
    ]);
  });
  it('un second clic dit ce qui a été décidé', async () => {
    const b = banc();
    await proposerEt(b, ['a']);
    await deciderIsaac(b.kv, 'a', false, NOW);
    expect(await deciderIsaac(b.kv, 'a', true, NOW + 1000)).toBe('Tu as déjà dit Non pour « caches de a » : je n\'y touche pas.');
  });
});

describe('Isaac : un Oui le lance tout de suite', () => {
  it('Oui → une marque dans la file du Mac ; Non → rien', async () => {
    const b = banc();
    await b.agir('proposer', { propositions: [prop('a'), prop('b')] });
    await deciderIsaac(b.kv, 'b', false, NOW);
    expect(await b.kv.lrange('kuroro:demandes', 0, -1)).toEqual([]);
    await deciderIsaac(b.kv, 'a', true, NOW);
    expect(await b.kv.lrange('kuroro:demandes', 0, -1)).toEqual(['mission-isaac']);
  });
});
