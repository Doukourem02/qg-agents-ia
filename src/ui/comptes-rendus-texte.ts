// Les petits textes du menu d'arrivée (purs, testés à part).

/** « Bonjour » de 5 h à 18 h, « Bonsoir » sinon ; l'heure d'Abidjan est l'heure UTC. */
export function salutation(now = Date.now()): string {
  const h = new Date(now).getUTCHours();
  return `${h >= 5 && h < 18 ? 'Bonjour' : 'Bonsoir'} patron`;
}

export const phraseNombre = (n: number) => (n === 1 ? '1 personne a un compte rendu pour toi' : `${n} personnes ont un compte rendu pour toi`);
