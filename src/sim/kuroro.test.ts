import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ECHEC, confirmerChoix, decider, estOrdre, petitMot, quandLigne, type Boite } from './kuroro';
import { agentById, poleById } from './routing';
import { AGENTS_REELS } from '@/data/reels';

const a = (h: number, m = 0) => Date.UTC(2026, 10, 10, h, m);

describe('Kuroro : les mots gentils', () => {
  it('reconnaît les salutations, sans accents ni majuscules', () => {
    for (const t of ['bonjour', 'Bonsoir !', 'SALUT', 'hello', 'coucou', 'yo', 'Ça va ?', 'ca va', 'salut kuroro, ça va ?', 'Bonjour Kuroro']) {
      expect(petitMot(t), t).not.toBeNull();
    }
  });
  it('« Bonjour » de 4 h à 18 h (heure d’Abidjan : à 4 h, c’est déjà le lendemain), « Bonsoir » sinon ; un salut appelle un salut', () => {
    expect(decider('bonjour', { now: a(9) })).toEqual({ type: 'petit', lignes: ['Bonjour patron.', 'Qu’est-ce que je peux faire pour toi ?'] });
    expect(decider('salut', { now: a(4) })).toMatchObject({ lignes: ['Bonjour patron.', 'Qu’est-ce que je peux faire pour toi ?'] });
    expect(decider('bonjour', { now: a(18) })).toEqual({ type: 'petit', lignes: ['Bonsoir patron.', 'Qu’est-ce que je peux faire pour toi ?'] });
    expect(decider('coucou', { now: a(2) })).toMatchObject({ lignes: ['Bonsoir patron.', 'Qu’est-ce que je peux faire pour toi ?'] });
  });
  it('merci et ça va', () => {
    expect(decider('merci')).toEqual({ type: 'petit', lignes: ['Avec plaisir, patron.', 'Il te faut autre chose ?'] });
    expect(decider('Merci beaucoup Kuroro !')).toEqual({ type: 'petit', lignes: ['Avec plaisir, patron.', 'Il te faut autre chose ?'] });
    expect(decider('ça va ?', { now: a(10) })).toEqual({ type: 'petit', lignes: ['Je vais bien, merci.', 'Qu’est-ce que je peux faire pour toi ?'] });
    // il salue : Kuroro répond à sa salutation, puis lui demande ce qu'il attend de lui (jamais « frère »)
    expect((decider('salut, ça va ?', { now: a(10) }) as { lignes: string[] }).lignes).toEqual(['Bonjour patron, je vais bien, merci.', 'Qu’est-ce que je peux faire pour toi ?']);
    expect((decider('Salut ca va ?', { now: a(17, 1) }) as { lignes: string[] }).lignes.join(' ')).toBe('Bonjour patron, je vais bien, merci. Qu’est-ce que je peux faire pour toi ?');
  });
  it('une salutation n’est jamais une mission ; une salutation suivie d’une demande en est une', () => {
    for (const t of ['bonjour', 'bonsoir', 'merci', 'ça va ?', 'yo']) expect(decider(t).type).toBe('petit');
    const d = decider('salut, vide le cache de mon Mac');
    expect(d.type).toBe('mission');
  });
});

