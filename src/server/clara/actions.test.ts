import { describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '../memoire';
import { Refus } from '../qg';
import type { Bouton } from '../telegram';
import {
  ajouterVip, appliquerBannis, CLES_ACTIONS, corbeilleExpediteur, desabonner, entreeVip, estVip, LOT,
  poserQuestion1, repondre, retirerVip, type Banni, type DepsReponse, type Nettoyage,
  relancerQuestions1,
} from './actions';
import { ErreurGmail, type BoiteOuverte } from './imap';
import { CLES_CLARA, idExpediteur, type StatExpediteur } from './stats';

const NOW = 1_800_000_000_000;

/** Une fausse boîte : « Tous les messages » (A) = uid → From brut ; la corbeille (T) reçoit les UID déplacés. */
function fausseBoite(mails: [number, string][], opts: { echecs?: number[]; avantLot?: (n: number) => Promise<void> } = {}) {
  const tous = new Map(mails);
  const corbeille: number[] = [];
  const lots: number[][] = [];
  let appelsMove = 0, appelsFrom = 0;
  const boite: BoiteOuverte = {
    dossiers: async () => ({ corbeille: 'T', envoyes: 'S', tous: 'A' }),
    total: async () => tous.size,
    lireEntetes: async () => [],
    chercherGmail: async () => [],
    chercherDe: vi.fn(async (d: string, adresse: string, apres = 0) => {
      expect(d).toBe('A');
      // comme IMAP FROM : une sous-chaîne, sans casse
      return [...tous].filter(([u, de]) => u > apres && de.toLowerCase().includes(adresse)).map(([u]) => u).sort((x, y) => x - y);
    }),
    expediteurs: vi.fn(async (d: string, uids: number[]) => {
      expect(d).toBe('A');
      await opts.avantLot?.(++appelsFrom);
      return new Map(uids.filter(u => tous.has(u)).map(u => [u, tous.get(u)!] as const));
    }),
    corbeille: vi.fn(async (d: string, uids: number[]) => {
      expect(d).toBe('A');
      expect(uids.length).toBeLessThanOrEqual(LOT);
      appelsMove++;
      if (opts.echecs?.includes(appelsMove)) throw new ErreurGmail('Gmail injoignable');
      lots.push(uids);
      for (const u of uids) { tous.delete(u); corbeille.push(u); }
      return uids.length;
    }),
    fermer: vi.fn(async () => undefined),
  };
  return { boite, tous, corbeille, lots, ajouter: (u: number, de: string) => tous.set(u, de) };
}

function banc(mails: [number, string][] = [], opts: Parameters<typeof fausseBoite>[1] = {}) {
  const kv = memoire();
  const fb = fausseBoite(mails, opts);
  const envoyes: { texte: string; boutons?: Bouton[] }[] = [];
  const ouvrir = vi.fn(async () => fb.boite);
  const fetchFaux = vi.fn(async () => new Response('', { status: 200 }));
  const deps: DepsReponse = {
    envoyer: async (texte, boutons) => { envoyes.push({ texte, boutons }); },
    ouvrir, fetch: fetchFaux as unknown as typeof fetch,
  };
  return { kv, ...fb, envoyes, ouvrir, deps, fetchFaux };
}

const stat = (adresse: string, over: Partial<StatExpediteur> = {}): StatExpediteur =>
  ({ id: idExpediteur(adresse), adresse, total: 3, nonLus: 3, dernier: NOW, ...over });
const ranger = (kv: KV, s: StatExpediteur) => kv.hset(CLES_CLARA.stats, s.id, JSON.stringify(s));
const de = (n: number, adresse: string, depuis = 1) => Array.from({ length: n }, (_, i) => [depuis + i, adresse] as [number, string]);
const journal = async (kv: KV) => (await kv.lrange(CLES_CLARA.journal, 0, -1)).map(x => JSON.parse(x) as Nettoyage);
const banni = async (kv: KV, id: string) => JSON.parse((await kv.hgetall(CLES_CLARA.bannis))[id]) as Banni;

/** Question 1, Oui, puis question 2 Oui : l'expéditeur est banni. */
async function bannir(b: ReturnType<typeof banc>, s: StatExpediteur) {
  await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
  await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW);
  return repondre(b.kv, b.deps, `cl2:${s.id}:o`, NOW);
}

