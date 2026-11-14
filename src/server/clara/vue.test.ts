import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '../memoire';
import { Refus } from '../qg';
import { ajouterVip } from './actions';
import { CLES_CLARA } from './stats';
import { CLE_CANDIDATS, debannir, majVip, vueClara } from './vue';

afterEach(() => vi.unstubAllEnvs());

describe('vueClara', () => {
  it('vide : rien à montrer, pas connecté sans identifiants', async () => {
    vi.stubEnv('GMAIL_ADRESSE', ''); vi.stubEnv('GMAIL_MOT_DE_PASSE_APPLI', '');
    expect(await vueClara(memoire())).toEqual({
      connecte: false, vip: [], candidatsVip: [], bannis: [], gardes: [], questions: [],
      nettoye: { mails: 0, derniers: [] }, statsAvancement: { lus: 0 },
    });
  });
  it('ne contient ni mot de passe ni adresse de connexion', async () => {
    vi.stubEnv('GMAIL_ADRESSE', 'secret.moi@gmail.com'); vi.stubEnv('GMAIL_MOT_DE_PASSE_APPLI', 'abcd efgh ijkl mnop');
    const kv = memoire();
    const v = await vueClara(kv);
    expect(v.connecte).toBe(true);
    const json = JSON.stringify(v);
    expect(json).not.toContain('secret.moi');
    expect(json).not.toContain('abcd');
  });
  it('assemble VIP, candidats cochés, bannis, gardés, questions, ménage et avancement', async () => {
    const kv = memoire();
    await ajouterVip(kv, 'ami@y.com');
    await kv.hset(CLE_CANDIDATS, 'liste', JSON.stringify(['ami@y.com', 'autre@z.com']));
    await kv.hset(CLES_CLARA.bannis, 'b1', JSON.stringify({ adresse: 'spam@x.com', depuis: 5, deplaces: 42, dernierUid: 9 }));
    await kv.hset(CLES_CLARA.gardes, 'g1', JSON.stringify({ adresse: 'garde@x.com', depuis: 6 }));
    await kv.hset(CLES_CLARA.questions, 'q1', JSON.stringify({ id: 'q1', adresse: 'q@x.com', etape: 2, quand: 7 }));
    for (let i = 0; i < 12; i++) await kv.lpush(CLES_CLARA.journal, JSON.stringify({ quand: i, adresse: 'spam@x.com', n: 10 }));
    await kv.hset(CLES_CLARA.compteurs, 'lus', '30');
    await kv.hset(CLES_CLARA.curseur, 'total', '100');
    const v = await vueClara(kv);
    expect(v.vip).toEqual(['ami@y.com']);
    expect(v.candidatsVip).toEqual([{ adresse: 'ami@y.com', coche: true }, { adresse: 'autre@z.com', coche: false }]);
    expect(v.bannis).toEqual([{ id: 'b1', adresse: 'spam@x.com', depuis: 5, deplaces: 42 }]);
    expect(v.gardes).toEqual(['garde@x.com']);
    expect(v.questions).toEqual([{ id: 'q1', adresse: 'q@x.com', etape: 2 }]);
    expect(v.nettoye.mails).toBe(120);
    expect(v.nettoye.derniers).toHaveLength(10);
    expect(v.statsAvancement).toEqual({ lus: 30, total: 100 });
  });
});

describe('majVip et débannir', () => {
  it('cocher un candidat l\'ajoute aux VIP, décocher le retire', async () => {
    const kv = memoire();
    await majVip(kv, 'Ami@Y.com', true);
    expect((await vueClara(kv)).vip).toEqual(['ami@y.com']);
    await majVip(kv, 'ami@y.com', false);
    expect((await vueClara(kv)).vip).toEqual([]);
  });
  it('adresse invalide : refusée', async () => {
    await expect(majVip(memoire(), 'pas une adresse', true)).rejects.toBeInstanceOf(Refus);
  });
  it('débannir retire de clara:bannis', async () => {
    const kv = memoire();
    await kv.hset(CLES_CLARA.bannis, 'b1', JSON.stringify({ adresse: 'spam@x.com', depuis: 5, deplaces: 1, dernierUid: 9 }));
    await debannir(kv, 'b1');
    expect(await kv.hgetall(CLES_CLARA.bannis)).toEqual({});
  });
  it('débannir pendant une mise à la corbeille : 409 et le banni reste', async () => {
    const kv = memoire();
    await kv.hset(CLES_CLARA.bannis, 'b1', JSON.stringify({ adresse: 'spam@x.com', depuis: 5, deplaces: 1, dernierUid: 9 }));
    await kv.setnx('clara:verrou:b1', '1', 300);
    const e = (await debannir(kv, 'b1').catch((x: unknown) => x)) as Refus;
    expect(e.code).toBe(409);
    expect(Object.keys(await kv.hgetall(CLES_CLARA.bannis))).toEqual(['b1']);
  });
  it('débannir libère le verrou', async () => {
    const kv = memoire();
    await debannir(kv, 'b1');
    expect(await kv.setnx('clara:verrou:b1', '1', 5)).toBe(true);
  });
});

describe('relecture finale', () => {
  it('F2 : lien de désabonnement https des bannis (jamais mailto ni http)', async () => {
    const kv = memoire();
    await kv.hset(CLES_CLARA.bannis, 'b1', JSON.stringify({ adresse: 'a@x.com', depuis: 3, deplaces: 1, dernierUid: 1, desabo: { url: 'https://x.com/u?t=1', unClic: false } }));
    await kv.hset(CLES_CLARA.bannis, 'b2', JSON.stringify({ adresse: 'b@x.com', depuis: 2, deplaces: 1, dernierUid: 1, desabo: { url: 'mailto:u@x.com', unClic: false } }));
    await kv.hset(CLES_CLARA.bannis, 'b3', JSON.stringify({ adresse: 'c@x.com', depuis: 1, deplaces: 1, dernierUid: 1, desabo: { url: 'http://x.com/u', unClic: false } }));
    const v = await vueClara(kv);
    expect(v.bannis.map(b => b.desabo)).toEqual(['https://x.com/u?t=1', undefined, undefined]);
  });
  it('F5 : ne lit pas la table clara:stats ; compteurs tenus à part', async () => {
    const base = memoire();
    const lus: string[] = [];
    const kv: KV = { ...base, hgetall: async c => { lus.push(c); return base.hgetall(c); } };
    await kv.hset(CLES_CLARA.stats, 's1', JSON.stringify({ id: 's1', adresse: 'a@a.com', total: 30, nonLus: 0, dernier: 1 }));
    await kv.hset(CLES_CLARA.compteurs, 'lus', '4200');
    await kv.hset(CLES_CLARA.compteurs, 'mailsNettoyes', '9000');
    await kv.lpush(CLES_CLARA.journal, JSON.stringify({ quand: 1, adresse: 'a@a.com', n: 10 }));
    const v = await vueClara(kv);
    expect(lus).not.toContain(CLES_CLARA.stats);
    expect(v.statsAvancement.lus).toBe(4200);
    expect(v.nettoye.mails).toBe(9000);
  });
});