describe('Kuroro : la discussion sans ordre (jamais les boutons)', () => {
  const boite: Boite = {
    agents: [{ statut: 'au repos' }, { statut: 'au travail' }, { statut: 'au repos' }, { statut: 'au repos' }, { statut: 'au repos' }, { statut: 'au repos' }],
    enAttente: [{ agent: 'luffy', texte: 'site en panne', nombre: 1 }, { agent: 'clara', texte: 'question à répondre', nombre: 2 }],
  };
  const PATRON = ['salut je vais super bien je prends de tes nouvelles…', 'je te salut juste', 'je te salue', 'je vais bien', 'comment tu gères la boîte ?', 'je prends de tes nouvelles'];

  it('les phrases du patron : une réponse naturelle, avec les vrais faits, jamais de choix ni de mission', () => {
    for (const t of PATRON) {
      const d = decider(t, { now: a(10), boite });
      expect(d.type, t).toBe('petit');
      expect(d.lignes.join(' '), t).toContain('La boîte tourne : 6 agents en service, 1 au travail, 1 site en panne.');
      expect(d.lignes.at(-1), t).toBe('Qu’est-ce que je peux faire pour toi ?');
      expect(estOrdre(t), t).toBe(false);
    }
    expect(decider('salut je vais super bien je prends de tes nouvelles…', { now: a(10), boite }).lignes)
      .toEqual(['Bonjour patron. Content de savoir que tu vas bien.', 'La boîte tourne : 6 agents en service, 1 au travail, 1 site en panne.', 'Qu’est-ce que je peux faire pour toi ?']);
    expect(decider('je te salut juste', { now: a(21), boite }).lignes[0]).toBe('Bonsoir patron. Content de te lire.');
    expect(decider('comment tu gères la boîte ?', { now: a(10), boite }).lignes[0]).toBe('Ça roule de mon côté, merci de demander.');
  });

  it('sans les vues (ou en /demo) : rien d’inventé', () => {
    expect(decider('je te salut juste', { now: a(10) }).lignes).toEqual(['Bonjour patron. Content de te lire.', 'Qu’est-ce que je peux faire pour toi ?']);
    const calme = decider('je vais bien', { now: a(10), boite: { agents: [{ statut: 'au repos' }, { statut: 'au repos' }], enAttente: [] } });
    expect(calme.lignes[1]).toBe('La boîte tourne : 2 agents en service, tout est calme.');
    const panne = decider('je vais bien', { now: a(10), boite: { agents: [{ statut: 'bloque' }], enAttente: [{ agent: 'luffy', texte: 'sites en panne', nombre: 3 }] } });
    expect(panne.lignes[1]).toBe('La boîte tourne : 1 agent en service, 1 en retard, 3 sites en panne.');
  });

  it('une phrase sans ordre ni mot-clé (ou une question) : pas de boutons', () => {
    for (const t of ['on verra demain', 'quoi de neuf ?', 'tu fais quoi ?', 'c’est cool ici']) expect(decider(t, { now: a(10) }).type, t).toBe('petit');
  });

  it('un ordre sans mot-clé : les boutons ; un ordre caché après un bavardage reste un ordre', () => {
    for (const t of ['fais un truc génial', 'peux-tu t’en occuper ?', 'il faut régler ça', 'occupe-toi de ça', 'salut, prépare un truc', 'Kuroro, lance le truc', 'je vais bien, organise la réunion']) {
      expect(estOrdre(t), t).toBe(true);
      expect(decider(t).type, t).toBe('choix');
    }
    expect(decider('je vais bien, vide le cache de mon Mac').type).toBe('mission');
    expect(estOrdre('je fais du sport')).toBe(false);
  });
});

