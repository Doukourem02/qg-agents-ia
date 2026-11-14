import type { VueFeu } from '../feu/etiquette';
import type { StatutPaire } from '../feu/types';
import { describe, expect, it, vi } from 'vitest';
import { memoire, type KV } from '../memoire';
import { CLES, Refus, type Entree } from '../qg';
import { passagesSemaine } from '../vues';
import { CLES_LUFFY } from '../luffy/vigie';
import type { VueLuffy } from '../luffy/vue';
import type { VueLea } from '../lea/etiquette';
import type { VueLight } from '../light/vue';
import type { VueMafe } from '../mafe/vue';
import type { MessageJour } from '../light/api';
import { compteRendu, ligneFeu, type EtatMatin } from './message';
import type { Reunion, Sujet } from '@/data/crise';
import { lireEtatMatin } from './lecture';
import { CLES_MATIN, envoyerCompteRendu, jourDuCreneau, TEXTE_JOURNAL } from './envoi';

// Jeudi 12 novembre 2026, 08:15 à Abidjan (= UTC) : l'heure du compte rendu.
const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;
const NOW = Date.UTC(2026, 10, 12, 8, 15);
const HIER = NOW - JOUR;
const SAMEDI = Date.UTC(2026, 10, 14, 8, 15);

const entree = (agent: string, texte: string, quand: number): Entree => ({ quand, agent, type: 'etat', texte, statut: 'termine', origine: 'agent' });
/** Les passages comme le Calendrier les voit (semaine d'avant + semaine de `now`), à partir d'un journal. */
function passages(now: number, journal: Entree[], messages: Record<string, MessageJour> = {}) {
  const minuit = now - (now % JOUR);
  const lundi = minuit - ((new Date(now).getUTCDay() + 6) % 7) * JOUR;
  const j = [...journal].sort((a, b) => b.quand - a.quand);
  return [...passagesSemaine(lundi - 7 * JOUR, now, j, messages), ...passagesSemaine(lundi, now, j, messages)];
}
/** Une journée où chacun est passé à l'heure (hier et ce matin). */
const journalNormal = (now: number) => {
  const minuit = now - (now % JOUR), veille = minuit - JOUR;
  const ouvre = (t: number) => ![0, 6].includes(new Date(t).getUTCDay());
  const jour = new Date(veille).getUTCDay(); // 4 = jeudi, 5 = vendredi
  return [
    ...(ouvre(veille) ? [entree('mafe', 'point du matin', veille + 7 * H + 35 * MIN)] : []),
    entree('kuroro', 'a envoyé le compte rendu du matin', veille + 8 * H + 15 * MIN),
    entree('light', 'termine le rapport du matin', veille + 8 * H + 5 * MIN),
    entree('clara', 'questions posées', veille + 9 * H + 2 * MIN),
    ...(jour === 4 ? [entree('paul', 'a relu la semaine de 4 projets', veille + 18 * H + 3 * MIN)] : []),
    ...(jour === 5 ? [entree('mafe', 'envoie le point sur Telegram', veille + 17 * H + MIN), entree('ye', 'a comparé la semaine de 3 fiches', veille + 17 * H + 32 * MIN)] : []),
    ...(ouvre(minuit) ? [entree('mafe', 'point du matin', minuit + 7 * H + 35 * MIN)] : []),
    entree('light', 'termine le rapport du matin', minuit + 8 * H + 5 * MIN),
  ];
};

