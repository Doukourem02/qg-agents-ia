import { beforeEach, describe, expect, it } from 'vitest';
import { memoire, type KV } from './memoire';
import { CLES, type Entree, type Etat } from './qg';
import { CLES_ACCORDS } from './accords';
import { ajouterRegle, CLE_MEMOIRE_L } from './l/memoire';
import { ajouterRegleQG } from './regles';
import { CLE_POSTS, CLE_PROPOSITIONS } from './l/posts';
import { CLES_CLARA } from './clara/stats';
import { CLES_MAFE } from './mafe/releve';
import { CLES_LUFFY } from './luffy/vigie';
import { CLES_ISAAC } from './isaac/api';
import { CLES_LIGHT } from './light/releve';
import { CLE_PRESENCE } from './presence';
import { CLES_ZORO } from './zoro/mac';
import { CLES_LEA } from './lea/relecture';
import { CLES_PAUL } from './paul/stockage';
import { CLES_YE } from './ye/stockage';
import { ACTIVATION_MATIN, ACTIVATION_PAUL, ACTIVATION_YE, ACTIVATION_ZORO, PREVUS, REGLES_QG, ROUTINES, vuesQG, type Creneau } from './vues';

// Mardi 10 novembre 2026, 10:00 à Abidjan (= UTC). Lundi de la semaine : le 9.
const NOW = Date.UTC(2026, 10, 10, 10, 0);
const H = 3600_000, MIN = 60_000, JOUR = 24 * H;
const LUNDI = Date.UTC(2026, 10, 9);

let kv: KV;
const etat = (e: Partial<Etat> & { agent: string }) =>
  kv.hset(CLES.etats, e.agent, JSON.stringify({ statut: 'au travail', tache: 'travaille', quand: NOW, ...e }));
const entree = (e: Partial<Entree> & { agent: string; quand: number }) =>
  kv.lpush(CLES.journal, JSON.stringify({ type: 'etat', texte: 'fait quelque chose', origine: 'agent', ...e }));
const creneau = (c: Creneau[], id: string, jour: number) => c.find(x => x.routine === id && x.jour === jour);

beforeEach(() => { kv = memoire(); });

describe('vuesQG · Tâches', () => {
  it('en cours : seulement les vrais agents « au travail » depuis moins de 30 min', async () => {
    await etat({ agent: 'L', tache: 'rédige : un post', quand: NOW - 10 * MIN });
    await etat({ agent: 'light', tache: 'relevé du matin', quand: NOW - 45 * MIN }); // trop vieux
    await etat({ agent: 'clara', statut: 'termine', tache: 'mails mis à la corbeille', quand: NOW - MIN });
    await etat({ agent: 'obito', tache: 'relit', quand: NOW - MIN }); // pas encore un vrai agent
    const { taches } = await vuesQG(kv, NOW);
    expect(taches.enCours).toEqual([{ agent: 'L', tache: 'rédige : un post', depuis: NOW - 10 * MIN, outil: 'C' }]);
  });

  it('en attente : accords de L, sujet à choisir, questions de Clara, relevé de Light non vu', async () => {
    for (const [id, agent] of [['a1', 'L'], ['a2', 'L'], ['a3', 'clara']] as const) {
      await kv.hset(CLES_ACCORDS.tous, id, JSON.stringify({ id, agent, action: 'x', resume: 'y', statut: 'en attente', demande: NOW }));
      await kv.lpush(CLES_ACCORDS.attente, id);
    }
    await kv.hset(CLE_PROPOSITIONS, 'p1', JSON.stringify({ id: 'p1', semaine: '2026-W46', quand: NOW - H, sujets: [{ titre: 'a', angle: 'b', format: 'texte' }] }));
    await kv.hset(CLES_CLARA.questions, 'q1', JSON.stringify({ id: 'q1', adresse: 'a@b.com', etape: 1, quand: NOW }));
    await kv.hset(CLES_CLARA.questions, 'q2', JSON.stringify({ id: 'q2', adresse: 'c@d.com', etape: 2, quand: NOW }));
    await kv.hset(CLES_LIGHT.releves, '2026-11-10', JSON.stringify({ quand: NOW - 2 * H, lignes: [], alertes: [], comptesNonLus: [] }));
    await kv.hset(CLES_LIGHT.messages, '2026-11-10', JSON.stringify({ jour: '2026-11-10', texte: 't', cles: [], envoye: NOW - 2 * H, relances: [] }));
    const { taches } = await vuesQG(kv, NOW);
    expect(taches.enAttente).toEqual([
      { agent: 'L', texte: 'brouillon à valider', nombre: 2, ouvre: 'bureauL' },
      { agent: 'L', texte: 'choisir un sujet', ouvre: 'bureauL' },
      { agent: 'clara', texte: 'question à répondre', nombre: 2, ouvre: 'bureauClara' },
      { agent: 'light', texte: 'relevé du jour envoyé, pas encore vu', ouvre: 'releveLight' },
    ]);
  });

  it('en attente : rien quand tout est traité', async () => {
    await kv.hset(CLE_PROPOSITIONS, 'p1', JSON.stringify({ id: 'p1', semaine: 'w', quand: NOW, choix: 1, sujets: [] }));
    await kv.hset(CLES_LIGHT.releves, '2026-11-10', JSON.stringify({ quand: NOW, lignes: [], alertes: [], comptesNonLus: [] }));
    await kv.hset(CLES_LIGHT.messages, '2026-11-10', JSON.stringify({ jour: '2026-11-10', texte: 't', cles: [], envoye: NOW - H, vu: NOW - MIN, relances: [] }));
    expect((await vuesQG(kv, NOW)).taches.enAttente).toEqual([]);
  });

  it('faites : vrais agents seulement, 7 derniers jours, plus récentes d\'abord, sans les missions déposées', async () => {
    await entree({ agent: 'L', quand: NOW - 8 * JOUR, texte: 'trop vieux' });
    await entree({ agent: 'clara', quand: NOW - 2 * JOUR, texte: 'mails mis à la corbeille', resultat: '12 mails à la corbeille' });
    await entree({ agent: 'obito', quand: NOW - H, texte: 'pas un vrai agent' });
    await entree({ agent: 'light', quand: NOW - H, texte: 'envoie le relevé sur Telegram' });
    await entree({ agent: 'L', quand: NOW - MIN, type: 'mission', origine: 'moi', texte: 'ma mission' });
    const { taches } = await vuesQG(kv, NOW);
    expect(taches.faites).toEqual([
      { quand: NOW - H, agent: 'light', texte: 'envoie le relevé sur Telegram' },
      { quand: NOW - 2 * JOUR, agent: 'clara', texte: 'mails mis à la corbeille', resultat: '12 mails à la corbeille' },
    ]);
  });

  it('faites : au plus 100 par agent, un agent très actif ne chasse pas les autres', async () => {
    await entree({ agent: 'clara', quand: NOW - 3 * JOUR, texte: 'mails mis à la corbeille' });
    await entree({ agent: 'light', quand: NOW - 2 * JOUR, texte: 'relevé du matin' });
    for (let i = 0; i < 150; i++) await entree({ agent: 'L', quand: NOW - i * MIN });
    const { faites } = (await vuesQG(kv, NOW)).taches;
    expect(faites.filter(f => f.agent === 'L')).toHaveLength(100);
    expect(faites.map(f => f.agent).slice(-2)).toEqual(['light', 'clara']);
    expect(faites).toHaveLength(102);
  });
});

