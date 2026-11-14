import { describe, expect, it } from 'vitest';
import { accroche, ceQuiACloche, confirmation, finLocale, REGLES_KURORO, sansFaussesPromesses, formatLocal, lireReponseLocale, peutEtreUnOrdre, systemeLocal, IDS_CONFIABLES, SCHEMA_LOCAL, SCHEMA_SANS_MISSION } from './kuroro-ia';

describe('Kuroro local : lecture stricte de la réponse d’Ollama', () => {
  it('un JSON valide sans mission (salutation, question)', () => {
    expect(lireReponseLocale('{"texte":"Salut patron ! Ça va bien.","mission":null}')).toEqual({ texte: 'Salut patron ! Ça va bien.', mission: null });
    expect(lireReponseLocale(' {"texte":"C’est Isaac.","mission":null,"autre":1} ')).toEqual({ texte: 'C’est Isaac.', mission: null });
  });
  it('un JSON valide avec une mission pour un vrai id', () => {
    expect(lireReponseLocale('{"texte":"D’accord.","mission":{"agent":"isaac","mission":"Vider le cache du Mac"}}'))
      .toEqual({ texte: 'D’accord.', mission: { agent: 'isaac', mission: 'Vider le cache du Mac' } });
  });
  it('un agent inconnu (ou Kuroro), une mission vide ou trop longue : null, les règles reprennent', () => {
    expect(lireReponseLocale('{"texte":"Je confie à Bob.","mission":{"agent":"bob","mission":"x"}}')).toBeNull();
    expect(lireReponseLocale('{"texte":"ok","mission":{"agent":"kuroro","mission":"x"}}')).toBeNull();
    expect(lireReponseLocale('{"texte":"ok","mission":{"agent":"isaac","mission":""}}')).toBeNull();
    expect(lireReponseLocale(`{"texte":"ok","mission":{"agent":"isaac","mission":"${'x'.repeat(301)}"}}`)).toBeNull();
  });
  it('du texte autour du JSON, un JSON cassé : null ; du texte simple et court : ce texte, sans mission', () => {
    expect(lireReponseLocale('Voici : {"texte":"ok","mission":null}')).toBeNull();
    expect(lireReponseLocale('{"texte":"ok"')).toBeNull();
    expect(lireReponseLocale('Salut patron, tout roule.')).toEqual({ texte: 'Salut patron, tout roule.', mission: null });
  });
  it('trop long, vide, pas un texte : null', () => {
    expect(lireReponseLocale(JSON.stringify({ texte: 'a'.repeat(401), mission: null }))).toBeNull();
    expect(lireReponseLocale('a'.repeat(401))).toBeNull();
    expect(lireReponseLocale('{"texte":"  ","mission":null}')).toBeNull();
    expect(lireReponseLocale('[1]')).toBeNull();
    expect(lireReponseLocale(undefined)).toBeNull();
  });
});

describe('Kuroro local : le prompt et la confirmation', () => {
  it('le prompt porte la vérité sur les missions et les faits', () => {
    const p = systemeLocal({ agents: [{ id: 'isaac' }] });
    expect(p).toContain('Isaac lit ses missions tout de suite');
    expect(p).toContain('"id":"isaac"');
    expect(IDS_CONFIABLES).not.toContain('kuroro');
  });
  it('la réponse à une demande est écrite par le code : qui s’en occupe, son statut réel, « c’est noté », la vraie suite', () => {
    expect(confirmation('isaac')).toEqual(['C’est Isaac qui s’en occupe (Mac & Outils).', 'C’est noté, je me charge de l’informer.', 'Il te répond sur Telegram dans une minute environ, si ton Mac est allumé.']);
    const lundi10h = Date.UTC(2026, 10, 16, 10);
    expect(confirmation('clara', 'Son prochain passage : Propose de nouveaux expéditeurs à nettoyer, aujourd’hui à 13:00.', { now: lundi10h }).join(' '))
      .toBe('C’est Clara qui s’en occupe (Mac & Outils). Son prochain passage : Propose de nouveaux expéditeurs à nettoyer, aujourd’hui à 13:00. C’est noté, je me charge de l’informer. Elle s’en occupe dans l’heure (passage des missions toutes les heures, entre 8 h et 20 h) ; le résultat arrive sur Telegram.');
    // avant 8 h, après 20 h, avant la mise en service : le vrai délai
    expect(confirmation('clara', '', { now: Date.UTC(2026, 10, 16, 21) }).at(-1)).toContain('demain matin, au passage de 8 h');
    expect(confirmation('clara', '', { now: Date.UTC(2026, 10, 12, 10) }).at(-1)).toContain('pas encore en service');
    // en pause (par toi) : ni statut ni délai, la mission attend sa reprise
    expect(confirmation('ye', 'Son prochain passage : Fiche portfolio, vendredi 20 à 17:30.', { now: lundi10h, pause: 'en pause (par toi) jusqu’à lundi 23 à 00:00' }))
      .toEqual(['C’est Ye qui s’en occupe (Communication).', 'C’est noté, je me charge de l’informer.', 'Ye est en pause (par toi) jusqu’à lundi 23 à 00:00 : la mission l’attend sur sa fiche, pour sa reprise.']);
    expect(confirmation('malenia')).toEqual(['C’est le rôle de Malenia, pas encore en service : c’est noté, je garde la mission de côté.']);
  });
  it('l’accroche du modèle : courte, sans qui, ni quand, ni « c’est fait » ; « Entendu. » sinon', () => {
    expect(accroche('D’accord, patron.')).toBe('D’accord, patron.');
    expect(accroche('Très bien patron, je lance ça tout de suite.')).toBe('Entendu.');
    expect(accroche('C’est fait, Isaac a vidé le cache !')).toBe('Entendu.');
    expect(accroche('Compris frère')).toBe('Entendu.');
    expect(accroche('Ok, à 18:00.')).toBe('Entendu.');
    expect(accroche('Bien reçu')).toBe('Bien reçu.');
    expect(accroche('')).toBe('Entendu.');
  });
  it('les règles : jamais « frère », la salutation appelle « qu’est-ce que je peux faire pour toi », plus de gabarit « Pardon frère »', () => {
    expect(REGLES_KURORO).not.toMatch(/Pardon frère|grand frère|Tu veux que je te le résume/);
    expect(REGLES_KURORO).toContain('Jamais « frère »');
    expect(REGLES_KURORO).toContain('Qu\'est-ce que je peux faire pour toi ?');
    expect(REGLES_KURORO).not.toContain('sans lui demander aussitôt ce que tu peux faire');
  });
  it('ce qui a cloché : il l’a appelé « frère » (ou le patron le lui reproche)', () => {
    expect(ceQuiACloche([{ role: 'moi', texte: 'Salut ca va ?' }, { role: 'kuroro', texte: 'Salut frère, ça va ?' }, { role: 'moi', texte: 'arrête' }])).toContain('« frère »');
    expect(ceQuiACloche([{ role: 'moi', texte: 'je suis pas ton frere mais ton patron imbecile' }])).toContain('« frère »');
    expect(ceQuiACloche([{ role: 'moi', texte: 'salut' }, { role: 'kuroro', texte: 'Bonjour patron.' }, { role: 'moi', texte: 'tu es nul' }])).toBe('');
    expect(finLocale('H.', 'tu es nul', 'tu l’as appelé « frère »')).toBe('H.\nCe qui a cloché dans l\'échange : tu l’as appelé « frère ».\nSon dernier message n\'est pas un ordre : aucune mission (« mission » vaut null).');
  });
});

