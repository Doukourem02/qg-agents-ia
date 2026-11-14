// Le bloc « Où on s'est arrêté » de Paul dans CLAUDE.md : seul ce bloc, entre ses deux marqueurs, peut changer.
// Le reste du fichier est au patron : le serveur reconstruit le fichier lui-même à partir du bloc reçu. Fonctions pures.

export const DEBUT = '<!-- paul:debut -->';
export const FIN = '<!-- paul:fin -->';
/** Toute trace de marqueur dans un bloc reçu le ferait sortir de sa place : refusé. */
export const TRACE_MARQUEUR = /<!--\s*paul:/i;

const compter = (texte: string, motif: string) => texte.split(motif).length - 1;

/**
 * Le bloc actuel (sans les retours à la ligne collés aux marqueurs) ; null s'il n'y a aucun marqueur ; « abime » si les
 * marqueurs sont abîmés (un seul, en double, ou dans le mauvais ordre) : dans ce cas, rien n'est jamais écrit.
 */
export function extraireBloc(texte: string): string | null | 'abime' {
  const d = compter(texte, DEBUT), f = compter(texte, FIN);
  if (d === 0 && f === 0) return null;
  if (d !== 1 || f !== 1) return 'abime';
  const i = texte.indexOf(DEBUT), j = texte.indexOf(FIN);
  if (j < i) return 'abime';
  return texte.slice(i + DEBUT.length, j).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

/** Le bloc tel qu'il sera écrit (retours Windows et lignes vides au bord retirés). */
export const blocPropre = (bloc: string) => bloc.replace(/\r\n/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, '');

/**
 * L'endroit où insérer un bloc absent : après la première ligne de titre (« # … ») et les lignes « @… » d'en-tête
 * (lignes vides comprises entre elles), sinon tout en haut. Rend la position dans le texte (début d'une ligne).
 */
function finEnTete(texte: string): number {
  let pos = 0, fin = 0, titre = false;
  for (const ligne of texte.split('\n')) {
    const l = ligne.trim();
    const suivant = pos + ligne.length + 1;
    if (l === '') { pos = suivant; continue; }
    if (!titre && /^#{1,6}\s/.test(l)) titre = true;
    else if (!l.startsWith('@')) break;
    fin = Math.min(suivant, texte.length);
    pos = suivant;
  }
  return fin;
}

/**
 * Le CLAUDE.md complet avec le bloc de Paul à sa place. Bloc présent : seul le texte entre les marqueurs change.
 * Bloc absent : il est inséré (avec ses marqueurs) après l'en-tête, sans toucher un caractère du reste. Lève une
 * erreur si les marqueurs sont abîmés.
 */
export function reconstruire(texte: string, bloc: string): string {
  const b = blocPropre(bloc);
  const actuel = extraireBloc(texte);
  if (actuel === 'abime') throw new Error('marqueurs de Paul abîmés');
  if (actuel !== null) {
    const i = texte.indexOf(DEBUT) + DEBUT.length, j = texte.indexOf(FIN);
    return `${texte.slice(0, i)}\n${b}\n${texte.slice(j)}`;
  }
  const pos = finEnTete(texte);
  const avant = texte.slice(0, pos), apres = texte.slice(pos);
  const coller = avant !== '' && !avant.endsWith('\n') ? '\n' : '';
  const espaceAvant = avant !== '' ? '\n' : '';
  const espaceApres = apres === '' || apres.startsWith('\n') ? '' : '\n';
  return `${avant}${coller}${espaceAvant}${DEBUT}\n${b}\n${FIN}\n${espaceApres}${apres}`;
}