describe('VIP', () => {
  it('« @Banque.ci » → @banque.ci ; adresse avec nom affiché normalisée ; invalide refusé', async () => {
    const kv = memoire();
    expect(await ajouterVip(kv, ' @Banque.ci ')).toBe('@banque.ci');
    expect(await ajouterVip(kv, 'Paul <Paul@Ami.com>')).toBe('paul@ami.com');
    expect(Object.keys(await kv.hgetall(CLES_CLARA.vip)).sort()).toEqual(['@banque.ci', 'paul@ami.com']);
    for (const x of ['bonjour', '@', '@ci', 'a@', 'mailto:a@b.com', 'a b@c.com']) expect(entreeVip(x)).toBeNull();
    await expect(ajouterVip(kv, 'bonjour')).rejects.toBeInstanceOf(Refus);
  });
  it('estVip : adresse exacte, domaine et sous-domaine ; pas un autre domaine', async () => {
    const kv = memoire();
    await ajouterVip(kv, '@banque.ci');
    await ajouterVip(kv, 'paul@ami.com');
    expect(await estVip(kv, 'Alerte <Alerte@Banque.ci>')).toBe(true);
    expect(await estVip(kv, 'x@mail.banque.ci')).toBe(true);
    expect(await estVip(kv, 'paul@ami.com')).toBe(true);
    expect(await estVip(kv, 'pierre@ami.com')).toBe(false);
    expect(await estVip(kv, 'x@fausse-banque.ci')).toBe(false);
  });
  it('retirerVip', async () => {
    const kv = memoire();
    await ajouterVip(kv, '@banque.ci');
    expect(await retirerVip(kv, '@BANQUE.ci')).toBe(true);
    expect(await retirerVip(kv, '@banque.ci')).toBe(false);
    expect(await estVip(kv, 'a@banque.ci')).toBe(false);
  });
});

describe('question 1', () => {
  it('texte et boutons courts (≤ 64 octets)', async () => {
    const b = banc();
    const s = stat('news@x.com', { nom: 'Marque X', total: 312, nonLus: 312 });
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    expect(b.envoyes).toHaveLength(1);
    expect(b.envoyes[0].texte).toBe('Marque X (312 mails, 0 ouvert) est indésirable. Je mets ses mails à la corbeille ?');
    expect(b.envoyes[0].boutons).toEqual([{ texte: 'Oui', donnee: `cl1:${s.id}:o` }, { texte: 'Non', donnee: `cl1:${s.id}:n` }]);
    for (const x of b.envoyes[0].boutons!) expect(Buffer.byteLength(x.donnee)).toBeLessThanOrEqual(64);
    expect(JSON.parse((await b.kv.hgetall(CLES_CLARA.questions))[s.id])).toMatchObject({ etape: 1, adresse: 'news@x.com' });
  });
  it('sans nom : l\'adresse ; déjà posée : pas renvoyée', async () => {
    const b = banc();
    const s = stat('news@x.com', { total: 5, nonLus: 2 });
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    expect(b.envoyes).toHaveLength(1);
    expect(b.envoyes[0].texte).toMatch(/^news@x\.com \(5 mails, 3 ouverts\)/);
  });
  it('refuse un VIP (adresse ou domaine)', async () => {
    const b = banc();
    await ajouterVip(b.kv, '@x.com');
    await expect(poserQuestion1(b.kv, b.deps.envoyer, stat('news@x.com'), NOW)).rejects.toMatchObject({ code: 422 });
    expect(b.envoyes).toHaveLength(0);
  });
  it('envoi Telegram raté : la question n\'est pas rangée', async () => {
    const kv = memoire();
    await expect(poserQuestion1(kv, async () => { throw new Error('telegram'); }, stat('news@x.com'), NOW)).rejects.toThrow('telegram');
    expect(await kv.hgetall(CLES_CLARA.questions)).toEqual({});
  });
});

