import { describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '../memoire';
import { traiterActionClara } from './api';
import { ajouterVip, corbeilleExpediteur } from './actions';
import { CLES_CLARA, idExpediteur, type StatExpediteur } from './stats';
import { ErreurGmail, type BoiteOuverte } from './imap';
import { Refus } from '../qg';

const kv = { hset: vi.fn(async () => 1), hgetall: vi.fn(async () => ({})), setnx: vi.fn(async () => true), get: vi.fn(), set: vi.fn(), del: vi.fn() } as never;
const faux = (fermer = vi.fn(async () => undefined)): BoiteOuverte => ({
  dossiers: async () => ({ corbeille: 'T', envoyes: 'S', tous: 'A' }), total: async () => 7, fermer,
  lireEntetes: async () => [], chercherGmail: async () => [],
  chercherDe: async () => [], expediteurs: async () => new Map(), corbeille: async () => 0,
});

describe('traiterActionClara', () => {
  it('essai : renvoie le résultat et ferme toujours la connexion', async () => {
    const fermer = vi.fn(async () => undefined);
    expect(await traiterActionClara(kv, 'essai', {}, { ouvrir: async () => faux(fermer) })).toEqual({ ok: true, corbeille: 'T', envoyes: 'S', total: 7 });
    expect(fermer).toHaveBeenCalledTimes(1);
  });
  it('essai : ferme même si la lecture échoue', async () => {
    const fermer = vi.fn(async () => undefined);
    const b = { ...faux(fermer), total: async () => { throw new Error('boum'); } };
    await expect(traiterActionClara(kv, 'essai', {}, { ouvrir: async () => b })).rejects.toThrow('boum');
    expect(fermer).toHaveBeenCalled();
  });
  it('essai : l\'erreur de connexion remonte telle quelle', async () => {
    await expect(traiterActionClara(kv, 'essai', {}, { ouvrir: async () => { throw new ErreurGmail('Gmail refuse la connexion'); } })).rejects.toThrow('Gmail refuse la connexion');
  });
  it('action inconnue : 404', async () => {
    const e = (await traiterActionClara(kv, 'x', {}, { ouvrir: async () => faux() }).catch((x: unknown) => x)) as Refus;
    expect(e).toBeInstanceOf(Refus);
    expect(e.code).toBe(404);
  });
});

const NOW = Date.UTC(2026, 10, 9, 8);
const stat = (adresse: string, total = 10, extra: Partial<StatExpediteur> = {}): StatExpediteur =>
  ({ id: idExpediteur(adresse), adresse, total, nonLus: 9, dernier: 1, exempleObjet: 'Promo', ...extra });
async function monde(adresses: string[]) {
  const k = memoire();
  for (const a of adresses) await k.hset(CLES_CLARA.stats, idExpediteur(a), JSON.stringify(stat(a)));
  const envoyer = vi.fn(async () => undefined);
  const attendre = vi.fn(async () => undefined);
  const deps = { ouvrir: async () => faux(), envoyer, now: () => NOW, attendre };
  return { k, envoyer, deps, attendre };
}
const code = async (p: Promise<unknown>) => ((await p.catch((x: unknown) => x)) as Refus).code;

describe('proposer', () => {
  it('pose les questions et compte au jour', async () => {
    const { k, envoyer, deps } = await monde(['a@x.com', 'b@y.com']);
    const r = await traiterActionClara(k, 'proposer', { ids: [idExpediteur('a@x.com'), idExpediteur('b@y.com')] }, deps) as { proposes: number };
    expect(r.proposes).toBe(2);
    expect(envoyer).toHaveBeenCalledTimes(2);
    expect(Object.keys(await k.hgetall('clara:propose:2026-11-09'))).toHaveLength(2);
  });
  it('au-delà de 5 par jour : 429 et rien posé', async () => {
    const adr = Array.from({ length: 7 }, (_, i) => `s${i}@x.com`);
    const { k, envoyer, deps } = await monde(adr);
    const ids = adr.map(idExpediteur);
    await traiterActionClara(k, 'proposer', { ids: ids.slice(0, 4) }, deps);
    expect(await code(traiterActionClara(k, 'proposer', { ids: ids.slice(4, 6) }, deps))).toBe(429);
    expect(envoyer).toHaveBeenCalledTimes(4);
    expect(await code(traiterActionClara(k, 'proposer', { ids: ids.slice(0, 6) }, deps))).toBe(400); // plus de 5 par appel
  });
  it('la 6e du jour : 429, 5 passent', async () => {
    const adr = Array.from({ length: 6 }, (_, i) => `s${i}@x.com`);
    const { k, envoyer, deps } = await monde(adr);
    const ids = adr.map(idExpediteur);
    await traiterActionClara(k, 'proposer', { ids: ids.slice(0, 5) }, deps);
    expect(await code(traiterActionClara(k, 'proposer', { ids: [ids[5]] }, deps))).toBe(429);
    expect(envoyer).toHaveBeenCalledTimes(5);
  });
  it('déjà proposé aujourd\'hui ou question ouverte : 422', async () => {
    const { k, deps } = await monde(['a@x.com', 'b@x.com']);
    await traiterActionClara(k, 'proposer', { ids: [idExpediteur('a@x.com')] }, deps);
    expect(await code(traiterActionClara(k, 'proposer', { ids: [idExpediteur('a@x.com')] }, deps))).toBe(422);
    await k.hset(CLES_CLARA.questions, idExpediteur('b@x.com'), '{}');
    expect(await code(traiterActionClara(k, 'proposer', { ids: [idExpediteur('b@x.com')] }, deps))).toBe(422);
  });
  it('grand ménage : 200 au total au plus, 3 appels par jour', async () => {
    const adr = Array.from({ length: 12 }, (_, i) => `s${i}@x.com`);
    const { k, deps } = await monde(adr);
    const ids = adr.map(idExpediteur);
    for (let i = 0; i < 3; i++) await traiterActionClara(k, 'proposer', { grandMenage: true, ids: [ids[i]] }, deps);
    expect(await code(traiterActionClara(k, 'proposer', { grandMenage: true, ids: [ids[3]] }, deps))).toBe(429);
    await k.hset('clara:grand-menage', 'total', '199');
    await k.hset('clara:grand-menage', 'appels:2026-11-09', '0');
    expect(await code(traiterActionClara(k, 'proposer', { grandMenage: true, ids: [ids[4], ids[5]] }, deps))).toBe(429);
    await traiterActionClara(k, 'proposer', { grandMenage: true, ids: [ids[4]] }, deps);
  });
  it('échec d\'envoi : l\'état passe à erreur', async () => {
    const { k, deps } = await monde(['a@x.com']);
    const d = { ...deps, envoyer: async () => { throw new Error('tg'); } };
    await expect(traiterActionClara(k, 'proposer', { ids: [idExpediteur('a@x.com')] }, d)).rejects.toThrow('tg');
  });
  it('id VIP, gardé, banni ou inconnu : 422 qui nomme l\'id, rien posé', async () => {
    const { k, envoyer, deps } = await monde(['a@x.com', 'vip@y.com', 'g@z.com', 'b@z.com']);
    await ajouterVip(k, 'vip@y.com');
    await k.hset(CLES_CLARA.gardes, idExpediteur('g@z.com'), '{}');
    await k.hset(CLES_CLARA.bannis, idExpediteur('b@z.com'), '{}');
    for (const a of ['vip@y.com', 'g@z.com', 'b@z.com']) {
      const e = (await traiterActionClara(k, 'proposer', { ids: [idExpediteur('a@x.com'), idExpediteur(a)] }, deps).catch((x: unknown) => x)) as Refus;
      expect(e.code).toBe(422);
      expect(e.message).toContain(idExpediteur(a));
    }
    expect(await code(traiterActionClara(k, 'proposer', { ids: ['zzzzzzzz'] }, deps))).toBe(422);
    expect(envoyer).not.toHaveBeenCalled();
  });
  it('grand ménage : jusqu\'à 20, non compté, fermé par grandMenageFini', async () => {
    const adr = Array.from({ length: 22 }, (_, i) => `s${i}@x.com`);
    const { k, envoyer, deps } = await monde(adr);
    const ids = adr.map(idExpediteur);
    await traiterActionClara(k, 'proposer', { grandMenage: true, ids: ids.slice(0, 20) }, deps);
    expect(envoyer).toHaveBeenCalledTimes(20);
    expect(await k.hgetall('clara:propose:2026-11-09')).toEqual({});
    expect(await code(traiterActionClara(k, 'proposer', { grandMenage: true, ids }, deps))).toBe(400);
    expect(await traiterActionClara(k, 'proposer', { grandMenageFini: true }, deps)).toEqual({ grandMenageFini: true });
    expect(await code(traiterActionClara(k, 'proposer', { grandMenage: true, ids: [ids[20]] }, deps))).toBe(409);
    // et le quotidien reste limité à 5
    await traiterActionClara(k, 'proposer', { ids: [ids[20]] }, deps);
  });
});

describe('stats', () => {
  const brut = (n: number, d: string) => ({ ...faux(), lireEntetes: async () => Array.from({ length: n }, (_, i) => ({
    uid: i + 1, de: { adresse: `${d}${i % 3}@x.com`, nom: 'N' }, a: [], cc: [], objet: 'Promo', date: 1000 + i, vu: false,
    listUnsubscribe: '<https://secret.example/u?t=SECRETJETON>', listUnsubscribePost: 'List-Unsubscribe=One-Click',
  })) });
  it('renvoie les expéditeurs à juger, sans l\'URL de désabonnement, et ferme la boîte', async () => {
    const k = memoire();
    const fermer = vi.fn(async () => undefined);
    const deps = { ouvrir: async () => ({ ...brut(30, 'p'), fermer }) as BoiteOuverte, envoyer: vi.fn(), now: () => NOW };
    const r = await traiterActionClara(k, 'stats', {}, deps) as { fini: boolean; lus: number; expediteurs: Record<string, unknown>[] };
    expect(r.lus).toBe(30);
    expect(r.expediteurs).toHaveLength(3);
    expect(r.expediteurs[0]).toMatchObject({ unClic: true, exempleObjet: 'Promo' });
    expect(r.expediteurs[0]).not.toHaveProperty('desabo');
    expect(JSON.stringify(r)).not.toContain('SECRETJETON');
    expect(fermer).toHaveBeenCalledTimes(1);
  });
  it('exclut VIP, gardés, bannis et questions ouvertes ; au plus 50', async () => {
    const adr = Array.from({ length: 60 }, (_, i) => `s${i}@x.com`);
    const { k, deps } = await monde(adr);
    await ajouterVip(k, 's0@x.com');
    await k.hset(CLES_CLARA.gardes, idExpediteur('s1@x.com'), '{}');
    await k.hset(CLES_CLARA.bannis, idExpediteur('s2@x.com'), '{}');
    await k.hset(CLES_CLARA.questions, idExpediteur('s3@x.com'), '{}');
    const r = await traiterActionClara(k, 'stats', {}, deps) as { expediteurs: { adresse: string }[] };
    expect(r.expediteurs).toHaveLength(50);
    const a = r.expediteurs.map(x => x.adresse);
    for (const x of ['s0', 's1', 's2', 's3']) expect(a).not.toContain(`${x}@x.com`);
  });
  it('ma propre adresse (GMAIL_ADRESSE) n\'est jamais à juger ni proposable', async () => {
    const avant = process.env.GMAIL_ADRESSE;
    process.env.GMAIL_ADRESSE = 'S4@X.com';
    try {
      const { k, deps } = await monde(Array.from({ length: 10 }, (_, i) => `s${i}@x.com`));
      const r = await traiterActionClara(k, 'stats', {}, deps) as { expediteurs: { adresse: string }[] };
      expect(r.expediteurs.map(x => x.adresse)).not.toContain('s4@x.com');
      await expect(traiterActionClara(k, 'proposer', { ids: [idExpediteur('s4@x.com')] }, deps)).rejects.toMatchObject({ code: 422 });
    } finally {
      if (avant === undefined) delete process.env.GMAIL_ADRESSE; else process.env.GMAIL_ADRESSE = avant;
    }
  });
  it('lock occupé : { occupe: true } et la boîte est fermée', async () => {
    const { k, deps } = await monde([]);
    await k.setnx('clara:stats:verrou', '1', 300);
    const fermer = vi.fn(async () => undefined);
    expect(await traiterActionClara(k, 'stats', {}, { ...deps, ouvrir: async () => faux(fermer) })).toEqual({ occupe: true });
    expect(fermer).toHaveBeenCalled();
  });
});

describe('bannis et vip-candidats', () => {
  it('bannis : applique et ferme la boîte', async () => {
    const { k, deps } = await monde([]);
    const fermer = vi.fn(async () => undefined);
    expect(await traiterActionClara(k, 'bannis', {}, { ...deps, ouvrir: async () => faux(fermer) })).toEqual({ deplaces: 0 });
    expect(fermer).toHaveBeenCalledTimes(1);
  });
  it('vip-candidats : liste en lecture seule', async () => {
    const { k, deps } = await monde([]);
    const fermer = vi.fn(async () => undefined);
    const b = { ...faux(fermer), lireEntetes: async () => [{ uid: 1, de: { adresse: 'moi@x.com' }, a: ['ami@y.com'], cc: [], objet: '', date: 1, vu: true }] };
    expect(await traiterActionClara(k, 'vip-candidats', {}, { ...deps, ouvrir: async () => b as BoiteOuverte })).toEqual({ candidats: ['ami@y.com'] });
    expect(fermer).toHaveBeenCalled();
    expect(JSON.parse((await k.hgetall('clara:vip-candidats')).liste)).toEqual(['ami@y.com']);
  });
});

// ——— Relecture finale ———

describe('relecture finale : stats et proposer', () => {
  const mails = (n: number, de = 'p') => Array.from({ length: n }, (_, i) => ({
    uid: i + 1, de: { adresse: `${de}${i % 3}@x.com` }, a: [], cc: [], date: 1000 + i, vu: i % 2 === 0,
  }));

  it('F1 : un expéditeur déjà nettoyé n\'est plus proposé avec ses anciens chiffres', async () => {
    const { k, deps } = await monde(['a@x.com', 'b@x.com']);
    await corbeilleExpediteur(k, faux(), 'a@x.com');
    const r = await traiterActionClara(k, 'stats', {}, deps) as { expediteurs: { adresse: string }[] };
    expect(r.expediteurs.map(x => x.adresse)).toEqual(['b@x.com']);
  });

  it('F1 : passage complet de plus de 24 h → recalcul depuis le début', async () => {
    const k = memoire();
    const depuis: number[] = [];
    const boite = { ...faux(), lireEntetes: async (_d: string, u: number) => { depuis.push(u); return mails(3).filter(m => m.uid > u); } };
    const appel = (t: number) => traiterActionClara(k, 'stats', {}, { ouvrir: async () => boite as BoiteOuverte, envoyer: vi.fn(), now: () => t });
    await appel(NOW);
    await appel(NOW + 3600_000);
    await appel(NOW + 25 * 3600_000);
    expect(depuis).toEqual([0, 3, 0]);
    const r = await appel(NOW + 26 * 3600_000) as { expediteurs: { total: number }[] };
    expect(r.expediteurs.reduce((n, x) => n + x.total, 0)).toBe(3);
  });

  it('F4 : envois espacés d\'environ 1,1 s', async () => {
    const adr = ['a@x.com', 'b@x.com', 'c@x.com'];
    const { k, deps, attendre } = await monde(adr);
    await traiterActionClara(k, 'proposer', { ids: adr.map(idExpediteur) }, deps);
    expect(attendre).toHaveBeenCalledTimes(2);
    for (const c of attendre.mock.calls as unknown as [number][]) expect(c[0]).toBeGreaterThanOrEqual(1100);
  });

  it('F4 : Telegram répond 429 → arrêt propre, quota rendu pour les non-envoyés, nombre envoyé', async () => {
    const adr = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'];
    const { k, deps } = await monde(adr);
    let n = 0;
    const envoyer = vi.fn(async () => { if (++n === 3) throw new Refus('Telegram a refusé (429)', 429); });
    const ids = adr.map(idExpediteur);
    const r = await traiterActionClara(k, 'proposer', { ids }, { ...deps, envoyer }) as { proposes: number; limite?: boolean };
    expect(r).toMatchObject({ proposes: 2, limite: true });
    expect(Object.keys(await k.hgetall('clara:propose:2026-11-09')).sort()).toEqual(ids.slice(0, 2).sort());
    expect(Object.keys(await k.hgetall(CLES_CLARA.questions)).sort()).toEqual(ids.slice(0, 2).sort());
    // grand ménage : le total est rendu aussi
    const r2 = await traiterActionClara(k, 'proposer', { grandMenage: true, ids: ids.slice(2) }, { ...deps, envoyer: vi.fn(async () => { throw new Refus('Telegram a refusé (429)', 429); }) });
    expect(r2).toMatchObject({ proposes: 0, limite: true });
    expect((await k.hgetall('clara:grand-menage')).total).toBe('0');
  });

  it('F5 : un passage de stats ne relit pas toute la table clara:stats', async () => {
    const base = memoire();
    const lus: string[] = [];
    const k: KV = { ...base, hgetall: async c => { lus.push(c); return base.hgetall(c); } };
    const boite = { ...faux(), lireEntetes: async (_d: string, u: number) => mails(30).filter(m => m.uid > u) };
    const deps = { ouvrir: async () => boite as BoiteOuverte, envoyer: vi.fn(), now: () => NOW };
    await traiterActionClara(k, 'stats', {}, deps);
    lus.length = 0;
    const r = await traiterActionClara(k, 'stats', {}, deps) as { expediteurs: unknown[] };
    expect(r.expediteurs).toHaveLength(3);
    expect(lus).not.toContain(CLES_CLARA.stats);
  });
});