const SITES = ['QG', 'Livreo', 'Terra', 'Portfolio', 'Boutique Shop', 'Duolingo'].map((nom, i) => ({ id: `s${i}`, nom, enLigne: true }));
const luffy = (o: Partial<VueLuffy> = {}, now = NOW): VueLuffy => ({ sites: SITES, pannes7j: [], dernier: now - 2 * MIN, endormi: false, ...o });
const relecture = (quand: number, n: number, o: object = {}) => ({
  depot: 'mon-compte/qg', quand, commits: Array.from({ length: n }, (_, i) => ({ sha: `abc${i}`, message: 'm' })),
  enPartie: [], clesNonVerifiees: [], rienACoder: 0, ...o,
});
const lea = (o: Partial<VueLea> = {}, now = NOW): VueLea => ({ passage: now - 50 * MIN, absente: false, constats: [], relectures: [relecture(now - 5 * H, 4)], tentative: null, ...o });
const light = (now: number, o: Partial<VueLight> = {}): VueLight => {
  const jour = new Date(now).toISOString().slice(0, 10);
  return {
    jour, aJour: true, quand: now - 10 * MIN, resume: 'Rien de neuf.', projets: [], general: [], message: { etat: 'rien' },
    lectures: [{ titre: 'A', url: 'https://a.example', pourquoi: 'p' }, { titre: 'B', url: 'https://b.example', pourquoi: 'p' }],
    historique: [{ jour, alertes: 0, vu: false }], comptesNonLus: [], ...o,
  };
};
const mafe = (now: number): VueMafe => ({
  releve: {
    jour: new Date(now).toISOString().slice(0, 10), quand: now - 40 * MIN, projets: [], aEcrire: [],
    priorite: { depot: 'mon-compte/qg', nom: 'QG', raison: 'une tâche urgente attend : brancher le compte rendu du matin' },
  },
  derniereNote: null, message: null,
});
const clara = (o: Partial<NonNullable<EtatMatin['clara']>> = {}, now = NOW): NonNullable<EtatMatin['clara']> => ({
  bannis: 17, nettoyages: [{ quand: now - 3 * H, n: 7 }, { quand: now - 2 * H, n: 5 }], nettoyagesComplets: true,
  journal: [{ quand: now - 3 * H, texte: 'bannissements appliqués' }, { quand: now - 2 * H, texte: 'bannissements appliqués' }], journalComplet: true, ...o,
});
const etat = (now = NOW, o: Partial<EtatMatin> = {}): EtatMatin => ({
  passages: passages(now, journalNormal(now)), enAttente: [], luffy: luffy({}, now), lea: lea({}, now), clara: clara({}, now), light: light(now), mafe: mafe(now), ...o,
});
const lignes = (t: string) => t.split('\n');
/** Un bloc du message (« Cette nuit », « Ce matin »…), jusqu'à la ligne vide suivante. */
const bloc = (t: string, titre: string) => t.split('\n\n').find(b => b.startsWith(titre)) ?? '';

