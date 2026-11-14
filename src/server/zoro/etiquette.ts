import type { Tour } from './types';

// Les mots du tour partagés par le serveur et la page : aucun import de valeur (la page ne doit embarquer aucun code serveur).
// Seulement des types et des constantes.

/** Ce qui n'a pas pu être lu, en plus des dépôts pas finis (listés par leur nom). La page compare ces mots exactement. */
export const NON_LU = {
  github: 'GitHub',                       // la liste des dépôts n'a pas pu être lue : toute la partie GitHub
  sansCle: 'GitHub (clé GitHub absente)', // GITHUB_LECTURE_PERSO manquante
  cleGithub: 'clé GitHub',                // l'échéance de la clé n'a pas pu être lue
} as const;

/** Un des mots ci-dessus (une partie entière), pas un nom de dépôt. */
export function estMotNonLu(m: string): boolean {
  return m === NON_LU.github || m === NON_LU.sansCle || m === NON_LU.cleGithub;
}

/**
 * Une partie du dernier tour n'a pas été lue : dépôt ou GitHub non lu, clé non lue, failles illisibles,
 * tests illisibles (droit Actions manquant, limite de débit, aucun passage terminé), Mac pas vu, dossier du Mac non lu.
 */
export function partieNonLue(t: Tour): boolean {
  return t.nonLus.length > 0 || t.macVieux
    || t.projets.some(p => p.failles === null || p.ci.etat === 'illisible')
    || !!t.mac?.dossiers.some(d => d.illisible);
}

const compte = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Ce qui n'a pas été lu, en une ligne courte pour Telegram : des nombres et des mots fixes, jamais un nom de dépôt ni de
 * dossier. Null quand tout a été lu (même règle que `partieNonLue`).
 */
export function resumeNonLu(t: Tour): string | null {
  const morceaux: string[] = [];
  if (t.nonLus.includes(NON_LU.github) || t.nonLus.includes(NON_LU.sansCle)) morceaux.push('GitHub');
  const depots = t.nonLus.filter(m => !estMotNonLu(m)).length;
  if (depots) morceaux.push(compte(depots, 'projet', 'projets'));
  if (t.nonLus.includes(NON_LU.cleGithub)) morceaux.push('date de la clé GitHub');
  const failles = t.projets.filter(p => p.failles === null).length;
  if (failles) morceaux.push(`failles de ${compte(failles, 'projet', 'projets')}`);
  const tests = t.projets.filter(p => p.ci.etat === 'illisible').length;
  if (tests) morceaux.push(`tests de ${compte(tests, 'projet', 'projets')}`);
  const dossiers = t.mac?.dossiers.filter(d => d.illisible).length ?? 0;
  if (t.macVieux) morceaux.push('Mac');
  else if (dossiers) morceaux.push(compte(dossiers, 'dossier du Mac', 'dossiers du Mac'));
  return morceaux.length ? `Pas lu cette fois : ${morceaux.join(', ')}` : null;
}

/** La pastille en haut du bureau : jamais verte quand une partie n'a pas été lue. */
export function etiquetteTour(t: Tour): { texte: string; ton: 'vert' | 'orange' | 'rouge' } {
  const n = t.importants.length;
  if (n) return { texte: `${n} ${n > 1 ? 'points importants' : 'point important'}`, ton: 'rouge' };
  if (partieNonLue(t)) return { texte: 'rien trouvé, une partie n\'a pas été lue', ton: 'orange' };
  return { texte: 'rien d\'important', ton: 'vert' };
}
