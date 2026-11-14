import { describe, expect, it } from 'vitest';
import { memoire } from '../memoire';
import type { Boite, Entete } from './imap';
import { avancerStats, candidatsVip, CLES_CLARA, idExpediteur, lireStats, meilleursExpediteurs, normaliser, recommencerStats } from './stats';

const TOUS = '[Gmail]/Tous les messages', ENVOYES = '[Gmail]/Messages envoyés';
const CATS = ['promotions', 'social', 'updates', 'forums'] as const;

/** Une fausse boîte : `tous` et `envoyes` sont des listes d'en-têtes triées par UID ; `cats` = UID → catégorie Gmail. */
function fausseBoite(tous: Entete[], envoyes: Entete[] = [], cats = new Map<number, string>()) {
  const appels = { lire: 0, chercher: [] as string[] };
  const boite: Boite = {
    dossiers: async () => ({ corbeille: '[Gmail]/Corbeille', envoyes: ENVOYES, tous: TOUS }),
    total: async d => (d === TOUS ? tous.length : envoyes.length),
    async lireEntetes(dossier, uidDepuis, max, options) {
      appels.lire++;
      const l = (dossier === TOUS ? tous : envoyes).filter(m => m.uid > uidDepuis);
      return options?.derniers ? l.slice(-max) : l.slice(0, max);
    },
    async chercherGmail(dossier, requete, plage) {
      appels.chercher.push(requete);
      const cat = requete.replace('category:', '');
      return (dossier === TOUS ? tous : envoyes)
        .filter(m => (!plage || (m.uid >= plage.de && m.uid <= plage.a)) && cats.get(m.uid) === cat).map(m => m.uid);
    },
  };
  return { boite, appels };
}

const mail = (uid: number, de: string, over: Partial<Entete> = {}): Entete => {
  const m = /^(.*)<(.+)>$/.exec(de);
  return { uid, de: m ? { adresse: m[2], nom: m[1].trim() } : { adresse: de }, a: [], cc: [], date: 1_700_000_000_000 + uid * 1000, vu: true, ...over };
};

/** 5 000 mails : 50 expéditeurs (uid % 50), un sur trois non lu ; quelques trous d'UID (mails supprimés). */
function cinqMille() {
  const tous: Entete[] = [];
  const cats = new Map<number, string>();
  let uid = 0;
  for (let i = 0; i < 5000; i++) {
    uid += i % 97 === 0 ? 3 : 1;
    const s = i % 50;
    tous.push(mail(uid, `Expéditeur ${s} <Contact${s}@Domaine${s % 10}.com>`, { vu: i % 3 !== 0, objet: `Objet ${i}` }));
    if (s < 4) cats.set(uid, CATS[s]);
  }
  return { tous, cats };
}

describe('normaliser', () => {
  it('minuscules, sans nom affiché, domaine', () => {
    expect(normaliser('Marque X <News@X.com>')).toEqual({ adresse: 'news@x.com', domaine: 'x.com' });
    expect(normaliser('  NEWS@x.COM ')).toEqual({ adresse: 'news@x.com', domaine: 'x.com' });
    expect(normaliser('"Dupont, Jean" <jean@Banque.ci>')).toEqual({ adresse: 'jean@banque.ci', domaine: 'banque.ci' });
  });
});

describe('idExpediteur', () => {
  it('8 caractères base36, stable, identique pour une même adresse normalisée', () => {
    const id = idExpediteur('news@x.com');
    expect(id).toMatch(/^[0-9a-z]{8}$/);
    expect(idExpediteur(normaliser('Marque X <News@X.com>').adresse)).toBe(id);
    expect(idExpediteur('autre@x.com')).not.toBe(id);
  });
});

