import { describe, expect, it } from 'vitest';
import { humeurDe, ligneHumeur } from './humeur';

const humeur = (t: string) => humeurDe(t).humeur;

describe('L’humeur du patron', () => {
  it('la conversation du 12 novembre au matin : une question neutre, puis l’agacement', () => {
    expect(humeur('ca va le point du matin n\'est pas encore arrivé sur mon telegram c\'est normal ?')).toBe('neutre');
    expect(humeurDe('mais frere on est 7h53 la qui s\'occupe de m\'envoyer le point deja ?')).toMatchObject({ humeur: 'agacé', familier: true });
    expect(humeurDe('faite gaffe la prochaine fois je ne tolérerai plus les retards')).toMatchObject({ humeur: 'agacé', familier: false });
  });

  it('agacé : reproches, « c’est pas normal », jurons, majuscules, « !!! »', () => {
    for (const t of [
      "c'est pas normal que personne ne m'ait prévenu", 'ça commence à m’énerver', "j'en ai marre de ces retards", 'Paul toujours pas passé ?',
      'putain le site est encore tombé', 'POURQUOI RIEN NE MARCHE', 'tu te moques de moi ?', 'je suis pas content du tout', 'il est où mon point ???!',
      'on est déjà 10h et rien', 'sérieux ?',
    ]) expect(humeur(t), t).toBe('agacé');
  });

  it('content, et la joie criée reste de la joie ; un merci de politesse dans un ordre n’en est pas', () => {
    expect(humeur('merci frère, le relevé de Light ce matin c’était top')).toBe('content');
    expect(humeur('MERCI FRÈRE !!!')).toBe('content');
    expect(humeur('bien joué Kuroro')).toBe('content');
    expect(humeur('pas top ce matin')).toBe('neutre');
    expect(humeur('merci de vider le cache')).toBe('neutre');
    // l'agacement l'emporte sur le merci
    expect(humeur('merci mais c’est pas normal')).toBe('agacé');
  });

  it('pressé, fatigué, neutre', () => {
    expect(humeur('vite fait, y a un truc urgent ?')).toBe('pressé');
    expect(humeur('en deux mots, ça roule ?')).toBe('pressé');
    expect(humeur('je suis crevé frère, tout roule au QG ?')).toBe('fatigué');
    expect(humeur('journée de fou, je suis épuisé')).toBe('fatigué');
    expect(humeur('salut Kuroro, ça va ?')).toBe('neutre');
    expect(humeur('dis à Isaac de vider le cache de mon Mac')).toBe('neutre');
    expect(humeur('Luffy il en est où avec mes sites ?')).toBe('neutre');
    expect(humeur('ok')).toBe('neutre');
  });

  it('une insulte, « je suis pas ton frère » : agacé', () => {
    expect(humeurDe('je suis pas ton frere mais ton patron imbecile')).toMatchObject({ humeur: 'agacé', indices: ['une insulte', 'pas ton frère'] });
    expect(humeur('t’es vraiment nul')).toBe('agacé');
  });

  it('familier : Kuroro se détend un peu, jamais au point de l’appeler « frère »', () => {
    const l = ligneHumeur(['salut frère']);
    expect(l).toContain('ne l’appelle jamais « frère » : il est ton patron');
    expect(l).not.toContain('grand frère');
  });

  it('le registre familier : « frère », « gars », « on dit quoi »', () => {
    for (const t of ['frère tu es là ?', 'mon gars', 'on dit quoi', 'wesh', 'frérot ça va']) expect(humeurDe(t).familier, t).toBe(true);
    expect(humeurDe('bonjour Kuroro').familier).toBe(false);
  });

  it('la ligne donnée à Kuroro : l’humeur du dernier message, les indices, et le registre des derniers messages', () => {
    expect(ligneHumeur(['salut'])).toBe('humeur_de_patron (son dernier message) : neutre. Naturel.');
    const l = ligneHumeur(['mais frere on est 7h53 la qui s\'occupe de m\'envoyer le point deja ?', 'faite gaffe la prochaine fois je ne tolérerai plus les retards']);
    expect(l).toContain(': agacé (');
    expect(l).toContain('je ne tolérerai plus');
    expect(l).toContain('familier');
    expect(ligneHumeur([])).toContain('neutre');
  });
});