describe('vuesQG · Calendrier', () => {
  // une proposition dont aucun sujet n'est rédigé : la rédaction a du travail
  const proposition = () => kv.hset(CLE_PROPOSITIONS, 'p1', JSON.stringify({
    id: 'p1', semaine: '2026-W46', quand: LUNDI + 7 * H, choix: 0,
    sujets: [0, 1, 2].map(i => ({ titre: `s${i}`, angle: 'a', format: 'texte' })),
  }));
  beforeEach(proposition);

  it('semaine du lundi au dimanche, aujourd\'hui = mardi', async () => {
    const { calendrier } = await vuesQG(kv, NOW);
    expect(calendrier.lundi).toBe(LUNDI);
    expect(calendrier.aujourdhui).toBe(1);
    expect(calendrier.jours).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  });

  it('états des passages : fait (entrée dans les 3 h), raté (1 h passée sans entrée), à venir', async () => {
    const { calendrier, taches } = await vuesQG(kv, NOW);
    const c = calendrier.creneaux;
    // mardi : rédaction de 06:00 et relevé de 08:00 sans aucune entrée → ratés
    expect(creneau(c, 'l-redaction', 1)).toMatchObject({ etat: 'rate', accord: true, quand: LUNDI + JOUR + 6 * H });
    expect(creneau(c, 'light-releve', 1)).toMatchObject({ etat: 'rate', heure: '08:00' });
    expect(creneau(c, 'l-redaction', 3)).toMatchObject({ etat: 'pause' }); // rédaction mise en pause le 10 nov.
    expect(creneau(c, 'light-releve', 2)).toMatchObject({ etat: 'a-venir' });
    expect(taches.alerte).toEqual({ texte: 'Un passage prévu n\'a pas eu lieu (routines bloquées ?)', passages: ['L · 06:00', 'Light · 08:00'] });
  });

  it('pas d\'alerte quand les passages du jour ont eu lieu', async () => {
    await entree({ agent: 'L', quand: LUNDI + JOUR + 6 * H + 20 * MIN, texte: 'rédige : x' });
    await entree({ agent: 'light', quand: LUNDI + JOUR + 8 * H + 2 * MIN, texte: 'relevé du matin' });
    const { calendrier, taches } = await vuesQG(kv, NOW);
    expect(creneau(calendrier.creneaux, 'l-redaction', 1)!.etat).toBe('fait');
    expect(creneau(calendrier.creneaux, 'light-releve', 1)!.etat).toBe('fait');
    expect(taches.alerte).toBeNull();
  });

  it('une entrée d\'un autre agent ou hors fenêtre ne compte pas', async () => {
    await entree({ agent: 'clara', quand: LUNDI + JOUR + 6 * H + MIN, texte: 'rédige : x' });
    await entree({ agent: 'L', quand: LUNDI + 2 * JOUR + 6 * H + MIN, texte: 'rédige : x' }); // le lendemain : ne rattrape pas mardi
    expect(creneau((await vuesQG(kv, NOW)).calendrier.creneaux, 'l-redaction', 1)!.etat).toBe('rate');
  });

  it('un passage commencé il y a moins d\'une heure reste « à venir »', async () => {
    const t = LUNDI + JOUR + 8 * H + 30 * MIN;
    expect(creneau((await vuesQG(kv, t)).calendrier.creneaux, 'light-releve', 1)!.etat).toBe('a-venir');
  });

  it('relances de Light : faites si une relance a eu lieu, sans objet si le relevé a été vu', async () => {
    const lu = Date.UTC(2026, 10, 9);
    await kv.hset(CLES_LIGHT.messages, '2026-11-09', JSON.stringify({ jour: '2026-11-09', texte: 't', cles: [], envoye: lu + 8 * H, relances: [lu + 14 * H + MIN] }));
    await kv.hset(CLES_LIGHT.messages, '2026-11-10', JSON.stringify({ jour: '2026-11-10', texte: 't', cles: [], envoye: NOW - H, vu: NOW - MIN, relances: [] }));
    const c = (await vuesQG(kv, NOW + 10 * H)).calendrier.creneaux; // mardi 20:00
    const relances = c.filter(x => x.routine === 'light-relance');
    expect(relances.every(x => x.conditionnel)).toBe(true);
    expect(relances.find(x => x.jour === 0 && x.heure === '14:00')!.etat).toBe('fait');
    expect(relances.find(x => x.jour === 0 && x.heure === '19:00')!.etat).toBe('rate'); // envoyé, jamais vu
    expect(relances.find(x => x.jour === 1 && x.heure === '14:00')!.etat).toBe('sans-objet');
  });

  it('seule la tâche de la routine compte : la boîte de L ne vaut pas les sujets', async () => {
    // la semaine suivante, routines en service : lundi 16 novembre
    const L2 = LUNDI + 7 * JOUR;
    await entree({ agent: 'L', quand: L2 + 7 * H + 5 * MIN, texte: 'traite la boîte' });
    await entree({ agent: 'light', quand: L2 + 8 * H + 5 * MIN, texte: 'quelque chose d\'autre' });
    let c = (await vuesQG(kv, L2 + 10 * H)).calendrier.creneaux;
    expect(creneau(c, 'l-sujets', 0)!.etat).toBe('rate');
    expect(creneau(c, 'light-releve', 0)!.etat).toBe('rate');
    await entree({ agent: 'L', quand: L2 + 7 * H + 9 * MIN, texte: 'propose 3 sujets' });
    await entree({ agent: 'light', quand: L2 + 8 * H + 9 * MIN, texte: 'termine le rapport du matin' });
    c = (await vuesQG(kv, L2 + 10 * H)).calendrier.creneaux;
    expect(creneau(c, 'l-sujets', 0)).toMatchObject({ heure: '07:00', etat: 'fait', entree: { texte: 'propose 3 sujets' } });
    expect(creneau(c, 'light-releve', 0)).toMatchObject({ etat: 'fait', entree: { texte: 'termine le rapport du matin' } });
  });

  it('avant la mise en service (9 nov. 12:46) : « pas encore actif », jamais raté ni alerte', async () => {
    // lundi 9 : sujets 07:00 et relevé 08:00 avant la mise en service ; relance 14:00 après
    await entree({ agent: 'L', quand: LUNDI + 7 * H + 4 * MIN, texte: 'propose 3 sujets' });
    let v = await vuesQG(kv, LUNDI + 13 * H);
    expect(creneau(v.calendrier.creneaux, 'l-sujets', 0)!.etat).toBe('inactif');
    expect(creneau(v.calendrier.creneaux, 'light-releve', 0)!.etat).toBe('inactif');
    expect(v.taches.alerte).toBeNull();
    v = await vuesQG(kv, NOW);
    expect(creneau(v.calendrier.creneaux, 'light-releve', 0)!.etat).toBe('inactif');
    expect(v.calendrier.creneaux.find(x => x.routine === 'light-relance' && x.jour === 0 && x.heure === '14:00')!.etat).not.toBe('inactif');
  });

  it('rédaction sans sujet à écrire : « rien à faire » (gris), pas d\'alerte pour L', async () => {
    await kv.del(CLE_PROPOSITIONS);
    let v = await vuesQG(kv, NOW);
    expect(creneau(v.calendrier.creneaux, 'l-redaction', 1)!.etat).toBe('rien-a-faire');
    expect(v.taches.alerte!.passages).toEqual(['Light · 08:00']);
    // les trois sujets déjà rédigés
    await proposition();
    for (const i of [0, 1, 2]) {
      await kv.hset(CLE_POSTS, `x${i}`, JSON.stringify({ id: `x${i}`, sujet: 's', texte: 't', hashtags: [], statut: 'en accord', quand: LUNDI, propositionId: 'p1', index: i }));
    }
    v = await vuesQG(kv, NOW);
    expect(creneau(v.calendrier.creneaux, 'l-redaction', 1)!.etat).toBe('rien-a-faire');
    // un seul rédigé : il reste du travail, le passage est raté
    await kv.del(CLE_POSTS);
    await kv.hset(CLE_POSTS, 'x0', JSON.stringify({ id: 'x0', sujet: 's', texte: 't', hashtags: [], statut: 'pret', quand: LUNDI, propositionId: 'p1', index: 0 }));
    expect(creneau((await vuesQG(kv, NOW)).calendrier.creneaux, 'l-redaction', 1)!.etat).toBe('rate');
  });

  it('agents prévus en gris : prevu: true, jamais d\'état', async () => {
    const { calendrier } = await vuesQG(kv, NOW);
    const prevus = calendrier.creneaux.filter(x => x.prevu);
    expect(prevus).toEqual([]);
    expect(prevus.every(x => x.etat === 'prevu')).toBe(true);
    // Mafe a ses vraies routines depuis le 10 novembre
    const mafe = calendrier.creneaux.filter(x => x.agent === 'mafe');
    expect(mafe.every(x => !x.prevu)).toBe(true);
    expect(mafe.filter(x => x.routine === 'mafe-point').map(x => [x.jour, x.heure])).toEqual([0, 1, 2, 3, 4].map(j => [j, '07:30']));
    expect(mafe.filter(x => x.routine === 'mafe-mardi').map(x => [x.jour, x.heure])).toEqual([[1, '10:00']]);
    expect(mafe.filter(x => x.routine === 'mafe-vendredi').map(x => [x.jour, x.heure])).toEqual([[4, '17:00']]);
    expect(mafe.length).toBe(7);
    expect(calendrier.creneaux.filter(x => !x.prevu).every(x => ['L', 'light', 'clara', 'mafe', 'zoro', 'paul', 'ye', 'feu', 'kuroro'].includes(x.agent))).toBe(true);
    expect(calendrier.lignes).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: 'L', prevu: false, texte: expect.stringContaining('toutes les heures') }),
      expect.objectContaining({ agent: 'luffy', prevu: true, texte: 'Luffy : vérifie tes sites toutes les 5 min' }), // pas encore de passage
      expect.objectContaining({ agent: 'isaac', prevu: true, texte: 'Isaac : surveille la place toutes les heures' }), // pas encore de passage
      expect.objectContaining({ agent: 'lea', prevu: true, texte: 'Léa : relit tes pushes toutes les heures' }), // pas encore de passage
      expect.objectContaining({ agent: 'clara', prevu: false }),
    ]));
  });
});