describe('avancerStats', () => {
  it('3 appels reprennent au curseur et ne comptent aucun mail deux fois', async () => {
    const kv = memoire();
    const { tous, cats } = cinqMille();
    const { boite } = fausseBoite(tous, [], cats);
    const r1 = await avancerStats(kv, boite, 0);
    const r2 = await avancerStats(kv, boite, 0);
    const r3 = await avancerStats(kv, boite, 0);
    expect([r1, r2, r3]).toEqual([{ fini: false, lus: 2000 }, { fini: false, lus: 2000 }, { fini: true, lus: 1000 }]);
    const stats = await lireStats(kv);
    expect(stats).toHaveLength(50);
    expect(stats.reduce((s, x) => s + x.total, 0)).toBe(5000);
    expect(stats.every(x => x.total === 100)).toBe(true);
    // un appel de plus, sans nouveau mail : rien n'est recompté
    expect(await avancerStats(kv, boite, 0)).toEqual({ fini: true, lus: 0 });
    expect((await lireStats(kv)).reduce((s, x) => s + x.total, 0)).toBe(5000);
  });

  it('nonLus = mails sans \\Seen ; dernier = date la plus récente ; objet le plus récent, coupé à 120', async () => {
    const kv = memoire();
    const long = 'x'.repeat(200);
    const { boite } = fausseBoite([
      mail(1, 'a@a.com', { vu: false, objet: 'premier' }),
      mail(2, 'a@a.com', { vu: true, objet: long }),
      mail(3, 'a@a.com', { vu: false, objet: 'vieux', date: 1 }),
    ]);
    await avancerStats(kv, boite, 0);
    const [s] = await lireStats(kv);
    expect(s).toMatchObject({ adresse: 'a@a.com', total: 3, nonLus: 2, dernier: 1_700_000_002_000 });
    expect(s.exempleObjet).toBe('x'.repeat(120));
  });

  it('« Marque X <News@X.com> » et « news@x.com » sont regroupés', async () => {
    const kv = memoire();
    const { boite } = fausseBoite([mail(1, 'Marque X <News@X.com>'), mail(2, 'news@x.com'), mail(3, 'NEWS@x.com')]);
    await avancerStats(kv, boite, 0);
    const stats = await lireStats(kv);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ id: idExpediteur('news@x.com'), adresse: 'news@x.com', nom: 'Marque X', total: 3 });
  });

  it('regroupe aussi entre deux appels (cumul dans clara:stats)', async () => {
    const kv = memoire();
    const tous = Array.from({ length: 2500 }, (_, i) => mail(i + 1, i % 2 ? 'Marque X <News@X.com>' : 'news@x.com', { vu: i >= 10 }));
    const { boite } = fausseBoite(tous);
    await avancerStats(kv, boite, 0);
    await avancerStats(kv, boite, 0);
    const brut = await kv.hgetall(CLES_CLARA.stats);
    expect(Object.keys(brut)).toEqual([idExpediteur('news@x.com')]);
    expect((await lireStats(kv))[0]).toMatchObject({ total: 2500, nonLus: 10 });
  });

  it('desabo.unClic vrai seulement avec List-Unsubscribe-Post et un lien https', async () => {
    const kv = memoire();
    const { boite } = fausseBoite([
      mail(1, 'a@a.com', { listUnsubscribe: '<mailto:u@a.com>, <https://a.com/u?x=1>', listUnsubscribePost: 'List-Unsubscribe=One-Click' }),
      mail(2, 'b@b.com', { listUnsubscribe: '<https://b.com/u>' }),
      mail(3, 'c@c.com', { listUnsubscribe: '<mailto:u@c.com>', listUnsubscribePost: 'List-Unsubscribe=One-Click' }),
      mail(4, 'd@d.com'),
    ]);
    await avancerStats(kv, boite, 0);
    const par = Object.fromEntries((await lireStats(kv)).map(s => [s.adresse, s]));
    expect(par['a@a.com'].desabo).toEqual({ url: 'https://a.com/u?x=1', unClic: true });
    expect(par['b@b.com'].desabo).toEqual({ url: 'https://b.com/u', unClic: false });
    expect(par['c@c.com'].desabo).toEqual({ url: 'mailto:u@c.com', unClic: false });
    expect(par['d@d.com'].desabo).toBeUndefined();
  });

  it('catégorie Gmail : une recherche X-GM-RAW par catégorie et par morceau, catégorie majoritaire seulement', async () => {
    const kv = memoire();
    const { tous, cats } = cinqMille();
    const { boite, appels } = fausseBoite(tous, [], cats);
    await avancerStats(kv, boite, 0);
    expect(appels.chercher).toEqual(['category:promotions', 'category:social', 'category:updates', 'category:forums']);
    await avancerStats(kv, boite, 0);
    await avancerStats(kv, boite, 0);
    expect(appels.chercher).toHaveLength(12);
    const par = Object.fromEntries((await lireStats(kv)).map(s => [s.adresse, s.categorie]));
    expect([par['contact0@domaine0.com'], par['contact1@domaine1.com'], par['contact2@domaine2.com'], par['contact3@domaine3.com']])
      .toEqual(['promotions', 'social', 'updates', 'forums']);
    expect(par['contact4@domaine4.com']).toBeUndefined();

    // 1 mail sur 3 en Promotions : pas majoritaire, donc pas de catégorie (en cas de doute, rien)
    const kv2 = memoire();
    const { boite: b2 } = fausseBoite([mail(1, 'p@p.com'), mail(2, 'p@p.com'), mail(3, 'p@p.com')], [], new Map([[1, 'promotions']]));
    await avancerStats(kv2, b2, 0);
    expect((await lireStats(kv2))[0].categorie).toBeUndefined();
  });

  it('écriture du curseur ratée → morceau rejoué : rien n\'est compté deux fois', async () => {
    const kv = memoire();
    const { tous, cats } = cinqMille();
    const { boite } = fausseBoite(tous, [], cats);
    const hset = kv.hset.bind(kv);
    let panne = true;
    const kvPanne = { ...kv, hset: async (k: string, f: string, v: string) => {
      if (panne && k === CLES_CLARA.curseur) throw new Error('Upstash');
      return hset(k, f, v);
    } };
    await expect(avancerStats(kvPanne, boite, 0)).rejects.toThrow('Upstash');
    expect((await lireStats(kv)).reduce((s, x) => s + x.total, 0)).toBe(2000);
    panne = false;
    for (let i = 0; i < 4; i++) await avancerStats(kvPanne, boite, 0);
    const stats = await lireStats(kv);
    expect(stats.reduce((s, x) => s + x.total, 0)).toBe(5000);
    expect(stats.every(x => x.total === 100)).toBe(true);
    expect(stats.find(x => x.adresse === 'contact0@domaine0.com')?.categorie).toBe('promotions');
    // le verrou a été relâché malgré la panne
    expect(await kv.get('clara:stats:verrou')).toBeNull();
  });

  it('deux appels qui se chevauchent : le second est refusé, le verrou est relâché ensuite', async () => {
    const kv = memoire();
    const { tous } = cinqMille();
    const { boite } = fausseBoite(tous);
    let lacher!: () => void;
    const attente = new Promise<void>(r => { lacher = r; });
    const lente: Boite = { ...boite, lireEntetes: async (...a) => { await attente; return boite.lireEntetes(...a); } };
    const p1 = avancerStats(kv, lente, 0);
    await new Promise(r => setTimeout(r, 0));
    await expect(avancerStats(kv, boite, 0)).rejects.toThrow('statistiques déjà en cours');
    lacher();
    expect(await p1).toEqual({ fini: false, lus: 2000 });
    expect(await avancerStats(kv, boite, 0)).toEqual({ fini: false, lus: 2000 });
    expect((await lireStats(kv)).reduce((s, x) => s + x.total, 0)).toBe(4000);
  });

  it('lien de désabonnement rangé coupé à 500 caractères ; champs internes absents des fiches', async () => {
    const kv = memoire();
    const long = `https://a.com/${'u'.repeat(900)}`;
    const { boite } = fausseBoite([mail(1, 'a@a.com', { listUnsubscribe: `<${long}>` })]);
    await avancerStats(kv, boite, 0);
    const [s] = await lireStats(kv);
    expect(s.desabo?.url).toBe(long.slice(0, 500));
    expect(s).not.toHaveProperty('uidMax');
    expect(s).not.toHaveProperty('parCategorie');
  });

  it('ne relit pas tout clara:stats : seulement les expéditeurs du morceau (HMGET)', async () => {
    const kv = memoire();
    const { tous } = cinqMille();
    const { boite } = fausseBoite(tous);
    let hgetall = 0;
    const espion = { ...kv, hgetall: async (k: string) => { if (k === CLES_CLARA.stats) hgetall++; return kv.hgetall(k); } };
    await avancerStats(espion, boite, 0);
    await avancerStats(espion, boite, 0);
    expect(hgetall).toBe(0);
  });

  it('recommencerStats efface le curseur et les statistiques', async () => {
    const kv = memoire();
    const { tous } = cinqMille();
    const { boite } = fausseBoite(tous);
    await avancerStats(kv, boite, 0);
    await recommencerStats(kv);
    expect(await lireStats(kv)).toEqual([]);
    expect(await avancerStats(kv, boite, 0)).toEqual({ fini: false, lus: 2000 });
    expect((await lireStats(kv)).reduce((s, x) => s + x.total, 0)).toBe(2000);
  });

  it('écrit le curseur au dernier UID lu', async () => {
    const kv = memoire();
    const { tous } = cinqMille();
    const { boite } = fausseBoite(tous);
    await avancerStats(kv, boite, 1234);
    expect(await kv.hgetall(CLES_CLARA.curseur)).toEqual({ uid: String(tous[1999].uid), fini: '0', maj: '1234', total: String(tous.length), debut: '1234' });
  });
});