describe('compte rendu du matin · le message', () => {
  it('jour normal, tout va bien : la forme validée, avec les vrais chiffres', () => {
    expect(compteRendu(etat(), NOW)).toBe([
      '☀️ Bonjour patron · jeudi 12 novembre',
      '',
      'Cette nuit',
      '• Luffy : les 6 sites ont tenu, aucune panne',
      '• Léa : 4 enregistrements relus, rien à signaler',
      '• Clara : 12 mails bannis mis à la corbeille',
      '',
      'Ce matin',
      '• Mafe : ta priorité du jour — « QG : une tâche urgente attend : brancher le compte rendu du matin »',
      '• Light : relevé fait, aucune alerte, 2 lectures conseillées',
      '',
      'Aujourd\'hui',
      '• Clara passe à 09:00 (propose de nouveaux expéditeurs à nettoyer)',
      '• Paul passe à 18:00 (README et CLAUDE.md)',
      '',
      'Ce qui t\'attend : rien à valider',
    ].join('\n'));
  });

  it('court : moins de 25 lignes, et ni Luffy/Léa/Clara horaires ni la rédaction en pause de L dans « Aujourd\'hui »', () => {
    const t = compteRendu(etat(), NOW);
    expect(lignes(t).length).toBeLessThan(25);
    expect(t).not.toMatch(/rédige|brouillon|toutes les/i);
    expect(t).not.toContain('Kuroro');
  });

  it('week-end : pas de ligne Mafe, ni de point « pas arrivé »', () => {
    const t = compteRendu(etat(SAMEDI), SAMEDI);
    expect(t).toContain('☀️ Bonjour patron · samedi 14 novembre');
    expect(t).not.toContain('Mafe');
    expect(t).not.toContain('Raté hier');
    expect(t).toContain('• Light : relevé fait, aucune alerte, 2 lectures conseillées');
    expect(t).not.toContain('Paul passe');
    expect(t).toContain('• Clara passe à 09:00');
  });

  it('une panne de Luffy dans la nuit : le site, les heures, la durée ; une panne en cours aussi', () => {
    const t = compteRendu(etat(NOW, {
      luffy: luffy({
        pannes7j: [
          { nom: 'Livreo', debut: NOW - 6 * H, fin: NOW - 5 * H - 45 * MIN, duree: '15 min' },
          { nom: 'Terra', debut: NOW - 20 * MIN, duree: '20 min' },
          { nom: 'QG', debut: NOW - 30 * H, fin: NOW - 29 * H, duree: '1 h' }, // avant-hier soir : pas cette nuit
        ],
      }),
    }), NOW);
    expect(t).toContain('• Luffy : 2 pannes — Livreo en panne de 02:15 à 02:30 (15 min), revenu ; Terra en panne depuis 07:55');
    expect(t).not.toContain('ont tenu');
  });

  it('ce que le patron a dit d\'ignorer : une ligne courte, et la panne ignorée n\'est pas redite par Luffy', () => {
    const t = compteRendu(etat(NOW, {
      luffy: luffy({ pannes7j: [{ nom: 'API Livreo', debut: NOW - 45 * H, duree: '1 j 21 h' }] }),
      silence: {
        pause: null, ignores: [
          { groupe: 'site:api-livreo', agent: 'luffy', libelle: 'API Livreo', depuis: NOW - 20 * H, reprendre: 'Livreo' },
          { groupe: 'zoro', agent: 'zoro', libelle: '13 failles critiques de Zoro', depuis: NOW - 19 * H, reprendre: 'Zoro' },
        ],
      },
    }), NOW);
    expect(t).toContain('• ignorés : API Livreo, 13 failles critiques de Zoro');
    expect(t).not.toContain('API Livreo en panne');
    expect(compteRendu(etat(NOW, { silence: { pause: null, ignores: [] } }), NOW)).not.toContain('ignorés');
  });

  it('Luffy qui ne vérifie plus ne dit pas que les sites ont tenu', () => {
    const t = compteRendu(etat(NOW, { luffy: luffy({ dernier: HIER + 14 * H, endormi: true }) }), NOW);
    expect(t).toContain('• Luffy : ne vérifie plus depuis hier 22:15');
    expect(compteRendu(etat(NOW, { luffy: luffy({ dernier: null, endormi: true }) }), NOW)).toContain('• Luffy : pas encore de vérification');
  });

  it('Léa avec un signalement : le point grave et le projet', () => {
    const constat = { id: 'ia|x', depot: 'mon-compte/app_livraison', sha: 'abc', message: 'm', fichier: 'a.ts', ligne: 3, gravite: 'grave' as const, quoi: 'q', conseil: 'c', source: 'lea' as const, quand: NOW - 4 * H, statut: 'ouvert' as const };
    const t = compteRendu(etat(NOW, { lea: lea({ constats: [constat, { ...constat, id: 'ia|y', gravite: 'mineur' }] }) }), NOW);
    expect(t).toContain('• Léa : 4 enregistrements relus, 1 point grave à corriger (Livreo), 1 petite remarque');
    expect(t).not.toContain('rien à signaler');
  });

  it('Léa sans nouvelles, ou sans push à relire, ou relu en partie : dit franchement', () => {
    expect(compteRendu(etat(NOW, { lea: lea({ passage: HIER + 12 * H, absente: true }) }), NOW)).toContain('• Léa : pas de nouvelles depuis hier 20:15');
    expect(compteRendu(etat(NOW, { lea: lea({ relectures: [] }) }), NOW)).toContain('• Léa : rien de nouveau à relire');
    expect(compteRendu(etat(NOW, { lea: lea({ relectures: [relecture(NOW - H, 2, { enPartie: ['gros.json'] })] }) }), NOW))
      .toContain('• Léa : 2 enregistrements relus, une partie relue en partie seulement');
  });

  it('Light pas encore passé, puis relevé raté une heure après', () => {
    const sansLight = journalNormal(NOW).filter(e => !(e.agent === 'light' && e.quand > NOW - 2 * H));
    const avant = etat(NOW, { passages: passages(NOW, sansLight), light: light(NOW - JOUR, { aJour: false }) });
    expect(compteRendu(avant, NOW)).toContain('• Light : relevé pas encore fait');
    const tard = NOW + 50 * MIN; // 09:05 : nouvel essai de QStash
    const apres = etat(tard, { passages: passages(tard, sansLight), light: light(NOW - JOUR, { aJour: false }) });
    expect(compteRendu(apres, tard)).toContain('• Light : le relevé de 08:00 n\'est pas arrivé');
  });

  it('routine ratée hier : elle se dit ; Mafe pas encore passée ce matin aussi', () => {
    const sansPaulNiMafe = journalNormal(NOW).filter(e => !(e.agent === 'mafe' && e.quand > NOW - 2 * H));
    // mercredi 11 : Clara n'est pas passée à 09:00
    const journal = sansPaulNiMafe.filter(e => e.agent !== 'clara');
    const t = compteRendu(etat(NOW, { passages: passages(NOW, journal) }), NOW);
    expect(t).toContain('Raté hier\n• Clara : propose de nouveaux expéditeurs à nettoyer (09:00) n\'a pas eu lieu');
    expect(t).toContain('• Mafe : le point de 07:30 n\'est pas encore arrivé');
  });

  it('source illisible : la ligne le dit, rien d\'inventé', () => {
    const t = compteRendu(etat(NOW, { luffy: null, lea: null, clara: null, light: null, mafe: null, enAttente: null }), NOW);
    expect(t).toContain('• Luffy : je n\'ai pas pu lire son état');
    expect(t).toContain('• Léa : je n\'ai pas pu lire son état');
    expect(t).toContain('• Clara : je n\'ai pas pu lire son état');
    expect(t).toContain('• Light : je n\'ai pas pu lire son relevé');
    expect(t).toContain('• Mafe : je n\'ai pas pu lire son point');
    expect(t).toContain('Ce qui t\'attend : je n\'ai pas pu le lire');
    const sansJournal = compteRendu(etat(NOW, { passages: null }), NOW);
    expect(sansJournal).toContain('je n\'ai pas pu lire le journal');
    expect(sansJournal).not.toContain('Aujourd\'hui');
  });

  it('Clara : sans banni pas de ligne ; une liste coupée dit « au moins » ; un journal incomplet ne fait rien affirmer', () => {
    expect(compteRendu(etat(NOW, { clara: clara({ bannis: 0 }) }), NOW)).not.toContain('Clara :');
    expect(compteRendu(etat(NOW, { clara: clara({ nettoyagesComplets: false }) }), NOW)).toContain('• Clara : au moins 12 mails bannis mis à la corbeille');
    expect(compteRendu(etat(NOW, { clara: clara({ nettoyages: [] }) }), NOW)).toContain('• Clara : aucun mail de banni cette nuit');
    expect(compteRendu(etat(NOW, { clara: clara({ nettoyages: [], journal: [] }) }), NOW)).toContain('• Clara : pas de passage cette nuit');
    expect(compteRendu(etat(NOW, { clara: clara({ nettoyages: [], journal: [], journalComplet: false }) }), NOW)).toContain('• Clara : je n\'ai pas pu vérifier ses passages de la nuit');
    expect(compteRendu(etat(NOW, { clara: clara({ nettoyages: [], journal: [{ quand: NOW - H, texte: 'bannissements interrompus' }] }) }), NOW))
      .toContain('• Clara : la corbeille des bannis a échoué cette nuit (1 essai)');
  });

  it('ce qui attend : une seule chose sur la ligne, plusieurs en liste', () => {
    const une = compteRendu(etat(NOW, { enAttente: [{ agent: 'paul', texte: 'propositions à valider', nombre: 2, ouvre: 'bureauPaul' }] }), NOW);
    expect(une).toMatch(/Ce qui t'attend : 2 propositions à valider \(Paul\)$/);
    const plusieurs = compteRendu(etat(NOW, {
      enAttente: [
        { agent: 'paul', texte: 'propositions à valider', nombre: 2, ouvre: 'bureauPaul' },
        { agent: 'clara', texte: 'question à répondre', nombre: 1, ouvre: 'bureauClara' },
        { agent: 'light', texte: 'relevé du jour envoyé, pas encore vu', ouvre: 'releveLight' },
      ],
    }), NOW);
    expect(plusieurs).toMatch(/Ce qui t'attend\n• Paul : 2 propositions à valider\n• Clara : 1 question à répondre\n• Light : relevé du jour envoyé, pas encore vu$/);
  });
});

describe('compte rendu du matin · lecture dans Upstash', () => {
  it('un QG vide : rien d\'inventé (pas encore de vérification, relevé pas encore fait, rien à valider)', async () => {
    const t = compteRendu(await lireEtatMatin(memoire(), NOW), NOW);
    expect(t).toContain('• Luffy : pas encore de vérification');
    expect(t).toContain('• Léa : pas encore de relecture complète');
    expect(bloc(t, 'Cette nuit')).not.toContain('Clara'); // aucun banni : rien à faire la nuit
    expect(bloc(t, 'Raté hier')).toContain('• Light : relevé des versions (08:00) n\'a pas eu lieu'); // aucune trace hier
    expect(t).toContain('• Light : relevé pas encore fait');
    expect(t).toContain('• Mafe : le point de 07:30 n\'est pas encore arrivé');
    expect(t).toContain('Ce qui t\'attend : rien à valider');
  });
  it('lit le vrai état : une panne de Luffy rangée, le passage de Clara au journal', async () => {
    const kv = memoire();
    await kv.hset(CLES_LUFFY.dernier, 'quand', String(NOW - MIN));
    await kv.lpush(CLES_LUFFY.pannes, JSON.stringify({ site: 'livreo', nom: 'Livreo', debut: NOW - 3 * H, fin: NOW - 2 * H }));
    await kv.lpush(CLES.journal, JSON.stringify(entree('light', 'termine le rapport du matin', NOW - 10 * MIN)));
    const e = await lireEtatMatin(kv, NOW);
    expect(compteRendu(e, NOW)).toContain('• Luffy : 1 panne — Livreo en panne de 05:15 à 06:15 (1 h), revenu');
    expect(e.passages!.find(c => c.routine === 'light-releve' && c.quand === NOW - 15 * MIN)!.etat).toBe('fait');
  });
  it('une source qui ne se lit pas devient « je n\'ai pas pu lire »', async () => {
    const base = memoire();
    const kv: KV = { ...base, hgetall: (k: string) => (k === CLES_LUFFY.etat ? Promise.reject(new Error('panne')) : base.hgetall(k)) };
    expect(compteRendu(await lireEtatMatin(kv, NOW), NOW)).toContain('• Luffy : je n\'ai pas pu lire son état');
  });
});

describe('compte rendu du matin · un seul envoi par jour', () => {
  const lire = async () => etat();

  it('le jour du créneau : 08:15 à 10 minutes près ; un essai avant appartient à la veille', () => {
    expect(jourDuCreneau(NOW)).toBe('2026-11-12');
    expect(jourDuCreneau(NOW - 9 * MIN)).toBe('2026-11-12');
    expect(jourDuCreneau(NOW - 11 * MIN)).toBe('2026-11-11');
    expect(jourDuCreneau(Date.UTC(2026, 10, 12, 23, 59))).toBe('2026-11-12');
  });

  it('un réveil de QStash quelques secondes avant 08:15 compte pour le créneau (Calendrier « fait »)', async () => {
    const kv = memoire();
    await envoyerCompteRendu(kv, { envoyer: async () => ({}), lire }, NOW - 3_000);
    const [e] = (await kv.lrange(CLES.journal, 0, -1)).map(v => JSON.parse(v) as Entree);
    expect(e.quand).toBe(NOW);
    const c = passages(NOW + H, [e]).find(x => x.routine === 'kuroro-matin' && x.quand === NOW)!;
    expect(c.etat).toBe('inactif'); // avant la mise en service : rien d'affirmé
    const apres = Date.UTC(2026, 10, 13, 8, 15);
    const e2 = { ...e, quand: apres };
    expect(passages(apres + H, [e2]).find(x => x.routine === 'kuroro-matin' && x.quand === apres)!.etat).toBe('fait');
    expect(passages(apres + 2 * H, []).find(x => x.routine === 'kuroro-matin' && x.quand === apres)!.etat).toBe('rate');
  });

  it('envoie une fois, note le journal ; rejouer le même jour ne renvoie rien', async () => {
    const kv = memoire();
    const envoyer = vi.fn(async () => ({}));
    expect(await envoyerCompteRendu(kv, { envoyer, lire }, NOW)).toEqual({ envoye: true, jour: '2026-11-12' });
    expect(envoyer).toHaveBeenCalledTimes(1);
    expect(envoyer.mock.calls[0]).toEqual([compteRendu(etat(), NOW)]);
    expect(await kv.get(CLES_MATIN.envoi('2026-11-12'))).toBe(String(NOW));
    const journal = (await kv.lrange(CLES.journal, 0, -1)).map(v => JSON.parse(v) as Entree);
    expect(journal).toEqual([{ quand: NOW, agent: 'kuroro', type: 'etat', statut: 'termine', texte: TEXTE_JOURNAL, origine: 'agent' }]);

    expect(await envoyerCompteRendu(kv, { envoyer, lire }, NOW + 2 * H)).toEqual({ envoye: false, deja: true, jour: '2026-11-12' });
    expect(envoyer).toHaveBeenCalledTimes(1);
    expect(await kv.lrange(CLES.journal, 0, -1)).toHaveLength(1);
    // le lendemain : un nouveau message
    expect(await envoyerCompteRendu(kv, { envoyer, lire }, NOW + JOUR)).toEqual({ envoye: true, jour: '2026-11-13' });
  });

  it('Telegram en échec : rien n\'est marqué, 503 pour que QStash réessaie, puis le nouvel essai part', async () => {
    const kv = memoire();
    const envoyer = vi.fn(async () => { throw new Refus('Telegram injoignable', 502); });
    const err = await envoyerCompteRendu(kv, { envoyer, lire }, NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Refus);
    expect((err as Refus).code).toBe(503);
    expect(await kv.get(CLES_MATIN.envoi('2026-11-12'))).toBeNull();
    expect(await kv.lrange(CLES.journal, 0, -1)).toEqual([]);
    expect(await kv.get(CLES_MATIN.verrou)).toBeNull();
    const ok = vi.fn(async () => ({}));
    expect(await envoyerCompteRendu(kv, { envoyer: ok, lire }, NOW + 5 * MIN)).toEqual({ envoye: true, jour: '2026-11-12' });
  });

  it('un envoi déjà en cours : 503, aucun second message', async () => {
    const kv = memoire();
    await kv.setnx(CLES_MATIN.verrou, '1', 120);
    const envoyer = vi.fn(async () => ({}));
    await expect(envoyerCompteRendu(kv, { envoyer, lire }, NOW)).rejects.toMatchObject({ code: 503 });
    expect(envoyer).not.toHaveBeenCalled();
  });

  it('une lecture qui échoue : rien n\'est envoyé ni marqué', async () => {
    const kv = memoire();
    const envoyer = vi.fn(async () => ({}));
    await expect(envoyerCompteRendu(kv, { envoyer, lire: async () => { throw new Error('Upstash'); } }, NOW)).rejects.toThrow('Upstash');
    expect(envoyer).not.toHaveBeenCalled();
    expect(await kv.get(CLES_MATIN.envoi('2026-11-12'))).toBeNull();
  });
});

describe('les réunions de crise dans le compte rendu', () => {
  const livreo: Sujet = { cle: 'site:api-livreo', genre: 'site', agent: 'luffy', projet: 'Livreo', nom: 'API Livreo', detail: '503', depuis: NOW - 6 * H - 25 * MIN, grave: true };
  const finie: Reunion = {
    id: 'a', niveau: 'incident', debut: NOW - 6 * H, fin: NOW - 5 * H - 45 * MIN, sujets: [], vus: [{ ...livreo, regle: NOW - 5 * H - 45 * MIN }], agents: ['luffy'], vu: NOW,
  };
  it('une réunion finie cette nuit : « incident Livreo 02:15–02:30, réglé »', () => {
    const t = compteRendu(etat(NOW, { reunions: [finie] }), NOW);
    expect(t).toContain('Cette nuit\n• incident Livreo 02:15–02:30, réglé\n• Luffy');
  });
  it('une réunion en cours : son niveau, depuis quand, et ce qui est encore ouvert', () => {
    const enCours: Reunion = { ...finie, id: 'b', niveau: 'crise', fin: undefined, sujets: [livreo], vus: [livreo] };
    expect(compteRendu(etat(NOW, { reunions: [enCours] }), NOW)).toContain('• réunion de crise en cours depuis 02:15 · Livreo en panne depuis 6 h 25');
  });
  it('une réunion finie avant la nuit, ou aucune réunion : pas de ligne', () => {
    const avant: Reunion = { ...finie, id: 'c', debut: HIER + 10 * H, fin: HIER + 11 * H };
    for (const reunions of [[avant], [], null, undefined]) expect(compteRendu(etat(NOW, { reunions }), NOW)).not.toMatch(/incident|réunion de crise/);
  });
});

describe('compte rendu du matin · la ligne de Feu', () => {
  const T = Date.UTC(2026, 10, 13, 8, 15);
  const statut = (paire: 'BTCUSDT' | 'ETHUSDT') => ({ paire, statut: 'Hypothèse' as const, lu: Date.UTC(2026, 10, 13, 8, 0) }) as unknown as StatutPaire;
  const vue = (o: Partial<VueFeu> = {}) => ({ passage: { quand: T, statuts: [statut('BTCUSDT'), statut('ETHUSDT')] }, annonces: [{ quand: Date.UTC(2026, 10, 13, 13, 30), nom: 'PPI américain' }], pause: null, ...o }) as unknown as VueFeu;
  it('« BTC et ETH en Hypothèse, on attend ; PPI américain à 13:30 », avec l\'heure de lecture', () => {
    expect(ligneFeu(vue(), T)).toBe('Feu : BTC et ETH en Hypothèse, on attend ; PPI américain à 13:30 (lu à 08:00)');
  });
  it('pas encore de lecture : pas de ligne ; illisible : il le dit ; absent : rien', () => {
    expect(ligneFeu(vue({ passage: null }), T)).toBeNull();
    expect(ligneFeu(null, T)).toBe('Feu : je n\'ai pas pu lire son bureau');
    expect(ligneFeu(undefined, T)).toBeNull();
  });
});