describe('Kuroro local : une mission seulement sur un ordre', () => {
  it('les questions et les reproches de ce matin ne sont pas des ordres ; « dis à Isaac… » en est un', () => {
    for (const t of ["ca va le point du matin n'est pas encore arrivé sur mon telegram c'est normal ?", "mais frere on est 7h53 la qui s'occupe de m'envoyer le point deja ?",
      'faite gaffe la prochaine fois je ne tolérerai plus les retards', 'fais gaffe, la prochaine fois je ne tolérerai plus les retards', 'fais attention stp',
      "Paul m'a toujours rien envoyé aujourd'hui, ça commence à m'énerver", 'combien de personnes ont visité mon portfolio cette semaine ?', 'salut Kuroro, ça va ?']) {
      expect(peutEtreUnOrdre(t), t).toBe(false);
      expect(formatLocal(t)).toBe(SCHEMA_SANS_MISSION);
    }
    expect(peutEtreUnOrdre('il faudrait faire quelque chose pour mes mails')).toBe(false);
    for (const t of ['dis à Isaac de vider le cache de mon Mac', 'vide le cache de mon Mac', 'fais le ménage dans mes mails']) {
      expect(peutEtreUnOrdre(t), t).toBe(true);
      expect(formatLocal(t)).toBe(SCHEMA_LOCAL);
    }
  });
  it('la fin du prompt : l’humeur, puis « pas un ordre » quand le code le sait', () => {
    expect(finLocale('H.', 'vide le cache')).toBe('H.');
    expect(finLocale('H.', 'c’est normal ?')).toBe('H.\nSon dernier message n\'est pas un ordre : aucune mission (« mission » vaut null).');
    expect(systemeLocal({ a: 1 }, 'FIN').endsWith('{"a":1}\n\nFIN')).toBe(true);
  });
});

describe('Kuroro local : jamais une action que le QG ne fait pas', () => {
  it('les phrases qui promettent un rappel ou une relance sont retirées, le reste est gardé', () => {
    expect(sansFaussesPromesses('Compris, le patron. Paul passe à 18:00. Je vais lui rappeler maintenant.')).toBe('Compris, le patron. Paul passe à 18:00.');
    expect(sansFaussesPromesses('Mafe est en retard. J’envoie un rappel.')).toBe('Mafe est en retard.');
    expect(sansFaussesPromesses('Je vérifie avec lui.')).toBe('');
    for (const t of ['Je t’envoie moi-même le compte rendu chaque matin à 08:15 sur Telegram.', 'Tu veux que je te le résume ici ?', 'Pardon patron, je t’ai mal répondu.'])
      expect(sansFaussesPromesses(t)).toBe(t);
  });
  it('à la lecture : la phrase est retirée ; s’il ne reste rien, les règles reprennent', () => {
    expect(lireReponseLocale(JSON.stringify({ texte: 'Mafe a fait son point. Je lui rappelle.', mission: null }))).toEqual({ texte: 'Mafe a fait son point.', mission: null });
    expect(lireReponseLocale(JSON.stringify({ texte: 'Je le relance tout de suite.', mission: null }))).toBeNull();
  });
});