describe('candidatsVip', () => {
  it('destinataires To/Cc des envoyés, normalisés, triés par fréquence, sans ma propre adresse, au plus max', async () => {
    const envoyes: Entete[] = [
      mail(1, 'moi@gmail.com', { a: ['Ami <Ami@Exemple.com>'], cc: ['moi@gmail.com'] }),
      mail(2, 'moi@gmail.com', { a: ['ami@exemple.com', 'Banque <conseiller@banque.ci>'] }),
      mail(3, 'moi@gmail.com', { a: ['AMI@exemple.com'], cc: ['conseiller@banque.ci', 'rare@x.com'] }),
      mail(4, 'moi@gmail.com', { a: ['Moi <MOI@gmail.com>'] }),
    ];
    const { boite } = fausseBoite([], envoyes);
    expect(await candidatsVip(boite, 40, 'Moi@Gmail.com')).toEqual(['ami@exemple.com', 'conseiller@banque.ci', 'rare@x.com']);
    expect(await candidatsVip(boite, 2, 'moi@gmail.com')).toEqual(['ami@exemple.com', 'conseiller@banque.ci']);
  });

  it('ne lit que les 2 000 envoyés les plus récents, en un seul appel', async () => {
    // 3 000 anciens à « ancien@x.com », puis 1 500 récents à « recent@x.com » : seuls les 2 000 derniers comptent
    const envoyes = Array.from({ length: 4500 }, (_, i) => mail(i + 1, 'moi@gmail.com', { a: [i < 3000 ? 'ancien@x.com' : 'recent@x.com'] }));
    const { boite, appels } = fausseBoite([], envoyes);
    expect(await candidatsVip(boite, 40, 'moi@gmail.com')).toEqual(['recent@x.com', 'ancien@x.com']);
    expect(appels.lire).toBe(1);
  });
});