describe('repondre : jamais de corbeille sans « Oui »', () => {
  it('bouton cl1:o sans question posée : rien, pas de connexion', async () => {
    const b = banc(de(5, 'news@x.com'));
    expect(await repondre(b.kv, b.deps, `cl1:${idExpediteur('news@x.com')}:o`, NOW)).toBe('Déjà fait.');
    expect(b.ouvrir).not.toHaveBeenCalled();
    expect(b.corbeille).toEqual([]);
  });
  it('données inconnues ou trop longues : rien', async () => {
    const b = banc();
    for (const d of ['cl1:abc', 'cl1:abc:x', 'cl3:abc:o', 'cl1:' + 'a'.repeat(40) + ':o', 'cld:']) {
      expect(await repondre(b.kv, b.deps, d, NOW)).toBe('Bouton inconnu.');
    }
    expect(b.ouvrir).not.toHaveBeenCalled();
  });
});

describe('cl1:o → corbeille, puis question 2', () => {
  it('déplace tous les mails de l\'expéditeur (et seulement les siens), ferme la boîte, pose la question 2', async () => {
    const b = banc([...de(3, 'Marque X <News@X.com>'), [10, 'breakingnews@x.com'], [11, 'ami@y.com']]);
    const s = stat('news@x.com', { nom: 'Marque X' });
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    expect(await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW)).toBe('3 mails mis à la corbeille.');
    // « FROM news@x.com » attrape aussi breakingnews@x.com : la relecture du From l'écarte
    expect(b.corbeille).toEqual([1, 2, 3]);
    expect(b.boite.fermer).toHaveBeenCalledTimes(1);
    expect(b.envoyes[1]).toEqual({
      texte: 'Tu ne veux plus jamais recevoir les mails de Marque X ?',
      boutons: [{ texte: 'Oui', donnee: `cl2:${s.id}:o` }, { texte: 'Non', donnee: `cl2:${s.id}:n` }],
    });
    expect(await journal(b.kv)).toEqual([{ quand: expect.any(Number), adresse: 'news@x.com', n: 3 }]);
    expect(await b.kv.hgetall(CLES_ACTIONS.reprise(s.id))).toEqual({});
  });

  it('bouton rejoué (double tap) : une seule corbeille, une seule question 2', async () => {
    const b = banc(de(4, 'news@x.com'));
    const s = stat('news@x.com');
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW);
    b.ajouter(50, 'news@x.com'); // même un nouveau mail ne déclenche rien au second tap
    expect(await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW)).toBe('Déjà fait.');
    expect(b.ouvrir).toHaveBeenCalledTimes(1);
    expect(b.corbeille).toEqual([1, 2, 3, 4]);
    expect(b.envoyes.filter(e => e.boutons?.[0].donnee.startsWith('cl2:'))).toHaveLength(1);
  });

  it('double tap simultané : le verrou laisse passer un seul appel', async () => {
    const b = banc(de(4, 'news@x.com'));
    const s = stat('news@x.com');
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    const r = await Promise.all([repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW), repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW)]);
    expect(r).toContain('Déjà en cours, patiente un instant.');
    expect(b.ouvrir).toHaveBeenCalledTimes(1);
    expect(b.corbeille).toHaveLength(4);
    expect(b.envoyes.filter(e => e.boutons?.[0].donnee.startsWith('cl2:'))).toHaveLength(1);
  });

  it('10 000 mails : lots de 500, erreur au 3ᵉ lot, reprise au tap suivant', async () => {
    const b = banc(de(10_000, 'news@x.com'), { echecs: [3] });
    const s = stat('news@x.com');
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    const r1 = await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW);
    expect(r1).toBe('Mise à la corbeille interrompue (Gmail injoignable) : 1000 mails déjà à la corbeille.');
    expect(b.corbeille).toHaveLength(1000);
    expect(b.boite.fermer).toHaveBeenCalledTimes(1);
    expect(await b.kv.hgetall(CLES_ACTIONS.reprise(s.id))).toEqual({ deplaces: '1000', dernierUid: '1000' });
    // un bouton pour reprendre (ceux du message touché sont retirés)
    expect(b.envoyes.at(-1)?.boutons).toEqual([{ texte: 'Continuer', donnee: `cl1:${s.id}:o` }]);
    expect(b.envoyes.some(e => e.boutons?.[0].donnee.startsWith('cl2:'))).toBe(false);

    const r2 = await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW);
    expect(r2).toBe('10000 mails mis à la corbeille.');
    expect(b.corbeille).toHaveLength(10_000);
    expect(new Set(b.corbeille).size).toBe(10_000);
    expect(b.lots).toHaveLength(20);
    expect(b.lots.every(l => l.length === 500)).toBe(true);
    expect(b.envoyes.filter(e => e.boutons?.[0].donnee.startsWith('cl2:'))).toHaveLength(1);
    expect(await journal(b.kv)).toEqual([{ quand: expect.any(Number), adresse: 'news@x.com', n: 10_000 }]);
  });

  it('temps écoulé : s\'arrête entre deux lots, « en cours… », reprise ensuite', async () => {
    const b = banc(de(1200, 'news@x.com'));
    const s = stat('news@x.com');
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    expect(await repondre(b.kv, { ...b.deps, finAvant: Date.now() - 1 }, `cl1:${s.id}:o`, NOW)).toBe('Mise à la corbeille en cours… 0 déjà.');
    expect(b.envoyes.at(-1)?.boutons?.[0].donnee).toBe(`cl1:${s.id}:o`);
    expect(await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW)).toBe('1200 mails mis à la corbeille.');
  });

  it('connexion refusée : message clair, rien déplacé, bouton pour réessayer', async () => {
    const b = banc(de(3, 'news@x.com'));
    const s = stat('news@x.com');
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    const deps = { ...b.deps, ouvrir: async () => { throw new ErreurGmail('Gmail refuse la connexion'); } };
    expect(await repondre(b.kv, deps, `cl1:${s.id}:o`, NOW)).toBe('Gmail refuse la connexion : rien n\'est déplacé pour l\'instant.');
    expect(b.corbeille).toEqual([]);
    expect(await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW)).toBe('3 mails mis à la corbeille.');
  });
});

