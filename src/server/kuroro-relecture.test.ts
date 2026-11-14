import { describe, expect, it } from 'vitest';
import { relire, sansFrere } from './kuroro-relecture';

// Jeudi 12 novembre 2026, heure d'Abidjan (= UTC).
const a = (h: number, m = 0) => Date.UTC(2026, 10, 12, h, m);
const moi = (...textes: string[]) => textes.map(texte => ({ role: 'moi' as const, texte }));

describe('Kuroro relu : jamais « frère », le patron est le patron', () => {
  it('le premier « frère » devient « patron », les suivants sont retirés', () => {
    expect(sansFrere('Salut frère, ça va ?')).toBe('Salut patron, ça va ?');
    expect(sansFrere('Pardon frère, je comprends, frère.')).toBe('Pardon patron, je comprends.');
    expect(sansFrere('Frère, écoute.')).toBe('Patron, écoute.');
    expect(sansFrere('Ok bro, mon frère.')).toBe('Ok patron.');
    expect(sansFrere('Compris patron, frérot.')).toBe('Compris patron.');
  });
  it('parler du mot n’est pas l’appeler ainsi', () => {
    expect(sansFrere('Pardon patron, je t’ai appelé frère, ça ne se reproduira pas.')).toBe('Pardon patron, je t’ai appelé frère, ça ne se reproduira pas.');
  });
});

describe('Kuroro relu : la salutation', () => {
  it('une salutation pure : la réponse est écrite par le code, selon l’heure réelle, puis ce qu’il attend de Kuroro', () => {
    const modele = 'Salut frère, ça va ? J’ai pas vu ton message, mais j’espère que tu t’es bien réveillé. Tu veux que je te résume ce qui t’attend ?';
    expect(relire(modele, { tours: moi('Salut ca va ?'), now: a(17, 1) })).toBe('Bonjour patron, je vais bien, merci. Qu’est-ce que je peux faire pour toi ?');
    expect(relire(modele, { tours: moi('bonsoir'), now: a(20, 30) })).toBe('Bonsoir patron. Qu’est-ce que je peux faire pour toi ?');
    expect(relire(modele, { tours: moi('salut'), now: a(18) })).toBe('Bonsoir patron. Qu’est-ce que je peux faire pour toi ?');
  });
  it('ailleurs : « Bonjour » / « Bonsoir » selon l’heure ; ni « ton message », ni le réveil hors du matin, ni un résumé proposé', () => {
    const tours = moi('salut Kuroro, comment se passe ta journée ?');
    expect(relire('Bonjour patron ! J’ai pas vu ton message. Ma journée se passe bien. J’espère que tu t’es bien réveillé. Tu veux que je te résume ce qui t’attend ?', { tours, now: a(20) }))
      .toBe('Bonsoir patron ! Ma journée se passe bien.');
    expect(relire('J’espère que tu t’es bien réveillé.', { tours: moi('je viens de me lever'), now: a(7) })).toBe('J’espère que tu t’es bien réveillé.');
  });
});

describe('Kuroro relu : jamais deux fois la même phrase', () => {
  it('une phrase déjà dite mot pour mot dans un tour d’avant est retirée', () => {
    const tours = [...moi('qui fait le point ?'), { role: 'kuroro' as const, texte: 'C’est Mafe qui fait le point du matin.' }, ...moi('et aujourd’hui ?')];
    expect(relire('C’est Mafe qui fait le point du matin. Elle l’a fait à 07:38.', { tours, now: a(10) })).toBe('Elle l’a fait à 07:38.');
    expect(relire('C’est Mafe qui fait le point du matin.', { tours, now: a(10) })).toBeNull();
  });
});

describe('Kuroro relu : agacé, insultant', () => {
  it('une insulte sans sujet : une excuse, aucun fait collé, puis la question', () => {
    const conv = [...moi('Salut ca va ?'), { role: 'kuroro' as const, texte: 'Salut frère, ça va ?' }, ...moi('je suis pas ton frere mais ton patron imbecile')];
    expect(relire('Pardon patron, j’aurais dû te le dire : aujourd’hui, L a rien fait sur Telegram, et Luffy a 1 site en panne. Tu veux que je te résume ici ?', { tours: conv, now: a(17, 2) }))
      .toBe('Pardon patron, je t’ai appelé frère, ça ne se reproduira pas. Qu’est-ce que je peux faire pour toi ?');
    expect(relire('Pardon patron, je t’ai appelé frère, ça ne se reproduira pas.', { tours: conv, now: a(17, 2) }))
      .toBe('Pardon patron, je t’ai appelé frère, ça ne se reproduira pas. Qu’est-ce que je peux faire pour toi ?');
    // une excuse vague alors que le code sait ce qui a cloché : remplacée par la juste
    expect(relire('Pardon patron, j’ai mal réagi, je m’excuse. Qu’est-ce que je peux faire pour toi ?', { tours: conv, now: a(17, 2) }))
      .toBe('Pardon patron, je t’ai appelé frère, ça ne se reproduira pas. Qu’est-ce que je peux faire pour toi ?');
    expect(relire('Désolé patron. Luffy a 1 site en panne.', { tours: moi('tu es nul'), now: a(11) })).toBe('Désolé patron. Qu’est-ce que je peux faire pour toi ?');
  });
  it('un reproche sur un agent sans aucun fait (« j’ai pas vu… ») : sa journée, écrite par le code, avant la question', () => {
    const controle = { agents: [{ nom: 'Paul', sait: 'prévu à 18:00', journee: ['README et CLAUDE.md : pas encore passé aujourd’hui, prévu à 18:00, sur Telegram (Valider/Refuser).'] }], tout: '' };
    expect(relire('Pardon patron, j’ai pas vu les propositions de Paul aujourd’hui. Qu’est-ce que je peux faire pour toi ?', { tours: moi('Paul m’a toujours rien envoyé aujourd’hui, ça commence à m’énerver'), now: a(11), controle }))
      .toBe('Pardon patron. Paul : README et CLAUDE.md : pas encore passé aujourd’hui, prévu à 18:00, sur Telegram (Valider/Refuser). Qu’est-ce que je peux faire pour toi ?');
  });
  it('un reproche sur un agent : les faits de cet agent restent, avec une excuse', () => {
    expect(relire('Paul passe le jeudi à 18:00.', { tours: moi('Paul m’a toujours rien envoyé aujourd’hui, ça commence à m’énerver'), now: a(11) }))
      .toBe('Pardon patron. Paul passe le jeudi à 18:00. Qu’est-ce que je peux faire pour toi ?');
  });
});

describe('Kuroro relu : une demande floue, une accroche hors de propos', () => {
  it('une demande floue : une question de précision, si le modèle n’en a pas posé', () => {
    expect(relire('D’accord, patron.', { tours: moi('il faudrait faire quelque chose pour mes mails'), now: a(11) })).toBe('D’accord, patron. Tu peux me préciser ce que tu attends exactement ?');
    expect(relire('Tu veux que Clara trie tes mails ou qu’elle bannisse un expéditeur ?', { tours: moi('il faudrait faire quelque chose pour mes mails'), now: a(11) }))
      .toBe('Tu veux que Clara trie tes mails ou qu’elle bannisse un expéditeur ?');
  });
  it('« D’accord patron. » en tête d’une réponse à une question : retiré', () => {
    expect(relire('D’accord patron. Tout roule.', { tours: moi('tout roule au QG ?'), now: a(11) })).toBe('Tout roule.');
  });
});