describe('relecture finale : compteur et index', () => {
  it('F5 : compteur « lus » tenu à part (morceau rejoué non recompté), remis à zéro par recommencerStats', async () => {
    const kv = memoire();
    const { tous, cats } = cinqMille();
    const { boite } = fausseBoite(tous, [], cats);
    const hset = kv.hset.bind(kv);
    let panne = true;
    const kvPanne = { ...kv, hset: async (k: string, f: string, v: string) => {
      if (panne && k === CLES_CLARA.curseur && f === 'uid') throw new Error('Upstash');
      return hset(k, f, v);
    } };
    await expect(avancerStats(kvPanne, boite, 0)).rejects.toThrow('Upstash');
    panne = false;
    for (let i = 0; i < 4; i++) await avancerStats(kvPanne, boite, 0);
    expect((await kv.hgetall(CLES_CLARA.compteurs)).lus).toBe('5000');
    await recommencerStats(kv);
    expect((await kv.hgetall(CLES_CLARA.compteurs)).lus).toBeUndefined();
  });
  it('F5 : meilleursExpediteurs lit l\'index, pas toute la table', async () => {
    const kv = memoire();
    const { tous, cats } = cinqMille();
    const { boite } = fausseBoite(tous, [], cats);
    for (let i = 0; i < 3; i++) await avancerStats(kv, boite, 0);
    const lus: string[] = [];
    const espion = { ...kv, hgetall: async (c: string) => { lus.push(c); return kv.hgetall(c); } };
    const l = await meilleursExpediteurs(espion, () => true, 10);
    expect(l).toHaveLength(10);
    expect(l.every(s => s.total === 100)).toBe(true);
    expect(lus).not.toContain(CLES_CLARA.stats);
  });
});
