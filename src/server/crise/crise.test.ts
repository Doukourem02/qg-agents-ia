import { describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES, type Entree } from '../qg';
import { CLES_LUFFY } from '../luffy/vigie';
import { CLES_LEA } from '../lea/relecture';
import { CLES_ZORO } from '../zoro/mac';
import { astreinteDuJour } from '@/sim/astreinte';
import { nomCourt, type GenreSujet, type Sujet } from '@/data/crise';
import { CLES_CRISE, lireReunions, suivreCrise, type DepsCrise } from './suivi';
import { lireSujets } from './lecture';
import { sceneCrise, vueCrise } from './vue';

// Jeudi 12 novembre 2026, heure d'Abidjan (= UTC). Livreo tombe à 13:53, la réunion est vue à 14:05.
const MIN = 60_000;
const a = (h: number, m: number, j = 12) => Date.UTC(2026, 10, j, h, m);

const livreo = (o: Partial<Sujet> = {}): Sujet => ({
  cle: 'site:api-livreo', genre: 'site', agent: 'luffy', projet: 'Livreo', nom: 'API Livreo', detail: '503', depuis: a(13, 53), grave: true, ...o,
});

/** Un suivi dont la lecture des alertes est fixée à la main, et un Telegram qui garde ce qu'il envoie (ou échoue). */
function banc() {
  const kv = memoire();
  let sujets: Sujet[] = [];
  let illisibles: GenreSujet[] = [];
  const recus: string[] = [];
  let enPanne = false;
  const deps: DepsCrise = {
    envoyer: vi.fn(async (t: string) => { if (enPanne) throw new Error('Telegram injoignable'); recus.push(t); }),
    lire: async () => ({ sujets, illisibles }),
  };
  return {
    kv, recus, deps,
    alertes: (s: Sujet[], ill: GenreSujet[] = []) => { sujets = s; illisibles = ill; },
    telegram: (ok: boolean) => { enPanne = !ok; },
    passe: (now: number) => suivreCrise(kv, deps, now),
  };
}
const journal = async (kv: KV) => (await kv.lrange(CLES.journal, 0, -1)).map(v => JSON.parse(v) as Entree);

describe('aucune réunion sans vraie alerte', () => {
  it('rien d’ouvert, rien d’envoyé, rien dans le journal', async () => {
    const b = banc();
    for (let t = a(9, 0); t < a(12, 0); t += 5 * MIN) await b.passe(t);
    expect(await lireReunions(b.kv)).toEqual([]);
    expect(b.recus).toEqual([]);
    expect(await journal(b.kv)).toEqual([]);
    expect(await sceneCrise(b.kv, a(12, 0))).toBeNull();
  });
  it('une panne de moins de 10 min ne réunit personne', async () => {
    const b = banc();
    b.alertes([livreo({ depuis: a(14, 0), grave: false })]);
    expect(await b.passe(a(14, 5))).toMatchObject({ reunion: null, niveau: null });
    expect(b.recus).toEqual([]);
  });
});