describe('le VIP gagne toujours', () => {
  it('devenu VIP après la question : Oui ne déplace rien', async () => {
    const b = banc(de(3, 'news@x.com'));
    const s = stat('news@x.com');
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    await ajouterVip(b.kv, '@x.com');
    expect(await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW)).toBe('news@x.com est VIP : je ne touche pas à ses mails.');
    expect(b.corbeille).toEqual([]);
    expect(b.ouvrir).not.toHaveBeenCalled();
  });

  it('VIP ajouté pendant la corbeille : les lots suivants ne bougent plus', async () => {
    let kvRef: KV | null = null;
    const b = banc(de(1500, 'news@x.com'), { avantLot: async n => { if (n === 2) await ajouterVip(kvRef!, 'news@x.com'); } });
    kvRef = b.kv;
    const s = stat('news@x.com');
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW);
    expect(b.corbeille).toHaveLength(500);
  });

  it('VIP exact et VIP domaine jamais déplacés, même bannis', async () => {
    const b = banc([...de(2, 'promo@banque.ci'), ...de(2, 'news@x.com', 10)]);
    const promo = stat('promo@banque.ci'), news = stat('news@x.com');
    await bannir(b, promo);
    await bannir(b, news);
    expect(b.corbeille).toEqual([1, 2, 10, 11]);
    // ensuite le patron les met VIP (domaine pour l'une, adresse exacte pour l'autre)
    await ajouterVip(b.kv, '@Banque.ci');
    await ajouterVip(b.kv, 'news@x.com');
    b.ajouter(100, 'Promo <promo@banque.ci>');
    b.ajouter(101, 'news@x.com');
    b.ajouter(102, 'alerte@mail.banque.ci');
    expect(await appliquerBannis(b.kv, b.boite, NOW)).toEqual({ deplaces: 0 });
    expect(b.corbeille).toEqual([1, 2, 10, 11]);
    expect([...b.tous.keys()]).toEqual([100, 101, 102]);
  });

  it('corbeilleExpediteur seul : un VIP n\'est jamais déplacé', async () => {
    const kv = memoire();
    const fb = fausseBoite(de(3, 'news@x.com'));
    await ajouterVip(kv, 'news@x.com');
    expect(await corbeilleExpediteur(kv, fb.boite, 'news@x.com')).toBe(0);
    expect(fb.corbeille).toEqual([]);
  });
});