describe('Kuroro : les missions', () => {
  it('un vrai agent : le vrai routage, son pôle et un « quand » vrai', () => {
    const d = decider('vide le cache de mon Mac');
    expect(d).toMatchObject({ type: 'mission', reel: true, agent: { id: 'isaac' } });
    expect((d as { lignes: string[] }).lignes).toEqual([
      'C’est Isaac qui s’en occupe (Mac & Outils). C’est noté, je me charge de l’informer.',
      'Il te répond sur Telegram dans une minute environ, si ton Mac est allumé.',
    ]);
    // Clara : la routine « QG · missions », le vrai délai selon l'heure (ici, avant sa mise en service)
    expect((decider('trie mes mails', { now: a(10) }) as { lignes: string[] }).lignes).toEqual([
      'C’est Clara qui s’en occupe (Mac & Outils). C’est noté, je me charge de l’informer.',
      'Le passage des missions n’est pas encore en service : elle la verra sur sa fiche, et elle sera faite dès sa mise en service.',
    ]);
  });
  it('le vrai délai, selon l’heure : dans l’heure de 8 h à 20 h, ce matin avant 8 h, demain matin après 20 h', () => {
    const j = (h: number, m = 0) => Date.UTC(2026, 10, 16, h, m); // un lundi, après la mise en service
    expect(quandLigne('isaac', null, j(10))).toContain('Telegram');
    expect(quandLigne('clara', null, j(10))).toBe('Elle s’en occupe dans l’heure (passage des missions toutes les heures, entre 8 h et 20 h) ; le résultat arrive sur Telegram.');
    expect(quandLigne('L', null, j(19, 59))).toContain('Il s’en occupe dans l’heure');
    expect(quandLigne('paul', null, j(6))).toContain('Il s’en occupe ce matin, au passage de 8 h');
    expect(quandLigne('ye', null, j(21))).toContain('Elle s’en occupe demain matin, au passage de 8 h');
    expect(quandLigne('mafe', null, j(20, 30))).toContain('demain matin');
    // Luffy et Zoro : seulement leurs actions immédiates ; le reste reste sur leur fiche
    expect(quandLigne('luffy', null, j(10))).toContain('vérifier tes sites tout de suite');
    expect(quandLigne('zoro', null, j(10))).toContain('refaire le tour de sécurité tout de suite');
    expect(quandLigne('obito', null, j(10))).toBeNull();
  });
  it('un agent en pause (par toi) : la mission l’attend, sans délai promis', () => {
    const passages = [{ agent: 'ye', prochainPassage: null, pause: 'en pause (par toi) jusqu’à lundi 16 à 00:00' }];
    expect(quandLigne('ye', passages, a(10))).toBe('Ye est en pause (par toi) jusqu’à lundi 16 à 00:00 : la mission l’attend sur sa fiche, pour sa reprise.');
  });
  it('une action immédiate dans la barre : Kuroro dit ce qui se passe vraiment (jamais en /demo)', () => {
    expect(decider('vérifie mes sites', { now: a(10) })).toMatchObject({ type: 'mission', agent: { id: 'luffy' }, lignes: ['Luffy vérifie tes sites maintenant : le résultat arrive sur Telegram dans une minute.'] });
    expect((decider('mets Ye en pause cette semaine', { now: a(10) }) as { lignes: string[] }).lignes[0]).toMatch(/^D’accord : Ye est en pause jusqu’à lundi 16 à 00:00/);
    expect(decider('vérifie mes sites', { now: a(10), demo: true })).not.toMatchObject({ lignes: ['Luffy vérifie tes sites maintenant : le résultat arrive sur Telegram dans une minute.'] });
    expect(decider('mes sites sont en ligne ?', { now: a(10) }).type).toBe('petit');
  });
  it('un agent pas encore en service : Kuroro le dit', () => {
    const d = decider('revois la stratégie marketing');
    expect(d).toMatchObject({ type: 'mission', reel: false, agent: { id: 'obito' } });
    expect((d as { lignes: string[] }).lignes).toEqual(['C’est le rôle d’Obito, mais il n’est pas encore en service : c’est noté, je garde ta mission de côté.']);
    expect(decider('mets à jour ma fiche portfolio')).toMatchObject({ type: 'mission', reel: true, agent: { id: 'ye' } });
  });
  it('Paul est en service : sa mission passe à la routine des missions, avec le vrai délai', () => {
    const d = decider('mets à jour le readme', { now: Date.UTC(2026, 10, 16, 10) });
    expect(d).toMatchObject({ type: 'mission', reel: true, agent: { id: 'paul' } });
    expect((d as { lignes: string[] }).lignes[0]).toMatch(/^C’est Paul qui s’en occupe/);
    expect((d as { lignes: string[] }).lignes[1]).toContain('Il s’en occupe dans l’heure');
  });
  it('aucun mot-clé : Kuroro demande, avec les seuls vrais agents', () => {
    const d = decider('fais un truc génial');
    expect(d).toEqual({ type: 'choix', lignes: ['Je n’ai pas bien compris à qui confier ça. Choisis :'], choix: [...AGENTS_REELS] });
  });
  it('en /demo, pas de promesse de délai', () => {
    expect((decider('vide le cache de mon Mac', { demo: true }) as { lignes: string[] }).lignes).toHaveLength(1);
    expect(confirmerChoix(agentById('isaac')!, poleById('mac')!, { demo: true })).toEqual(['C’est noté : c’est Isaac qui s’en occupe (Mac & Outils), je me charge de l’informer.']);
  });
  it('le message d’échec ne prétend rien', () => {
    expect(ECHEC).toBe('Je n’arrive pas à joindre l’équipe pour l’instant, réessaie dans un moment.');
  });
});

describe('la barre de mission', () => {
  const app = readFileSync('src/ui/QGApp.tsx', 'utf8');
  const conv = readFileSync('src/ui/ConversationKuroro.tsx', 'utf8');
  it('passe par les réponses de Kuroro et le dépôt existant', () => {
    expect(app).toContain('<ConversationKuroro');
    expect(conv).toContain("from '@/sim/kuroro'");
    expect(conv).toContain('decider(');
    expect(conv).toContain('envoyerMission(');
    expect(conv).not.toContain("fetch('/api/missions'");
  });
  it('en /demo, rien n’est déposé (comme avant) ; une salutation n’est jamais déposée', () => {
    expect(conv).toMatch(/demo \? true : \(await envoyerMission\(/);
    const petit = conv.split("d.type === 'petit'")[1].split('return;')[0];
    expect(petit).not.toContain('envoyerMission');
  });
  it('Kuroro salue à son bureau pendant la conversation, sans casser les comptes rendus', () => {
    expect(conv).toContain("e.saluer('kuroro')");
    expect(conv).toContain("e.salue('kuroro')");
  });
});