describe('un incident : Livreo en panne', () => {
  it('début à la minute près, un seul message de début, les points à xx:00 et xx:30, la fin et son débrief', async () => {
    const b = banc();
    b.alertes([livreo()]);
    expect(await b.passe(a(14, 5) + 23_000)).toMatchObject({ niveau: 'incident' });
    expect(b.recus).toEqual(['🟠 Incident à 14:05 · Livreo en panne depuis 12 min · Kuroro, Stalker et Luffy en salle de réunion · prochain point à 14:30']);
    const [r] = await lireReunions(b.kv);
    expect(r).toMatchObject({ debut: a(14, 5), niveau: 'incident', agents: ['luffy'] });
    expect(r.fin).toBeUndefined();

    // les passages suivants (toutes les 5 min) ne renvoient rien
    for (const t of [a(14, 10), a(14, 15), a(14, 30), a(14, 35)]) await b.passe(t);
    expect(b.recus).toHaveLength(1);
    const enCours = (await vueCrise(b.kv, a(14, 35))).reunions[0];
    expect(enCours).toMatchObject({ points: [a(14, 30)], prochain: a(15, 0), titre: 'Livreo en panne depuis 42 min', participants: ['kuroro', 'stalker', 'luffy'] });

    // Livreo revient : fin à 14:40, un seul message de fin, une seule ligne de journal
    b.alertes([]);
    expect(await b.passe(a(14, 40) + 5_000)).toMatchObject({ reunion: null });
    expect(b.recus[1]).toBe('✅ Fin de l\'incident à 14:40 · Livreo revenu après 47 min · débrief dans le journal');
    await b.passe(a(14, 45));
    await b.passe(a(14, 50));
    expect(b.recus).toHaveLength(2);
    const lignes = (await journal(b.kv)).filter(e => e.agent === 'kuroro');
    expect(lignes.map(e => e.texte)).toEqual(['incident 14:05–14:40 · Livreo revenu']);

    // elle reste dans l'historique du Calendrier, avec son début, ses points et sa fin
    const v = await vueCrise(b.kv, a(18, 0));
    expect(v.scene).toBeNull();
    expect(v.reunions).toEqual([{
      id: String(a(14, 5)), niveau: 'incident', debut: a(14, 5), fin: a(14, 40), points: [a(14, 30)],
      titre: 'Livreo en panne', bilan: 'Livreo revenu', participants: ['kuroro', 'stalker', 'luffy'],
    }]);
    // la salle garde la réunion le temps du débrief (5 min), puis plus rien
    expect((await sceneCrise(b.kv, a(14, 43)))?.fin).toBe(a(14, 40));
    expect(await sceneCrise(b.kv, a(14, 46))).toBeNull();
  });

  it('plus d’une heure : un message par heure, jamais deux pour la même heure', async () => {
    const b = banc();
    b.alertes([livreo()]);
    for (let t = a(14, 5); t <= a(16, 10); t += 5 * MIN) await b.passe(t);
    expect(b.recus).toEqual([
      '🟠 Incident à 14:05 · Livreo en panne depuis 12 min · Kuroro, Stalker et Luffy en salle de réunion · prochain point à 14:30',
      'Livreo toujours en panne depuis 1 h 12 · prochain point à 15:30',
      'Livreo toujours en panne depuis 2 h 12 · prochain point à 16:30',
    ]);
    expect((await vueCrise(b.kv, a(16, 10))).reunions[0].points).toEqual([a(14, 30), a(15, 0), a(15, 30), a(16, 0)]);
  });

  it('un passage en double ne double rien (verrou)', async () => {
    const b = banc();
    b.alertes([livreo()]);
    const [x, y] = await Promise.all([b.passe(a(14, 5)), b.passe(a(14, 5))]);
    expect([x, y].filter(r => 'occupe' in r)).toHaveLength(1);
    expect(b.recus).toHaveLength(1);
    expect(await lireReunions(b.kv)).toHaveLength(1);
  });
});

describe('Telegram en échec : rien n’est marqué, nouvel essai', () => {
  it('le début repart au passage suivant (une seule fois)', async () => {
    const b = banc();
    b.alertes([livreo()]);
    b.telegram(false);
    expect(await b.passe(a(14, 5))).toMatchObject({ envoyes: [], echecs: [`${a(14, 5)}:debut`] });
    expect(await b.kv.get(CLES_CRISE.annonce(String(a(14, 5)), 'debut'))).toBeNull();
    b.telegram(true);
    await b.passe(a(14, 10));
    await b.passe(a(14, 15));
    // la réunion a commencé à 14:05 (l'alerte a été vue là), même si le message part à 14:10
    expect(b.recus).toEqual(['🟠 Incident à 14:05 · Livreo en panne depuis 17 min · Kuroro, Stalker et Luffy en salle de réunion · prochain point à 14:30']);
  });
  it('un début annoncé en retard d’une heure n’est pas suivi d’un rappel juste derrière', async () => {
    const b = banc();
    b.alertes([livreo()]);
    b.telegram(false);
    for (let t = a(14, 5); t < a(15, 10); t += 5 * MIN) await b.passe(t);
    b.telegram(true);
    await b.passe(a(15, 10));
    await b.passe(a(15, 15));
    expect(b.recus).toHaveLength(1);
    expect(b.recus[0]).toMatch(/^🟠 Incident à 14:05 · Livreo en panne depuis 1 h 17/);
  });
  it('la fin repart au passage suivant ; la réunion reste finie et le journal n’a qu’une ligne', async () => {
    const b = banc();
    b.alertes([livreo()]);
    await b.passe(a(14, 5));
    b.alertes([]);
    b.telegram(false);
    await b.passe(a(14, 40));
    expect(b.recus).toHaveLength(1);
    expect((await lireReunions(b.kv))[0].fin).toBe(a(14, 40));
    b.telegram(true);
    await b.passe(a(14, 45));
    await b.passe(a(14, 50));
    expect(b.recus.slice(1)).toEqual(['✅ Fin de l\'incident à 14:40 · Livreo revenu après 47 min · débrief dans le journal']);
    expect((await journal(b.kv)).filter(e => e.agent === 'kuroro')).toHaveLength(1);
  });
});