describe('cl1:n → gardé', () => {
  it('gardé, jamais déplacé, jamais reproposé', async () => {
    const b = banc(de(3, 'news@x.com'));
    const s = stat('news@x.com', { nom: 'Marque X' });
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    expect(await repondre(b.kv, b.deps, `cl1:${s.id}:n`, NOW)).toBe('Gardé : Marque X ne te sera plus proposé.');
    expect(Object.keys(await b.kv.hgetall(CLES_CLARA.gardes))).toEqual([s.id]);
    expect(await b.kv.hgetall(CLES_CLARA.questions)).toEqual({});
    expect(await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW)).toBe('Déjà fait.');
    await expect(poserQuestion1(b.kv, b.deps.envoyer, s, NOW)).rejects.toMatchObject({ code: 422 });
    expect(b.corbeille).toEqual([]);
    expect(b.envoyes).toHaveLength(1);
  });
});

describe('cl2 → banni, appliquerBannis', () => {
  it('cl2:o banni ; appliquerBannis ne déplace que les nouveaux, une seule fois', async () => {
    const b = banc(de(3, 'news@x.com'));
    const s = stat('news@x.com', { nom: 'Marque X' });
    expect(await bannir(b, s)).toBe('Banni : les nouveaux mails de Marque X iront à la corbeille.');
    expect(await banni(b.kv, s.id)).toMatchObject({ adresse: 'news@x.com', depuis: NOW, deplaces: 0, dernierUid: 3 });
    expect(await repondre(b.kv, b.deps, `cl2:${s.id}:o`, NOW)).toBe('Déjà fait.');

    b.ajouter(20, 'news@x.com');
    b.ajouter(21, 'News <NEWS@x.com>');
    b.ajouter(22, 'ami@y.com');
    expect(await appliquerBannis(b.kv, b.boite, NOW)).toEqual({ deplaces: 2 });
    expect(b.corbeille).toEqual([1, 2, 3, 20, 21]);
    expect(b.boite.chercherDe).toHaveBeenLastCalledWith('A', 'news@x.com', 3);
    expect(await banni(b.kv, s.id)).toMatchObject({ deplaces: 2, dernierUid: 21 });
    expect(await appliquerBannis(b.kv, b.boite, NOW)).toEqual({ deplaces: 0 });
    expect((await journal(b.kv))[0]).toEqual({ quand: NOW, adresse: 'news@x.com', n: 2 });
  });

  it('cl2:n : pas banni, appliquerBannis ne fait rien', async () => {
    const b = banc(de(3, 'news@x.com'));
    const s = stat('news@x.com');
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW);
    expect(await repondre(b.kv, b.deps, `cl2:${s.id}:n`, NOW)).toBe('Noté : news@x.com n\'est pas banni.');
    b.ajouter(20, 'news@x.com');
    expect(await appliquerBannis(b.kv, b.boite, NOW)).toEqual({ deplaces: 0 });
    expect(b.tous.has(20)).toBe(true);
  });

  it('débanni pendant le passage : arrêt, et pas recréé', async () => {
    let kvRef: KV | null = null;
    const id = idExpediteur('news@x.com');
    const b = banc(de(3, 'news@x.com'));
    kvRef = b.kv;
    await bannir(b, stat('news@x.com'));
    for (let i = 0; i < 1200; i++) b.ajouter(100 + i, 'news@x.com');
    (b.boite.expediteurs as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_d: string, uids: number[]) => {
      await kvRef!.hdel(CLES_CLARA.bannis, id);
      return new Map(uids.map(u => [u, 'news@x.com'] as const));
    });
    await appliquerBannis(b.kv, b.boite, NOW);
    expect(await b.kv.hgetall(CLES_CLARA.bannis)).toEqual({});
    expect(b.corbeille.length).toBeLessThanOrEqual(3 + 500);
  });

  it('un passage déjà en cours pour ce banni : sauté', async () => {
    const b = banc(de(3, 'news@x.com'));
    const s = stat('news@x.com');
    await bannir(b, s);
    b.ajouter(20, 'news@x.com');
    await b.kv.setnx(CLES_ACTIONS.verrou(s.id), '1', 300);
    expect(await appliquerBannis(b.kv, b.boite, NOW)).toEqual({ deplaces: 0 });
    expect(b.tous.has(20)).toBe(true);
  });
});