describe('vuesQG · Cerveau', () => {
  it('règles du QG à jour, ce que L et Clara ont retenu, « nouveau » sous 48 h', async () => {
    await kv.hset(CLE_MEMOIRE_L, 'regles', JSON.stringify(['jamais d\'emoji en début de post']));
    await kv.hset(CLE_MEMOIRE_L, 'autorisations', JSON.stringify({ livreo: 'anonyme' }));
    await kv.hset(CLE_MEMOIRE_L, 'publies', JSON.stringify([{ id: 'x', sujet: 's', quand: NOW }]));
    await kv.hset(CLES_CLARA.vip, 'boss@banque.ci', String(NOW));
    await kv.hset(CLES_CLARA.bannis, 'b1', JSON.stringify({ adresse: 'promo@spam.com', depuis: NOW - 10 * H, deplaces: 3, dernierUid: 1 }));
    await kv.hset(CLES_CLARA.bannis, 'b2', JSON.stringify({ adresse: 'vieux@spam.com', depuis: NOW - 3 * JOUR, deplaces: 1, dernierUid: 1 }));
    const { cerveau } = await vuesQG(kv, NOW);
    expect(cerveau.regles.slice(0, REGLES_QG.length)).toEqual(REGLES_QG);
    expect(cerveau.regles.join(' ')).toContain('Telegram');
    expect(cerveau.regles.join(' ')).not.toContain('WhatsApp');
    const phrases = (agent: string) => cerveau.agents.find(a => a.agent === agent)!.phrases;
    // ses leçons sont à part (modifiables dans le Cerveau) ; les phrases ne gardent que les faits
    expect(cerveau.lecons).toEqual(['jamais d\'emoji en début de post']);
    expect(phrases('L')).toEqual(['Ne nomme que : le QG.', '1 post publié.']);
    expect(cerveau.mesRegles).toEqual([]);
    expect(phrases('clara')).toEqual([
      'Protège 1 VIP (boss@banque.ci).',
      'Jette automatiquement les mails de 2 expéditeurs bannis.',
      'Dont 1 nouveau depuis hier.',
    ]);
    expect(cerveau.agents.find(a => a.agent === 'clara')!.nouveau).toBe(true);
    expect(phrases('light')[0]).toMatch(/^Surveille \d+ outils dans tes projets perso\.$/);
    expect(cerveau.agents.map(a => a.ouvre)).toEqual(['bureauL', 'releveLight', 'bureauClara', 'bureauMafe', 'bureauLuffy', 'bureauIsaac', 'bureauZoro', 'bureauLea', 'bureauPaul', 'bureauYe', 'bureauFeu']);
    expect(phrases('mafe')).toEqual(['Pas encore de relevé.']);
    expect(cerveau.agents.find(a => a.agent === 'mafe')).toMatchObject({ nom: 'Mafe', lien: 'Le bureau de Mafe' });
  });

  it('« Mes règles » : celles que j\'ai écrites, dans l\'ordre, toutes les leçons de L', async () => {
    await ajouterRegleQG(kv, 'Toujours en français.', NOW - 2 * H);
    await ajouterRegleQG(kv, 'Rien le dimanche.', NOW - H);
    for (const r of ['a', 'b', 'c', 'd', 'e']) await ajouterRegle(kv, r);
    const { cerveau } = await vuesQG(kv, NOW);
    expect(cerveau.mesRegles.map(r => r.texte)).toEqual(['Toujours en français.', 'Rien le dimanche.']);
    expect(cerveau.lecons).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('Mafe : seul « point du matin » allume le créneau du matin ; ni le relevé ni son erreur ne le font', () => {
    const point = ROUTINES.find(r => r.id === 'mafe-point')!;
    expect(point.motifs).toEqual(['point du matin']);
    const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const tache of ['relevé des projets', 'relevé des projets interrompu', 'relevé rafraîchi depuis le Mac', 'relevé rafraîchi depuis le Mac interrompu', 'point Telegram non envoyé'])
      expect(point.motifs!.some(m => norm(tache).startsWith(m))).toBe(false);
    // mardi et vendredi gardent leur motif Telegram
    expect(ROUTINES.find(r => r.id === 'mafe-mardi')!.motifs).toEqual(['envoie le point sur telegram']);
    expect(ROUTINES.find(r => r.id === 'mafe-vendredi')!.motifs).toEqual(['envoie le point sur telegram']);
  });

  it('Mafe en panne : le reste de la vue répond quand même', async () => {
    const casse: KV = { ...kv, hgetall: async (cle: string) => { if (cle.startsWith('mafe:')) throw new Error('kv'); return kv.hgetall(cle); } };
    const v = await vuesQG(casse, NOW);
    expect(v.cerveau.agents.find(a => a.agent === 'mafe')!.phrases).toEqual(['Pas encore de relevé.']);
  });

  it('Mafe : la phrase du Cerveau suit le dernier relevé ; son journal est visible', async () => {
    const projet = (nom: string) => ({ depot: nom, nom, pousse: '2026-11-09T10:00:00Z', dernierTravail: null, enPause: false, avancement: { genre: 'commits' }, seance: null, commits: [], ouOnSArrete: '' });
    await kv.hset(CLES_MAFE.releves, '2026-11-10', JSON.stringify({
      jour: '2026-11-10', quand: NOW, projets: [projet('QG'), projet('Livreo')], priorite: { depot: 'QG', nom: 'QG', raison: 'urgent' }, aEcrire: [],
    }));
    await entree({ agent: 'mafe', quand: NOW - H, texte: 'point du matin', resultat: '2 projets' });
    const v = await vuesQG(kv, NOW);
    expect(v.cerveau.agents.find(a => a.agent === 'mafe')!.phrases).toEqual(['Suit 2 projets ; commence par QG.']);
    expect(v.taches.faites).toEqual([{ quand: NOW - H, agent: 'mafe', texte: 'point du matin', resultat: '2 projets' }]);
  });

  it('Luffy : phrase du Cerveau et « en attente » suivent les sites en panne', async () => {
    const luffy = () => vuesQG(kv, NOW);
    let v = await luffy();
    expect(v.cerveau.agents.find(a => a.agent === 'luffy')!.phrases).toEqual(['Pas encore de vérification.']); // jamais passé : rien à affirmer
    await kv.hset(CLES_LUFFY.dernier, 'quand', String(NOW - 3 * MIN));
    v = await luffy();
    expect(v.cerveau.agents.find(a => a.agent === 'luffy')).toMatchObject({ nom: 'Luffy', ouvre: 'bureauLuffy', lien: 'Le bureau de Luffy', phrases: ['Surveille 6 sites ; tous en ligne.'] });
    expect(v.taches.enAttente.some(x => x.agent === 'luffy')).toBe(false);
    await kv.hset(CLES_LUFFY.etat, 'boutique', JSON.stringify({ echecs: 2, depuis: NOW - 20 * MIN, annoncee: true, raison: 'erreur 503', vu: NOW }));
    v = await luffy();
    expect(v.cerveau.agents.find(a => a.agent === 'luffy')!.phrases).toEqual(['Surveille 6 sites ; 1 en panne.']);
    expect(v.taches.enAttente.find(x => x.agent === 'luffy')).toEqual({ agent: 'luffy', texte: 'site en panne', nombre: 1, ouvre: 'bureauLuffy' });
    expect(JSON.stringify(v)).not.toContain('503');
    await kv.hset(CLES_LUFFY.etat, 'bella', JSON.stringify({ echecs: 3, depuis: NOW - 15 * MIN, annoncee: true, vu: NOW }));
    v = await luffy();
    expect(v.taches.enAttente.find(x => x.agent === 'luffy')).toEqual({ agent: 'luffy', texte: 'sites en panne', nombre: 2, ouvre: 'bureauLuffy' });
  });

  it('Isaac : phrase du Cerveau, « en attente », rythme et ligne du calendrier suivent le Mac', async () => {
    const GO = 1024 ** 3;
    const isaac = async () => (await vuesQG(kv, NOW)).agents.find(a => a.agent === 'isaac')!;
    const phrases = async () => (await vuesQG(kv, NOW)).cerveau.agents.find(a => a.agent === 'isaac')!.phrases;
    const ligne = async () => (await vuesQG(kv, NOW)).calendrier.lignes.find(l => l.agent === 'isaac')!;
    // jamais passé : rien à affirmer
    expect(await phrases()).toEqual(['Pas encore de passage.']);
    expect(await isaac()).toMatchObject({ statut: 'bloque', note: 'pas encore de passage', dernierPassage: null, prochainPassage: null });
    expect((await isaac()).rythme).toBeUndefined();
    expect(await ligne()).toMatchObject({ prevu: true, texte: 'Isaac : surveille la place toutes les heures' });
    // en ligne
    await kv.hset(CLES_ISAAC.vu, 'relais', String(NOW - 2 * MIN));
    await kv.hset(CLES_ISAAC.place, 'mesure', JSON.stringify({ libre: 26.4 * GO, total: 228 * GO, quand: NOW - 2 * MIN }));
    expect(await phrases()).toEqual(['Ton Mac a 26 Go libres.']);
    expect(await isaac()).toMatchObject({ statut: 'au repos', rythme: 'toutes les heures', prochainPassage: null, dernierPassage: { quand: NOW - 2 * MIN } });
    expect(await ligne()).toMatchObject({ prevu: false, texte: 'Isaac : surveille la place toutes les heures' });
    // propositions à valider (comptées même quand le Mac est éteint : le Oui se donne sur Telegram)
    const p = (id: string, statut: string) => kv.hset(CLES_ISAAC.propositions, id, JSON.stringify({ id, genre: 'cache', libelle: id, taille: GO, impact: 'x', cibles: ['/tmp/x'], statut, quand: NOW }));
    await p('a', 'proposee'); await p('b', 'proposee'); await p('c', 'oui');
    expect(await phrases()).toEqual(['Ton Mac a 26 Go libres ; 2 propositions à valider.']);
    const att = (await vuesQG(kv, NOW)).taches.enAttente.find(x => x.agent === 'isaac');
    expect(att).toEqual({ agent: 'isaac', texte: 'propositions à valider', nombre: 2, ouvre: 'bureauIsaac' });
    // mesure trop vieille alors que le Mac répond : on n'affirme pas
    await kv.hset(CLES_ISAAC.place, 'mesure', JSON.stringify({ libre: 26 * GO, total: 228 * GO, quand: NOW - 5 * H }));
    expect((await phrases())[0]).toBe('Pas de mesure récente ; 2 propositions à valider.');
    // éteint
    await kv.hset(CLES_ISAAC.vu, 'relais', String(NOW - 20 * MIN));
    expect(await phrases()).toEqual(['Le Mac est éteint.']);
    expect(await isaac()).toMatchObject({ statut: 'bloque', note: 'le Mac est éteint' });
    expect((await isaac()).rythme).toBeUndefined();
    expect(await ligne()).toMatchObject({ prevu: true, texte: 'Isaac : le Mac est éteint' });
    expect((await vuesQG(kv, NOW)).taches.enAttente.find(x => x.agent === 'isaac')).toMatchObject({ nombre: 2 });
  });

  it('Luffy : rythme affiché, dernier passage = dernière vérification, phrase honnête s\'il ne passe plus', async () => {
    const luffy = async () => (await vuesQG(kv, NOW)).agents.find(a => a.agent === 'luffy')!;
    const jamais = await luffy();
    expect(jamais).toMatchObject({ statut: 'bloque', note: 'pas encore de vérification', dernierPassage: null });
    expect(jamais.rythme).toBeUndefined();
    await kv.hset(CLES_LUFFY.dernier, 'quand', String(NOW - 2 * MIN));
    expect(await luffy()).toMatchObject({ statut: 'au repos', rythme: 'toutes les 5 min', prochainPassage: null });
    expect((await luffy()).dernierPassage).toEqual({ quand: NOW - 2 * MIN, texte: 'vérifie les sites' });
    const ligne = (v: Awaited<ReturnType<typeof vuesQG>>) => v.calendrier.lignes.find(l => l.agent === 'luffy')!;
    expect(ligne(await vuesQG(kv, NOW))).toMatchObject({ prevu: false, texte: 'Luffy : vérifie tes sites toutes les 5 min' });
    await kv.hset(CLES_LUFFY.dernier, 'quand', String(NOW - 40 * MIN));
    const v = await vuesQG(kv, NOW);
    expect(ligne(v)).toMatchObject({ texte: 'Luffy : ne vérifie plus' });
    expect(v.agents.find(a => a.agent === 'luffy')).toMatchObject({ statut: 'bloque', note: 'ne vérifie plus' });
    expect(v.agents.find(a => a.agent === 'luffy')!.rythme).toBeUndefined();
    await kv.hset(CLES_LUFFY.etat, 'boutique', JSON.stringify({ echecs: 2, depuis: NOW - 50 * MIN, annoncee: true, vu: NOW }));
    expect((await vuesQG(kv, NOW)).taches.enAttente.some(x => x.agent === 'luffy')).toBe(false);
    expect(v.cerveau.agents.find(a => a.agent === 'luffy')!.phrases).toEqual(['Ne vérifie plus.']);
  });

  it('jamais de secret dans la réponse', async () => {
    const secrets = { GMAIL_MOT_DE_PASSE_APPLI: 'mdp-secret-123', TELEGRAM_BOT_TOKEN: 'tok-secret-456', GMAIL_ADRESSE: 'moi-secret@gmail.com' };
    Object.assign(process.env, secrets);
    try {
      const json = JSON.stringify(await vuesQG(kv, NOW));
      for (const s of Object.values(secrets)) expect(json).not.toContain(s);
      expect(json).not.toMatch(/token|mot.de.passe|password/i);
    } finally {
      for (const k of Object.keys(secrets)) delete process.env[k];
    }
  });
});

describe('vuesQG · bruit de l\'installation', () => {
  it('les entrées « TEST » (agent de test du 8 nov.) ne sont ni faites, ni en cours, ni un passage', async () => {
    await entree({ agent: 'L', quand: NOW - 2 * JOUR, texte: 'TEST · vérifie que le branchement fonctionne', resultat: 'Branchement vérifié : la page voit mon état.' });
    await entree({ agent: 'clara', quand: NOW - 2 * JOUR, texte: 'TEST · vérifie que le branchement fonctionne' });
    await entree({ agent: 'paul', quand: NOW - 2 * JOUR, texte: 'TEST · vérifie que le branchement fonctionne' });
    await entree({ agent: 'light', quand: NOW - H, texte: 'relevé du matin' });
    await etat({ agent: 'clara', tache: 'TEST · vérifie que le branchement fonctionne', quand: NOW - MIN });
    const v = await vuesQG(kv, NOW);
    expect(v.taches.faites).toEqual([{ quand: NOW - H, agent: 'light', texte: 'relevé du matin' }]);
    expect(v.taches.enCours).toEqual([]);
    expect(v.agents.find(a => a.agent === 'L')!.dernierPassage).toBeNull();
    expect(v.agents.find(a => a.agent === 'clara')!.statut).toBe('au repos');
  });
});

describe('vuesQG · état de chaque agent réel', () => {
  const proposition = () => kv.hset(CLE_PROPOSITIONS, 'p1', JSON.stringify({
    id: 'p1', semaine: '2026-W46', quand: LUNDI + 7 * H, choix: 0,
    sujets: [0, 1, 2].map(i => ({ titre: `s${i}`, angle: 'a', format: 'texte' })),
  }));
  const agentDe = async (id: string, now = NOW) => (await vuesQG(kv, now)).agents.find(a => a.agent === id)!;

  it('les onze agents réels, dans l\'ordre', async () => {
    expect((await vuesQG(kv, NOW)).agents.map(a => [a.agent, a.nom])).toEqual([['L', 'L'], ['light', 'Light'], ['clara', 'Clara'], ['mafe', 'Mafe'], ['luffy', 'Luffy'], ['isaac', 'Isaac'], ['zoro', 'Zoro'], ['lea', 'Léa'], ['paul', 'Paul'], ['ye', 'Ye'], ['feu', 'Feu']]);
  });

  it('au travail : la tâche en cours', async () => {
    await etat({ agent: 'L', tache: 'traite la boîte', quand: NOW - 5 * MIN });
    expect(await agentDe('L')).toMatchObject({ statut: 'au travail', tache: 'traite la boîte' });
  });

  it('l’outil de la tâche en cours : celui déclaré, sinon Claude pour les routines (L, Light, Mafe), sinon aucun', async () => {
    await etat({ agent: 'L', tache: 'traite la boîte', quand: NOW - 5 * MIN });
    await etat({ agent: 'light', tache: 'lit le relevé', outil: 'GH', quand: NOW - 5 * MIN });
    await etat({ agent: 'isaac', tache: 'mission prise', outil: 'Mac', quand: NOW - 5 * MIN });
    await etat({ agent: 'clara', tache: 'trie', quand: NOW - 5 * MIN });
    expect(await agentDe('L')).toMatchObject({ outil: 'C' });
    expect(await agentDe('light')).toMatchObject({ outil: 'GH' });
    expect(await agentDe('isaac')).toMatchObject({ outil: 'Mac' });
    expect((await agentDe('clara')).outil).toBeUndefined();
    await etat({ agent: 'mafe', statut: 'termine', tache: 'range 1 note dans Obsidian', outil: 'Ob', quand: NOW - MIN });
    expect((await agentDe('mafe')).outil).toBeUndefined(); // pas en tâche : rien d'allumé
  });

  it('bloqué : le dernier passage prévu du jour est raté ; au repos sinon', async () => {
    await proposition();
    // mardi 10:00 : rédaction de L (06:00) et relevé de Light (08:00) sans trace
    expect((await agentDe('L')).statut).toBe('bloque');
    expect((await agentDe('light')).statut).toBe('bloque');
    await entree({ agent: 'light', quand: LUNDI + JOUR + 8 * H + 3 * MIN, texte: 'relevé du matin' });
    expect((await agentDe('light')).statut).toBe('au repos');
    // un passage commencé il y a moins d'une heure n'est pas encore raté
    expect((await agentDe('light', LUNDI + JOUR + 8 * H + 30 * MIN)).statut).toBe('au repos');
  });

  it('pas bloqué par une routine mise en pause depuis : le créneau raté reste dans le Calendrier', async () => {
    await proposition();
    await entree({ agent: 'light', quand: LUNDI + JOUR + 8 * H + 3 * MIN, texte: 'relevé du matin' });
    // mardi 12:05 : la rédaction de 06:00 est ratée, puis mise en pause à 11:49
    const apres = Date.UTC(2026, 10, 10, 12, 5);
    const v = await vuesQG(kv, apres);
    expect(creneau(v.calendrier.creneaux, 'l-redaction', 1)?.etat).toBe('rate');
    expect(v.agents.find(a => a.agent === 'L')!.statut).toBe('au repos');
    // avant la pause, le même passage raté bloquait L
    expect((await agentDe('L')).statut).toBe('bloque');
  });

  it('pas bloqué quand la rédaction n\'avait rien à écrire, ni pour une relance conditionnelle', async () => {
    expect((await agentDe('L')).statut).toBe('au repos'); // aucune proposition : rien à rédiger
    await entree({ agent: 'light', quand: LUNDI + JOUR + 8 * H + 3 * MIN, texte: 'relevé du matin' });
    await kv.hset(CLES_LIGHT.messages, '2026-11-10', JSON.stringify({ jour: '2026-11-10', texte: 't', cles: [], envoye: LUNDI + JOUR + 8 * H, relances: [] }));
    // mardi 20:00 : la relance de 19:00 est « ratée » mais conditionnelle, le passage du matin a eu lieu
    expect((await agentDe('light', LUNDI + JOUR + 20 * H)).statut).toBe('au repos');
  });

  it('au travail l\'emporte sur bloqué', async () => {
    await proposition();
    await etat({ agent: 'light', tache: 'relevé du matin', quand: NOW - MIN });
    expect((await agentDe('light')).statut).toBe('au travail');
  });

  it('dernier passage : la dernière entrée de l\'agent dans le journal, même ancienne', async () => {
    await entree({ agent: 'L', quand: NOW - 9 * JOUR, texte: 'propose 3 sujets' });
    await entree({ agent: 'L', quand: NOW - 2 * H, type: 'mission', origine: 'moi', texte: 'ma mission' });
    expect((await agentDe('L')).dernierPassage).toEqual({ quand: NOW - 9 * JOUR, texte: 'propose 3 sujets' });
    expect((await agentDe('light')).dernierPassage).toBeNull();
  });

  it('prochain passage : le prochain créneau des routines (les relances conditionnelles ne comptent pas)', async () => {
    // mardi 10:00 → L : la rédaction est en pause, prochain passage = sujets du lundi suivant ; Light mercredi 08:00
    expect((await agentDe('L')).prochainPassage).toEqual({ quand: LUNDI + 7 * JOUR + 7 * H, titre: 'Propose 3 sujets de la semaine' });
    expect((await agentDe('light')).prochainPassage).toEqual({ quand: LUNDI + 2 * JOUR + 8 * H, titre: 'Relevé des versions' });
    // mardi 07:00 → L 06:00 est passé, Light aujourd'hui 08:00
    expect((await agentDe('light', LUNDI + JOUR + 7 * H)).prochainPassage!.quand).toBe(LUNDI + JOUR + 8 * H);
  });

  it('prochain passage : passe à la semaine suivante le dimanche soir', async () => {
    const dimanche = LUNDI + 6 * JOUR + 20 * H;
    expect((await agentDe('L', dimanche)).prochainPassage).toEqual({ quand: LUNDI + 7 * JOUR + 7 * H, titre: 'Propose 3 sujets de la semaine' });
    expect((await agentDe('light', dimanche)).prochainPassage!.quand).toBe(LUNDI + 7 * JOUR + 8 * H);
  });

  it('Clara a ses routines : prochain ménage à 9 h, après son activation', async () => {
    const c = await agentDe('clara');
    expect(c.surDemande).toBeUndefined();
    expect(c.prochainPassage).toEqual({ quand: Date.UTC(2026, 10, 11, 9, 0), titre: 'Propose de nouveaux expéditeurs à nettoyer' });
  });
});

describe('vuesQG · faites sans les débuts de tâche', () => {
  it('Clara : seules les fins (avec résultat) et les erreurs restent ; les débuts suivis d\'une fin sous 10 min disparaissent', async () => {
    const t = NOW - 3 * H;
    const seq: [number, string, string, string?][] = [
      [0, 'au travail', 'compte les mails par expéditeur'],
      [2 * MIN, 'termine', 'statistiques avancées'],
      [5 * MIN, 'au travail', 'prépare des questions'],
      [6 * MIN, 'termine', 'questions posées'],
      [20 * MIN, 'au travail', 'met des mails à la corbeille'],
      [21 * MIN, 'termine', 'mails mis à la corbeille', '172 mails à la corbeille'],
      [30 * MIN, 'au travail', 'met des mails à la corbeille'],
      [31 * MIN, 'erreur', 'mise à la corbeille interrompue'],
      [50 * MIN, 'au travail', 'met des mails à la corbeille'], // pas de fin : reste visible
    ];
    for (const [d, statut, texte, resultat] of seq) {
      await kv.lpush(CLES.journal, JSON.stringify({ quand: t + d, agent: 'clara', type: 'etat', statut, texte, origine: 'agent', ...(resultat ? { resultat } : {}) }));
    }
    const { faites } = (await vuesQG(kv, NOW)).taches;
    expect(faites.map(f => [f.texte, f.resultat, f.erreur])).toEqual([
      ['met des mails à la corbeille', undefined, undefined],
      ['mise à la corbeille interrompue', undefined, true],
      ['mails mis à la corbeille', '172 mails à la corbeille', undefined],
      ['questions posées', undefined, undefined],
      ['statistiques avancées', undefined, undefined],
    ]);
  });

  it('anciennes entrées sans statut : les débuts connus de Clara et Light sont reconnus ; L (toujours « au travail ») reste', async () => {
    const t = NOW - 3 * H;
    await entree({ agent: 'clara', quand: t, texte: 'met des mails à la corbeille' });
    await entree({ agent: 'clara', quand: t + MIN, texte: 'mails mis à la corbeille', resultat: '3 mails à la corbeille' });
    await entree({ agent: 'light', quand: t, texte: 'relevé du matin' });
    await entree({ agent: 'light', quand: t + 2 * MIN, texte: 'envoie le relevé sur Telegram' });
    await entree({ agent: 'L', quand: t, texte: 'traite la boîte' });
    await entree({ agent: 'L', quand: t + MIN, texte: 'met sa mémoire à jour' });
    const textes = (await vuesQG(kv, NOW)).taches.faites.map(f => f.texte).sort();
    expect(textes).toEqual(['envoie le relevé sur Telegram', 'mails mis à la corbeille', 'met sa mémoire à jour', 'traite la boîte']);
  });
});

describe('pause de L · rédaction', () => {
  it('les passages après la pause sont « en pause », jamais « raté », et ne comptent pas comme prochain passage', async () => {
    const { vuesQG, PAUSE_L_REDACTION } = await import('./vues');
    const { memoire } = await import('./memoire');
    const jeudi = Date.UTC(2026, 10, 12, 9, 0);
    const v = await vuesQG(memoire(), jeudi);
    const c = v.calendrier.creneaux.find((x: { routine: string; jour: number }) => x.routine === 'l-redaction' && x.jour === 3);
    expect(c?.etat).toBe('pause');
    expect(PAUSE_L_REDACTION).toBeLessThan(jeudi);
  });
  it('après la reprise du 14 novembre, la rédaction repasse normalement : ni « en pause », ni cachée', async () => {
    const { vuesQG, REPRISE_L_REDACTION, routineEnPause, ROUTINES } = await import('./vues');
    const { memoire } = await import('./memoire');
    const r = ROUTINES.find(x => x.id === 'l-redaction')!;
    expect(routineEnPause(r, Date.UTC(2026, 10, 12, 6))).toBe(true);
    expect(routineEnPause(r, REPRISE_L_REDACTION)).toBe(false);
    const mardi = Date.UTC(2026, 10, 17, 9, 0);
    const v = await vuesQG(memoire(), mardi);
    const c = v.calendrier.creneaux.find((x: { routine: string; jour: number }) => x.routine === 'l-redaction' && x.jour === 1);
    expect(c?.etat).not.toBe('pause');
  });
});

describe('bandeau rouge', () => {
  it('un passage rattrapé plus tard le même jour compte comme fait ; une routine en pause ne déclenche pas le bandeau', async () => {
    const { vuesQG } = await import('./vues');
    const { memoire } = await import('./memoire');
    const { ecrireEtat } = await import('./qg');
    const kv = memoire();
    const t = Date.UTC(2026, 10, 10, 11, 42); // mardi : Light relancé à la main à 11:42, L 06:00 raté puis mis en pause à 11:49
    await ecrireEtat(kv, { agent: 'light', statut: 'termine', tache: 'termine le rapport du matin' }, t);
    const v = await vuesQG(kv, Date.UTC(2026, 10, 10, 12, 5));
    const releve = v.calendrier.creneaux.find((x: { routine: string; jour: number }) => x.routine === 'light-releve' && x.jour === 1);
    expect(releve?.etat).toBe('fait');
    expect(v.taches.alerte).toBeNull();
  });
});

describe('vuesQG · la nuit', () => {
  it('luffyVeille : vrai seulement si Luffy a vérifié depuis moins de 20 min', async () => {
    expect((await vuesQG(kv, NOW)).luffyVeille).toBe(false);
    await kv.hset(CLES_LUFFY.dernier, 'quand', String(NOW - 3 * MIN));
    expect((await vuesQG(kv, NOW)).luffyVeille).toBe(true);
    await kv.hset(CLES_LUFFY.dernier, 'quand', String(NOW - 25 * MIN));
    expect((await vuesQG(kv, NOW)).luffyVeille).toBe(false);
  });
  it('presences : Stalker tant que Claude Code a donné signe depuis moins de 15 min, et seulement s\'il est actif', async () => {
    expect((await vuesQG(kv, NOW)).presences).toEqual([]);
    await kv.hset(CLE_PRESENCE('stalker'), 'actif', '1');
    await kv.hset(CLE_PRESENCE('stalker'), 'quand', String(NOW - 5 * MIN));
    expect((await vuesQG(kv, NOW)).presences).toEqual(['stalker']);
    expect((await vuesQG(kv, NOW + 11 * MIN)).presences).toEqual([]);
    await kv.hset(CLE_PRESENCE('stalker'), 'actif', '0');
    expect((await vuesQG(kv, NOW)).presences).toEqual([]);
    // Stalker n'est pas un agent à routines : aucune fiche ni créneau à son nom
    const v = await vuesQG(kv, NOW);
    expect(v.agents.some(a => a.agent === 'stalker')).toBe(false);
    expect(v.calendrier.creneaux.some(c => c.agent === 'stalker')).toBe(false);
  });
});

describe('vuesQG · astreinte', () => {
  it('expose l\'agent d\'astreinte de cette nuit (mardi 10 novembre 2026 : Mafe) et le planning de la semaine', async () => {
    const v = await vuesQG(kv, NOW);
    expect(v.astreinte).toBe('mafe');
    expect(v.planningAstreinte).toEqual([
      { jour: '2026-11-09', agent: 'clara' }, { jour: '2026-11-10', agent: 'mafe' }, { jour: '2026-11-11', agent: 'isaac' },
      { jour: '2026-11-12', agent: 'L' }, { jour: '2026-11-13', agent: 'light' }, { jour: '2026-11-14', agent: 'clara' }, { jour: '2026-11-15', agent: 'mafe' },
    ]);
    expect(v.calendrier.nuits.map(n => n.nom)).toEqual(['Clara', 'Mafe', 'Isaac', 'L', 'Light', 'Clara', 'Mafe']);
  });
  it('de 00:00 à 06:59 UTC, c\'est encore la nuit de la veille', async () => {
    expect((await vuesQG(kv, Date.UTC(2026, 10, 11, 3))).astreinte).toBe('mafe');
    expect((await vuesQG(kv, Date.UTC(2026, 10, 11, 20))).astreinte).toBe('isaac');
  });
  it('écrit une seule entrée de Kuroro par semaine, sans fausser Tâches / Calendrier', async () => {
    const avant = await vuesQG(kv, NOW);
    await vuesQG(kv, NOW + H);
    const v = await vuesQG(kv, NOW + 2 * H);
    const j = (await kv.lrange(CLES.journal, 0, -1)).map(x => JSON.parse(x) as Entree).filter(e => e.agent === 'kuroro');
    expect(j).toHaveLength(1);
    expect(j[0].texte).toBe('Planning des astreintes, à tour de rôle : lun Clara, mar Mafe, mer Isaac, jeu L, ven Light, sam Clara, dim Mafe');
    expect(v.taches.faites.some(f => f.agent === 'kuroro')).toBe(false);
    expect(v.agents.map(a => a.agent)).not.toContain('kuroro');
    expect(v.taches.enCours).toEqual(avant.taches.enCours);
    expect(v.cerveau.nuit).toBe('Cette nuit, Mafe est d\'astreinte.');
    // une information, pas une règle
    expect(v.cerveau.regles).toEqual(REGLES_QG);
    // semaine suivante : une nouvelle entrée, un autre agent
    const suivante = await vuesQG(kv, NOW + 7 * JOUR);
    const j2 = (await kv.lrange(CLES.journal, 0, -1)).map(x => JSON.parse(x) as Entree).filter(e => e.agent === 'kuroro');
    expect(j2).toHaveLength(2);
    expect(suivante.astreinte).toBe('L');
  });
});

describe('vuesQG · Zoro', () => {
  const LUNDI16 = Date.UTC(2026, 10, 16);
  const tourStocke = (o: object) => kv.hset(CLES_ZORO.tour, 'json', JSON.stringify({ quand: NOW, type: 'tour', projets: [], nonLus: [], cles: [], mac: null, macVieux: false, importants: [], ...o }));
  const phrasesZoro = async () => (await vuesQG(kv, NOW)).cerveau.agents.find(a => a.agent === 'zoro')!;

  it('zoro est un vrai agent ; sa routine du mardi 09:00 n\'est plus « prévue »', async () => {
    const v = await vuesQG(kv, NOW);
    expect(v.agents.map(a => a.agent)).toContain('zoro');
    const r = ROUTINES.find(x => x.id === 'zoro-securite')!;
    expect(r).toMatchObject({ agent: 'zoro', titre: 'Tour de sécurité', jours: [1], heures: ['09:00'], motifs: ['fait le tour de securite'], actif: ACTIVATION_ZORO });
    expect(ACTIVATION_ZORO).toBe(Date.UTC(2026, 10, 11, 13, 21));
    const c = creneau(v.calendrier.creneaux, 'zoro-securite', 1)!;
    expect(c.prevu).toBeUndefined();
    expect(c.etat).toBe('inactif'); // avant l'activation : jamais « raté »
  });
  it('après l\'activation, un tour non fait le mardi est raté, un tour fait compte', async () => {
    const mardi = Date.UTC(2026, 10, 17, 11, 0);
    expect(creneau((await vuesQG(kv, mardi)).calendrier.creneaux, 'zoro-securite', 1)!.etat).toBe('rate');
    await entree({ agent: 'zoro', quand: Date.UTC(2026, 10, 17, 9, 1), texte: 'fait le tour de sécurité', resultat: 'rien d\'important' });
    expect(creneau((await vuesQG(kv, mardi)).calendrier.creneaux, 'zoro-securite', 1)!.etat).toBe('fait');
    expect(LUNDI16).toBeLessThan(mardi);
  });
  it('Cerveau : « Pas encore de tour. », puis les comptes, puis « Rien d\'important au dernier tour. »', async () => {
    const carte = await phrasesZoro();
    expect(carte).toMatchObject({ nom: 'Zoro', ouvre: 'bureauZoro', lien: 'Le bureau de Zoro', phrases: ['Pas encore de tour.'] });
    const f = (g: string) => ({ id: 'G', paquet: 'p', version: '1', gravite: g, corrigeeEn: null, directeProd: true, resume: 'r' });
    const ok = { etat: 'vert', passages: 1, echecs: 0 };
    await tourStocke({ projets: [{ depot: 'a', pousse: 0, failles: [f('haute'), f('critique')], ci: ok }, { depot: 'b', pousse: 0, failles: [], ci: { etat: 'rouge', depuis: 1, passages: 1, echecs: 1 } }] });
    expect((await phrasesZoro()).phrases).toEqual(['2 failles critiques ou hautes, 1 projet en rouge.']);
    await tourStocke({ projets: [{ depot: 'a', pousse: 0, failles: [], ci: ok }] });
    expect((await phrasesZoro()).phrases).toEqual(['Rien d\'important au dernier tour.']);
    await tourStocke({ projets: [{ depot: 'a', pousse: 0, failles: [], ci: ok }], nonLus: ['GitHub'] });
    expect((await phrasesZoro()).phrases.join(' ')).not.toContain('Rien d\'important');
  });
  it('Zoro n\'est pas dans la rotation des astreintes', async () => {
    const v = await vuesQG(kv, NOW);
    expect(v.calendrier.nuits.map(n => n.agent)).not.toContain('zoro');
  });
});

describe('vuesQG · Léa', () => {
  const H3 = 3 * H;
  const passage = (quand: number) => kv.hset(CLES_LEA.passage, 'quand', String(quand));
  const constat = (o: object = {}) => {
    const c = { id: 'ia|L1|00', depot: 'a', sha: 's', message: 'm', fichier: 'f', ligne: 1, gravite: 'grave', quoi: 'q', conseil: 'c', source: 'lea', quand: NOW, statut: 'ouvert', ...o } as { id: string };
    return kv.hset(CLES_LEA.constats, c.id, JSON.stringify(c));
  };
  const agentLea = async () => (await vuesQG(kv, NOW)).agents.find(a => a.agent === 'lea')!;
  const carteLea = async () => (await vuesQG(kv, NOW)).cerveau.agents.find(a => a.agent === 'lea')!;
  const ligneLea = async () => (await vuesQG(kv, NOW)).calendrier.lignes.find(l => l.agent === 'lea')!;

  it('lea est un vrai agent, sans créneau fixe ni prévu', async () => {
    const v = await vuesQG(kv, NOW);
    expect(v.agents.map(a => a.agent)).toContain('lea');
    expect(v.calendrier.creneaux.filter(x => x.agent === 'lea')).toEqual([]);
    expect(PREVUS.some(r => r.agent === 'lea')).toBe(false);
  });
  it('avant tout passage : bloquée, « pas encore de relecture », ligne encore prévue', async () => {
    expect(await agentLea()).toMatchObject({ statut: 'bloque', note: 'pas encore de relecture', dernierPassage: null, prochainPassage: null });
    expect((await agentLea()).rythme).toBeUndefined();
    expect(await ligneLea()).toMatchObject({ prevu: true, texte: 'Léa : relit tes pushes toutes les heures' });
    expect((await carteLea()).phrases).toEqual(['Pas encore de relecture.']);
  });
  it('passage de moins de 3 h : en service, rythme toutes les heures, ligne réelle', async () => {
    await passage(NOW - 2 * H);
    expect(await agentLea()).toMatchObject({ statut: 'au repos', rythme: 'toutes les heures', dernierPassage: { quand: NOW - 2 * H } });
    expect((await agentLea()).note).toBeUndefined();
    expect(await ligneLea()).toMatchObject({ prevu: false, texte: 'Léa : relit tes pushes toutes les heures' });
    // premier passage : les marque-pages sont posés, rien n'a encore été relu (I3)
    expect((await carteLea()).phrases).toEqual(['Pas encore de relecture.']);
    await kv.lpush(CLES_LEA.relectures, JSON.stringify({ depot: 'a', quand: NOW - 2 * H, commits: [], enPartie: [], clesNonVerifiees: [], rienACoder: 0 }));
    expect((await carteLea()).phrases).toEqual(['Rien à signaler sur les pushes relus.']);
  });
  it('après 3 h sans passage complet : bloquée, « n\'est pas passée depuis … », ligne dite', async () => {
    await passage(NOW - H3 - 2 * H);
    expect(await agentLea()).toMatchObject({ statut: 'bloque', note: 'n\'est pas passée depuis 5 h' });
    expect((await agentLea()).rythme).toBeUndefined();
    expect(await ligneLea()).toMatchObject({ prevu: true, texte: 'Léa : n\'est pas passée depuis 5 h' });
    expect((await carteLea()).phrases).toEqual(['N\'est pas passée depuis 5 h.']);
  });
  it('essai raté récent : la note et la ligne disent ce qui n\'a pas marché, pas « n\'est pas passée depuis »', async () => {
    await passage(NOW - H3 - 2 * H);
    await kv.hset(CLES_LEA.tentative, 'json', JSON.stringify({ quand: NOW - 10 * MIN, issue: 'projets illisibles', nonLus: 2, depots: ['app_livraison', 'qg'] }));
    expect(await agentLea()).toMatchObject({ statut: 'bloque', note: 'n\'a pas pu lire 2 projets : app_livraison, qg' });
    expect(await ligneLea()).toMatchObject({ texte: 'Léa : n\'a pas pu lire 2 projets : app_livraison, qg' });
    expect((await carteLea()).phrases).toEqual(['N\'a pas pu lire 2 projets : app_livraison, qg.']);
    await kv.hset(CLES_LEA.tentative, 'json', JSON.stringify({ quand: NOW - 10 * MIN, issue: 'lot remis sans rapport', nonLus: 1, depots: ['qg'] }));
    expect(await agentLea()).toMatchObject({ note: 'lot remis sans rapport' });
    // essai raté ancien : retour à « n'est pas passée depuis »
    await kv.hset(CLES_LEA.tentative, 'json', JSON.stringify({ quand: NOW - 4 * H, issue: 'lot remis sans rapport', nonLus: 1, depots: ['qg'] }));
    expect(await agentLea()).toMatchObject({ note: 'n\'est pas passée depuis 5 h' });
  });
  it('au travail : sa tâche et l\'outil GitHub', async () => {
    await passage(NOW - H);
    await etat({ agent: 'lea', tache: 'relit les pushes', outil: 'GH', quand: NOW - MIN });
    expect(await agentLea()).toMatchObject({ statut: 'au travail', tache: 'relit les pushes', outil: 'GH' });
  });
  it('Cerveau : la carte ouvre son bureau ; « en attente de toi » compte les graves ouverts', async () => {
    await passage(NOW - H);
    await constat({ id: 'ia|L1|00' });
    await constat({ id: 'ia|L1|01' });
    await constat({ id: 'ia|L1|02', statut: 'vu' });
    await constat({ id: 'ia|L1|03', gravite: 'moyen' });
    expect(await carteLea()).toMatchObject({ nom: 'Léa', ouvre: 'bureauLea', lien: 'Le bureau de Léa', phrases: ['2 points graves à corriger. 1 point moyen à regarder.'] });
    expect((await vuesQG(kv, NOW)).taches.enAttente).toContainEqual({ agent: 'lea', texte: 'points graves à corriger', nombre: 2, ouvre: 'bureauLea' });
    await constat({ id: 'ia|L1|00', statut: 'vu' });
    await constat({ id: 'ia|L1|01', statut: 'vu' });
    expect((await vuesQG(kv, NOW)).taches.enAttente.some(e => e.agent === 'lea')).toBe(false);
  });
  it('un seul point grave : singulier', async () => {
    await passage(NOW - H);
    await constat();
    expect((await vuesQG(kv, NOW)).taches.enAttente).toContainEqual({ agent: 'lea', texte: 'point grave à corriger', nombre: 1, ouvre: 'bureauLea' });
  });
  it('Léa n\'est pas dans la rotation des astreintes', async () => {
    expect((await vuesQG(kv, NOW)).calendrier.nuits.map(n => n.agent)).not.toContain('lea');
  });
});

describe('vuesQG · Ye', () => {
  const prop = (o: object = {}) => ({ id: 'abcdef0123', lot: 'L', ficheId: 'f', rev: 'r', titre: 'Boutique Shop', depot: 'mon-compte/shop', set: { kind: 'x' }, changements: [], raisons: [], quand: NOW, statut: 'attente', ...o });
  it('ye est une vraie agente ; « Fiche portfolio » le vendredi 17:30 n\'est plus « prévu »', async () => {
    const v = await vuesQG(kv, NOW);
    expect(v.agents.find(a => a.agent === 'ye')).toMatchObject({ nom: 'Ye', statut: 'au repos', prochainPassage: { titre: 'Fiche portfolio' } });
    const r = ROUTINES.find(x => x.id === 'ye-portfolio')!;
    expect(r).toMatchObject({ agent: 'ye', titre: 'Fiche portfolio', jours: [4], heures: ['17:30'], motifs: ['a compare la semaine'], actif: ACTIVATION_YE });
    const c = creneau(v.calendrier.creneaux, 'ye-portfolio', 4)!;
    expect(c.prevu).toBeUndefined();
  });
  it('en tâche avec Sanity allumé ; en attente : fiches à valider et questions ; carte du Cerveau ; dernier passage = son passage', async () => {
    await etat({ agent: 'ye', tache: 'compare la semaine de 2 fiches', outil: 'Sa', quand: NOW - MIN });
    await kv.hset(CLES_YE.propositions, 'abcdef0123', JSON.stringify(prop()));
    await kv.hset(CLES_YE.questions, 'abcdef0124', JSON.stringify({ id: 'abcdef0124', techno: 'Payload', cle: 'payload', titre: 'T', source: 'package.json', quand: NOW, statut: 'attente' }));
    await kv.hset(CLES_YE.passage, 'json', JSON.stringify({ quand: NOW - 2 * H, relus: 2, propositions: 1, questions: 1, refusees: 0, illisibles: [], sansLien: 0 }));
    const v = await vuesQG(kv, NOW);
    expect(v.taches.enCours).toContainEqual({ agent: 'ye', tache: 'compare la semaine de 2 fiches', depuis: NOW - MIN, outil: 'Sa' });
    expect(v.taches.enAttente).toContainEqual({ agent: 'ye', texte: 'fiche à valider', nombre: 1, ouvre: 'bureauYe' });
    expect(v.taches.enAttente).toContainEqual({ agent: 'ye', texte: 'question de compétence', nombre: 1, ouvre: 'bureauYe' });
    expect(v.cerveau.agents.find(a => a.agent === 'ye')).toEqual({ agent: 'ye', nom: 'Ye', ouvre: 'bureauYe', lien: 'Le bureau de Ye', phrases: ['1 fiche attend ton Valider. 1 question de compétence.'] });
    expect(v.agents.find(a => a.agent === 'ye')!.dernierPassage).toEqual({ quand: NOW - 2 * H, texte: 'a comparé la semaine' });
  });
});

describe('vuesQG · Kuroro, le compte rendu du matin', () => {
  it('un créneau chaque jour à 08:15 ; « pas encore actif » avant la mise en service, jamais raté', async () => {
    const r = ROUTINES.find(x => x.id === 'kuroro-matin')!;
    expect(r).toMatchObject({ agent: 'kuroro', titre: 'Compte rendu du matin', jours: [0, 1, 2, 3, 4, 5, 6], heures: ['08:15'], motifs: ['a envoye le compte rendu du matin'], actif: ACTIVATION_MATIN });
    const v = await vuesQG(kv, NOW);
    const c = creneau(v.calendrier.creneaux, 'kuroro-matin', 1)!;
    expect(c).toMatchObject({ nom: 'Kuroro', heure: '08:15', etat: 'inactif' });
    expect(v.taches.alerte?.passages ?? []).not.toContain('Kuroro · 08:15');
    // Kuroro n'a pas de fiche : il n'est pas un agent réel
    expect(v.agents.some(a => a.agent === 'kuroro')).toBe(false);
    expect(v.cerveau.agents.some(a => a.agent === 'kuroro')).toBe(false);
  });
  it('après la mise en service : fait quand le journal note l\'envoi, raté sinon (et le bandeau le dit)', async () => {
    const jour = Date.UTC(2026, 10, 16, 8, 15); // lundi 16 novembre
    const fait = await (async () => {
      await entree({ agent: 'kuroro', quand: jour + 2_000, statut: 'termine', texte: 'a envoyé le compte rendu du matin' });
      return vuesQG(kv, jour + 2 * H);
    })();
    expect(creneau(fait.calendrier.creneaux, 'kuroro-matin', 0)!.etat).toBe('fait');
    kv = memoire();
    const rate = await vuesQG(kv, jour + 2 * H);
    expect(creneau(rate.calendrier.creneaux, 'kuroro-matin', 0)!.etat).toBe('rate');
    expect(rate.taches.alerte!.passages).toContain('Kuroro · 08:15');
  });
});

describe('vuesQG · Paul', () => {
  const prop = (o: object = {}) => ({ id: 'abcdef0123', lot: 'L', depot: 'mon-compte/qg', branche: 'main', fichier: 'README.md', base: 'b', contenu: 'x', raisons: [], diff: [], ajoutees: 1, retirees: 0, quand: NOW, statut: 'attente', ...o });

  it('paul est un vrai agent ; sa routine du jeudi 18:00 n\'est plus « prévue » ; le premier créneau compté est celui de la mise en service', async () => {
    const v = await vuesQG(kv, NOW);
    expect(v.agents.find(a => a.agent === 'paul')).toMatchObject({ nom: 'Paul', statut: 'au repos', prochainPassage: { titre: 'README et CLAUDE.md' } });
    const r = ROUTINES.find(x => x.id === 'paul-readme')!;
    expect(r).toMatchObject({ agent: 'paul', titre: 'README et CLAUDE.md', jours: [3], heures: ['18:00'], motifs: ['a relu la semaine'], actif: ACTIVATION_PAUL });
    expect(PREVUS.some(x => x.agent === 'paul')).toBe(false);
    const c = creneau(v.calendrier.creneaux, 'paul-readme', 3)!;
    expect(c.prevu).toBeUndefined();
    expect(c.nom).toBe('Paul');
    expect(c.quand).toBe(Date.UTC(2026, 10, 12, 18, 0)); // le premier jeudi après la mise en service (00:31)
    expect(c.quand).toBeGreaterThan(ACTIVATION_PAUL);
    expect(c.etat).toBe('a-venir');
  });
  it('après la mise en service, un jeudi sans passage est raté, un passage fait compte', async () => {
    const jeudi = Date.UTC(2026, 10, 19, 20, 0);
    expect(creneau((await vuesQG(kv, jeudi)).calendrier.creneaux, 'paul-readme', 3)!.etat).toBe('rate');
    await entree({ agent: 'paul', quand: Date.UTC(2026, 10, 19, 18, 4), texte: 'a relu la semaine : 2 propositions (1 projet)', statut: 'termine' });
    expect(creneau((await vuesQG(kv, jeudi)).calendrier.creneaux, 'paul-readme', 3)!.etat).toBe('fait');
  });
  it('en tâche pendant la préparation, avec GitHub allumé ; en attente : ses propositions à valider ; sa carte du Cerveau', async () => {
    await etat({ agent: 'paul', tache: 'relit la semaine de 3 projets', outil: 'GH', quand: NOW - MIN });
    await kv.hset(CLES_PAUL.propositions, 'abcdef0123', JSON.stringify(prop()));
    await kv.hset(CLES_PAUL.propositions, 'abcdef0124', JSON.stringify(prop({ id: 'abcdef0124', fichier: 'CLAUDE.md' })));
    const v = await vuesQG(kv, NOW);
    expect(v.taches.enCours).toContainEqual({ agent: 'paul', tache: 'relit la semaine de 3 projets', depuis: NOW - MIN, outil: 'GH' });
    expect(v.agents.find(a => a.agent === 'paul')).toMatchObject({ statut: 'au travail', outil: 'GH' });
    expect(v.taches.enAttente).toContainEqual({ agent: 'paul', texte: 'propositions à valider', nombre: 2, ouvre: 'bureauPaul' });
    expect(v.cerveau.agents.find(a => a.agent === 'paul')).toEqual({ agent: 'paul', nom: 'Paul', ouvre: 'bureauPaul', lien: 'Le bureau de Paul', phrases: ['2 propositions attendent ton Valider.'] });
  });
  it('en-tête du bureau : son dernier passage vient de son passage hebdomadaire (une seule source), pas d\'un clic', async () => {
    expect((await vuesQG(kv, NOW)).agents.find(a => a.agent === 'paul')!.dernierPassage).toBeNull();
    await kv.hset(CLES_PAUL.passage, 'json', JSON.stringify({ quand: NOW - 2 * H, relus: 4, propositions: 2, refusees: 0, illisibles: [] }));
    await entree({ agent: 'paul', quand: NOW - H, texte: 'a mis à jour README.md de qg', statut: 'termine' });
    expect((await vuesQG(kv, NOW)).agents.find(a => a.agent === 'paul')!.dernierPassage).toEqual({ quand: NOW - 2 * H, texte: 'a relu la semaine' });
    await kv.hset(CLES_PAUL.passage, 'json', JSON.stringify({ quand: NOW - 2 * H, relus: 4, propositions: 2, refusees: 0, illisibles: ['qg'] }));
    expect((await vuesQG(kv, NOW)).agents.find(a => a.agent === 'paul')!.dernierPassage).toEqual({ quand: NOW - 2 * H, texte: 'a relu la semaine en partie' });
  });
  it('Cerveau : « Pas encore de passage. » tant que Paul n\'a rien fait', async () => {
    expect((await vuesQG(kv, NOW)).cerveau.agents.find(a => a.agent === 'paul')!.phrases).toEqual(['Pas encore de passage.']);
  });
});

describe('vuesQG · Feu', () => {
  it('avant sa mise en service : ses analyses « pas encore actives », jamais bloqué, sa ligne en gris', async () => {
    const kv = memoire();
    const v = await vuesQG(kv, NOW);
    const analyses = v.calendrier.creneaux.filter(c => c.routine === 'feu-analyse');
    expect(analyses.map(c => c.heure).slice(0, 4)).toEqual(['08:00', '12:00', '16:00', '20:00']);
    expect(analyses.every(c => c.etat === 'inactif')).toBe(true);
    expect(v.agents.find(a => a.agent === 'feu')).toMatchObject({ statut: 'au repos', prochainPassage: null });
    expect(v.calendrier.lignes.find(l => l.agent === 'feu')).toMatchObject({ prevu: true, texte: 'Feu : lit le marché toutes les 15 min (BTC et ETH)' });
    expect(v.cerveau.agents.find(a => a.agent === 'feu')!.phrases[0]).toBe('Pas encore de lecture du marché.');
  });
});