describe('Telegram sans inonder', () => {
  const lea: Sujet = { cle: 'lea:cle|1', genre: 'lea', agent: 'lea', projet: 'qg', nom: 'qg', detail: 'clé GitHub poussée par erreur', depuis: a(9, 40), grave: true };
  const portfolio = livreo({ cle: 'site:portfolio', projet: 'Portfolio', nom: 'Portfolio', depuis: a(14, 8), grave: false });

  it('un point de Léa (à corriger, pas une panne) : le début et la fin, jamais de rappel par heure', async () => {
    const b = banc();
    b.alertes([lea]);
    for (let t = a(10, 0); t <= a(14, 0); t += 5 * MIN) await b.passe(t);
    b.alertes([]);
    await b.passe(a(14, 5));
    expect(b.recus).toEqual([
      '🟠 Incident à 10:00 · point grave de Léa dans qg depuis 20 min · Kuroro, Stalker et Léa en salle de réunion · prochain point à 10:30',
      '✅ Fin de l\'incident à 14:05 · point grave de Léa réglé · débrief dans le journal',
    ]);
  });

  it('une vraie panne : 3 rappels au plus, puis le silence jusqu\'à la fin', async () => {
    const b = banc();
    b.alertes([livreo({ depuis: a(7, 50) })]);
    for (let t = a(8, 5); t <= a(14, 0); t += 5 * MIN) await b.passe(t);
    b.alertes([]);
    await b.passe(a(14, 5));
    expect(b.recus).toEqual([
      expect.stringMatching(/^🟠 Incident à 08:05 · /),
      'Livreo toujours en panne depuis 1 h 15 · prochain point à 09:30',
      'Livreo toujours en panne depuis 2 h 15 · prochain point à 10:30',
      'Livreo toujours en panne depuis 3 h 15 · prochain point à 11:30',
      expect.stringMatching(/^✅ Fin de l'incident à 14:05 · /),
    ]);
  });

  it('pas de rappel entre 22:00 et 07:00 ; le début et la fin partent quand même la nuit', async () => {
    const b = banc();
    b.alertes([livreo({ depuis: a(20, 50) })]);
    for (let t = a(21, 5); t <= a(23, 55); t += 5 * MIN) await b.passe(t);
    b.alertes([]);
    await b.passe(a(0, 10, 13));
    expect(b.recus).toEqual([
      expect.stringMatching(/^🟠 Incident à 21:05 · /),
      // 22:05 (1 h), 23:05 (2 h) : la nuit, pas de rappel
      expect.stringMatching(/^✅ Fin de l'incident à 00:10 · /),
    ]);
  });

  it('un incident qui devient une crise : un seul message pour le dire ; la fin et le journal disent « réunion de crise »', async () => {
    const b = banc();
    b.alertes([livreo()]);
    await b.passe(a(14, 5));
    b.alertes([livreo(), portfolio]);
    await b.passe(a(14, 10));
    await b.passe(a(14, 15));
    expect(b.recus.slice(1)).toEqual(['🔴 L\'incident devient une crise : Livreo et Portfolio en panne depuis 17 min · tous les cadres en salle de réunion · prochain point à 14:30']);
    b.alertes([]);
    await b.passe(a(14, 40));
    expect(b.recus[2]).toBe('✅ Fin de la réunion de crise à 14:40 · Livreo revenu après 47 min, Portfolio revenu après 32 min · débrief dans le journal');
    expect((await journal(b.kv)).filter(e => e.agent === 'kuroro').map(e => e.texte)).toEqual(['réunion de crise 14:05–14:40 · Livreo revenu, Portfolio revenu']);
  });

  it('devenue une crise avant que le début ne parte (Telegram en panne) : un seul message, celui de la crise', async () => {
    const b = banc();
    b.telegram(false);
    b.alertes([livreo()]);
    await b.passe(a(14, 5));
    b.alertes([livreo(), portfolio]);
    await b.passe(a(14, 10));
    b.telegram(true);
    await b.passe(a(14, 15));
    await b.passe(a(14, 20));
    expect(b.recus).toEqual(['🔴 Réunion de crise à 14:05 · Livreo et Portfolio en panne depuis 22 min · Kuroro, Stalker, Obito, Isaac et Luffy en salle de réunion · prochain point à 14:30']);
  });
});

describe('crise, nuit, sources illisibles', () => {
  it('2 sites en panne : tous les cadres ; une crise ne redescend pas en incident', async () => {
    const b = banc();
    b.alertes([livreo(), livreo({ cle: 'site:portfolio', projet: 'Portfolio', nom: 'Portfolio', depuis: a(14, 1), grave: false })]);
    await b.passe(a(14, 5));
    expect(b.recus[0]).toBe('🔴 Réunion de crise à 14:05 · Livreo et Portfolio en panne depuis 12 min · Kuroro, Stalker, Obito, Isaac et Luffy en salle de réunion · prochain point à 14:30');
    b.alertes([livreo()]);
    await b.passe(a(14, 10));
    expect((await lireReunions(b.kv))[0].niveau).toBe('crise');
  });
  it('la nuit : seulement Kuroro et l’agent d’astreinte', async () => {
    const b = banc();
    b.alertes([livreo({ depuis: a(22, 50) })]);
    await b.passe(a(23, 2));
    const nuit = nomCourt(astreinteDuJour(a(23, 2)));
    expect(b.recus[0]).toBe(`🟠 Incident à 23:02 · Livreo en panne depuis 12 min · Kuroro et ${nuit} en salle de réunion · prochain point à 23:30`);
  });
  it('une source illisible ne ferme pas la réunion (et n’en ouvre aucune)', async () => {
    const b = banc();
    b.alertes([], ['site']);
    await b.passe(a(14, 0));
    expect(await lireReunions(b.kv)).toEqual([]);
    b.alertes([livreo()]);
    await b.passe(a(14, 5));
    b.alertes([], ['site']);
    await b.passe(a(14, 10));
    expect((await lireReunions(b.kv))[0].fin).toBeUndefined();
    expect(b.recus).toHaveLength(1);
  });
});

describe('la lecture des vraies alertes dans Upstash', () => {
  it('Luffy (panne annoncée), Léa (point grave ouvert), Zoro (faille critique) ; jamais une panne pas encore annoncée', async () => {
    const kv = memoire();
    const now = a(14, 5);
    await kv.hset(CLES_LUFFY.etat, 'api-livreo', JSON.stringify({ echecs: 3, depuis: a(13, 53), annoncee: true, raison: 'erreur 503', vu: now }));
    await kv.hset(CLES_LUFFY.etat, 'portfolio', JSON.stringify({ echecs: 1, depuis: a(14, 0), raison: 'délai dépassé', vu: now }));
    await kv.hset(CLES_LEA.constats, 'cle|1', JSON.stringify({
      id: 'cle|1', depot: 'mon-compte/qg', sha: 'abc', message: 'm', fichier: 'a.ts', ligne: 3, gravite: 'grave', quoi: 'clé GitHub poussée par erreur',
      conseil: 'c', source: 'serveur', quand: a(13, 40), statut: 'ouvert',
    }));
    await kv.hset(CLES_LEA.constats, 'cle|2', JSON.stringify({
      id: 'cle|2', depot: 'mon-compte/qg', sha: 'abd', message: 'm', fichier: 'b.ts', ligne: 3, gravite: 'grave', quoi: 'déjà vu',
      conseil: 'c', source: 'serveur', quand: a(13, 40), statut: 'vu',
    }));
    await kv.hset(CLES_ZORO.tour, 'json', JSON.stringify({
      quand: a(9, 0, 10), type: 'tour', projets: [], nonLus: [], cles: [], mac: null, macVieux: false,
      importants: [
        { cle: 'faille:app_livraison:GHSA-1', partie: 'failles', projet: 'app_livraison', texte: 'faille critique dans next 15.0.0' },
        { cle: 'faille:qg:GHSA-2', partie: 'failles', projet: 'qg', texte: 'faille haute dans zod 3.0.0' },
      ],
    }));
    const { sujets, illisibles } = await lireSujets(kv, now);
    expect(illisibles).toEqual([]);
    const graves = sujets.filter(s => s.genre !== 'routine');
    expect(graves).toEqual([
      { cle: 'site:api-livreo', genre: 'site', agent: 'luffy', projet: 'Livreo', nom: 'API Livreo', detail: '503', depuis: a(13, 53), grave: true },
      { cle: 'lea:cle|1', genre: 'lea', agent: 'lea', projet: 'qg', nom: 'qg', detail: 'clé GitHub poussée par erreur', depuis: a(13, 40), grave: true },
      { cle: 'zoro:faille:app_livraison:GHSA-1', genre: 'zoro', agent: 'zoro', projet: 'app_livraison', nom: 'app_livraison', detail: 'faille critique dans next 15.0.0', depuis: a(9, 0, 10), grave: true },
    ]);
    // les passages prévus ratés comptent pour la crise, jamais seuls pour un incident
    expect(sujets.filter(s => s.genre === 'routine').every(s => !s.grave)).toBe(true);
  });
  it('un QG sans panne, sans point grave, sans faille critique, où chacun est passé : aucune alerte', async () => {
    const kv = memoire();
    await kv.hset(CLES_LUFFY.etat, 'api-livreo', JSON.stringify({ echecs: 0, vu: a(7, 0) }));
    // à 07:00, aucun passage du jour n'est encore en retard
    expect((await lireSujets(kv, a(7, 0))).sujets).toEqual([]);
  });
});