describe('désabonnement', () => {
  const https = { url: 'https://x.com/u?t=1', unClic: true };

  it('desabonner : jamais de mailto, POST un clic seulement', async () => {
    const f = vi.fn(async () => new Response('', { status: 200 }));
    const ff = f as unknown as typeof fetch;
    expect(await desabonner({ desabo: { url: 'mailto:u@x.com', unClic: false } }, ff)).toBe(false);
    expect(await desabonner({ desabo: { url: 'mailto:u@x.com', unClic: true } }, ff)).toBe(false);
    expect(await desabonner({ desabo: { url: 'http://x.com/u', unClic: true } }, ff)).toBe(false);
    expect(await desabonner({ desabo: { url: 'https://x.com/u', unClic: false } }, ff)).toBe(false);
    expect(await desabonner({}, ff)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(await desabonner({ desabo: https }, ff)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.com/u?t=1');
    expect(init).toMatchObject({ method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('desabonner : réponse en erreur ou réseau en panne → false', async () => {
    expect(await desabonner({ desabo: https }, (async () => new Response('', { status: 500 })) as unknown as typeof fetch)).toBe(false);
    expect(await desabonner({ desabo: https }, (async () => { throw new Error('timeout'); }) as unknown as typeof fetch)).toBe(false);
  });

  it('banni avec un lien https sans « un clic » : lien dans la page', async () => {
    const b = banc(de(1, 'news@x.com'));
    const s = stat('news@x.com', { desabo: { url: 'https://x.com/u', unClic: false } });
    await ranger(b.kv, s);
    expect(await bannir(b, s)).toContain('Pas de désabonnement automatique : lien dans la page.');
    expect(await repondre(b.kv, b.deps, `cld:${s.id}`, NOW)).toBe('Pas de désabonnement automatique : lien dans la page.');
    expect(b.fetchFaux).not.toHaveBeenCalled();
  });

  it('banni avec un clic : bouton cld proposé, Désabonné, puis Déjà fait', async () => {
    const b = banc(de(1, 'news@x.com'));
    const s = stat('news@x.com', { desabo: https });
    await ranger(b.kv, s);
    await bannir(b, s);
    const prop = b.envoyes.at(-1)!;
    expect(prop.boutons).toEqual([{ texte: 'Se désabonner', donnee: `cld:${s.id}` }]);
    expect(await repondre(b.kv, b.deps, `cld:${s.id}`, NOW)).toBe('Désabonné.');
    expect(await repondre(b.kv, b.deps, `cld:${s.id}`, NOW)).toBe('Déjà fait.');
    expect(b.fetchFaux).toHaveBeenCalledTimes(1);
    expect(await banni(b.kv, s.id)).toMatchObject({ desabonne: true });
  });

  it('banni sans un clic (mailto) : pas de bouton, pas de POST', async () => {
    const b = banc(de(1, 'news@x.com'));
    const s = stat('news@x.com', { desabo: { url: 'mailto:u@x.com', unClic: false } });
    await ranger(b.kv, s);
    expect(await bannir(b, s)).toBe('Banni : les nouveaux mails de news@x.com iront à la corbeille.');
    expect(b.envoyes.some(e => e.boutons?.[0].donnee.startsWith('cld:'))).toBe(false);
    expect(await repondre(b.kv, b.deps, `cld:${s.id}`, NOW)).toBe('Pas de désabonnement automatique.');
    expect(b.fetchFaux).not.toHaveBeenCalled();
  });

  it('cld sur un expéditeur non banni : rien', async () => {
    const b = banc();
    const s = stat('news@x.com', { desabo: https });
    await ranger(b.kv, s);
    expect(await repondre(b.kv, b.deps, `cld:${s.id}`, NOW)).toBe('Cet expéditeur n\'est pas banni : rien à faire.');
    expect(b.fetchFaux).not.toHaveBeenCalled();
  });
});

// ——— Relecture finale ———

describe('relecture finale : nettoyé, question 2, VIP, désabonnement', () => {
  const https = { url: 'https://x.com/u?t=1', unClic: true };

  it('F1 : corbeille finie → la fiche passe à 0 et « nettoyée », le désabonnement reste', async () => {
    const b = banc(de(3, 'news@x.com'));
    const s = stat('news@x.com', { total: 3, nonLus: 2, desabo: https });
    await ranger(b.kv, s);
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW);
    const f = JSON.parse((await b.kv.hgetall(CLES_CLARA.stats))[s.id]) as StatExpediteur & { nettoye?: number };
    expect(f).toMatchObject({ total: 0, nonLus: 0, desabo: https });
    expect(f.nettoye).toEqual(expect.any(Number));
  });

  it('F3 : question 2 non partie → le compte est rendu, et le Oui suivant la renvoie (une seule fois)', async () => {
    const b = banc(de(3, 'news@x.com'));
    const s = stat('news@x.com');
    let panne = false;
    const deps: DepsReponse = { ...b.deps, envoyer: async (t, bo) => { if (panne && bo?.[0].donnee.startsWith('cl2:')) throw new Error('telegram'); return b.deps.envoyer(t, bo); } };
    await poserQuestion1(b.kv, deps.envoyer, s, NOW);
    panne = true;
    expect(await repondre(b.kv, deps, `cl1:${s.id}:o`, NOW)).toMatch(/^3 mails mis à la corbeille\./);
    expect(JSON.parse((await b.kv.hgetall(CLES_CLARA.questions))[s.id])).toMatchObject({ etape: 2, q2Envoyee: false });
    panne = false;
    expect(await repondre(b.kv, deps, `cl1:${s.id}:o`, NOW)).toMatch(/question/i);
    expect(b.ouvrir).toHaveBeenCalledTimes(1);
    expect(b.envoyes.filter(e => e.boutons?.[0].donnee.startsWith('cl2:'))).toHaveLength(1);
    expect(await repondre(b.kv, deps, `cl1:${s.id}:o`, NOW)).toBe('Déjà fait.');
    expect(b.envoyes.filter(e => e.boutons?.[0].donnee.startsWith('cl2:'))).toHaveLength(1);
    expect(await repondre(b.kv, deps, `cl2:${s.id}:o`, NOW)).toMatch(/^Banni/);
  });

  it('F7 : devenu VIP pendant une reprise → la reprise est effacée', async () => {
    const b = banc(de(1200, 'news@x.com'), { echecs: [2] });
    const s = stat('news@x.com');
    await poserQuestion1(b.kv, b.deps.envoyer, s, NOW);
    await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW);
    expect(await b.kv.hgetall(CLES_ACTIONS.reprise(s.id))).not.toEqual({});
    await ajouterVip(b.kv, 'news@x.com');
    expect(await repondre(b.kv, b.deps, `cl1:${s.id}:o`, NOW)).toMatch(/est VIP/);
    expect(await b.kv.hgetall(CLES_ACTIONS.reprise(s.id))).toEqual({});
  });

  it('F7 : fiche d\'une autre adresse sous le même id → pas de désabonnement proposé ni fait', async () => {
    const b = banc(de(1, 'news@x.com'));
    const s = stat('news@x.com');
    await ranger(b.kv, { ...s, adresse: 'autre@y.com', desabo: https });
    await bannir(b, s);
    expect(b.envoyes.some(e => e.boutons?.[0].donnee.startsWith('cld:'))).toBe(false);
    expect(await repondre(b.kv, b.deps, `cld:${s.id}`, NOW)).toMatch(/^Pas de désabonnement automatique/);
    expect(b.fetchFaux).not.toHaveBeenCalled();
  });

  it('F2 : le banni garde son lien https (même après un recalcul des statistiques)', async () => {
    const b = banc(de(1, 'news@x.com'));
    const s = stat('news@x.com', { desabo: https });
    await ranger(b.kv, s);
    await bannir(b, s);
    expect(await banni(b.kv, s.id)).toMatchObject({ desabo: https });
    await b.kv.del(CLES_CLARA.stats);
    expect(await repondre(b.kv, b.deps, `cld:${s.id}`, NOW)).toBe('Désabonné.');
  });

  it('F2 : lien mailto seulement → aucune promesse de lien dans la page', async () => {
    const b = banc(de(1, 'news@x.com'));
    const s = stat('news@x.com', { desabo: { url: 'mailto:u@x.com', unClic: false } });
    await ranger(b.kv, s);
    expect(await bannir(b, s)).not.toContain('lien dans la page');
    expect(await repondre(b.kv, b.deps, `cld:${s.id}`, NOW)).toBe('Pas de désabonnement automatique.');
    expect((await banni(b.kv, s.id)).desabo).toBeUndefined();
  });

  it('F5 : total nettoyé tenu à part, au-delà des 100 entrées du journal', async () => {
    const kv = memoire();
    for (let i = 0; i < 120; i++) {
      const fb = fausseBoite([[1, `s${i}@x.com`]]);
      await corbeilleExpediteur(kv, fb.boite, `s${i}@x.com`);
    }
    expect(await journal(kv)).toHaveLength(100);
    expect((await kv.hgetall(CLES_CLARA.compteurs)).mailsNettoyes).toBe('120');
  });

  it('F6 : désabonnement sans suivre de redirection, jamais vers une IP ou localhost', async () => {
    const f = vi.fn(async () => new Response('', { status: 200 }));
    const ff = f as unknown as typeof fetch;
    for (const url of ['https://127.0.0.1/u', 'https://2130706433/u', 'https://[::1]/u', 'https://localhost/u', 'https://a.localhost/u', 'https://10.0.0.1/u']) {
      expect(await desabonner({ desabo: { url, unClic: true } }, ff)).toBe(false);
    }
    expect(f).not.toHaveBeenCalled();
    expect(await desabonner({ desabo: https }, ff)).toBe(true);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({ redirect: 'manual' });
    const redirige = (async () => new Response('', { status: 302, headers: { location: 'https://127.0.0.1/' } })) as unknown as typeof fetch;
    expect(await desabonner({ desabo: https }, redirige)).toBe(false);
  });
});

describe('relancerQuestions1', () => {
  it('renvoie seulement les questions 1 sans réponse, sans rien créer ni déplacer', async () => {
    const k = memoire();
    const q = (id: string, etape: 1 | 2, reponse?: 'o') => k.hset(CLES_CLARA.questions, id, JSON.stringify({ id, adresse: `${id}@x.com`, etape, quand: 1, ...(reponse ? { reponse } : {}) }));
    await q('aaa', 1); await q('bbb', 1, 'o'); await q('ccc', 2); await q('ddd', 1);
    const envois: { texte: string; boutons?: Bouton[] }[] = [];
    const n = await relancerQuestions1(k, async (texte, boutons) => { envois.push({ texte, boutons }); }, 0, async () => undefined);
    expect(n).toBe(3);
    expect(envois.map(e => e.boutons?.[0].donnee).sort()).toEqual(['cl1:aaa:o', 'cl1:ddd:o', 'cl2:ccc:o']);
    expect(envois[0].texte).toMatch(/^Rappel : /);
    expect(Object.keys(await k.hgetall(CLES_CLARA.questions)).sort()).toEqual(['aaa', 'bbb', 'ccc', 'ddd']);
  });
});
