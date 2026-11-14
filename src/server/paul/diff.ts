// Ce qui change entre deux versions d'un fichier, ligne par ligne (plus longue sous-suite commune). Fonctions pures.
import type { LigneDiff } from './types';

/** Lignes montrées au plus (page et stockage) ; le reste est compté. */
export const MAX_LIGNES_MONTREES = 150;
const MAX_TEXTE_LIGNE = 300;
/** Au-delà (lignes avant × lignes après), on compte sans aligner (assez juste pour la règle des 40 %). */
const MAX_CASES = 4_000_000;

export type Difference = {
  lignes: LigneDiff[]; ajoutees: number; retirees: number;
  /** Lignes non vides du fichier actuel, et combien d'entre elles disparaissent (règle des 40 %). */
  nonVidesAvant: number; nonVidesRetirees: number;
};

const decouper = (t: string) => (t === '' ? [] : t.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
const court = (l: string) => (l.length > MAX_TEXTE_LIGNE ? l.slice(0, MAX_TEXTE_LIGNE - 1) + '…' : l);

/** Les opérations ligne à ligne : « = » gardée, « - » retirée, « + » ajoutée. */
function operations(a: string[], b: string[]): { op: '=' | '-' | '+'; texte: string }[] {
  const n = a.length, m = b.length;
  if (n * m > MAX_CASES) {
    // Sans alignement : une ligne est gardée tant qu'elle existe encore de l'autre côté (par comptage).
    const restant = new Map<string, number>();
    for (const l of b) restant.set(l, (restant.get(l) ?? 0) + 1);
    const ops: { op: '=' | '-' | '+'; texte: string }[] = [];
    const gardees = new Map<string, number>();
    for (const l of a) {
      const r = restant.get(l) ?? 0;
      if (r > 0) { restant.set(l, r - 1); gardees.set(l, (gardees.get(l) ?? 0) + 1); ops.push({ op: '=', texte: l }); } else ops.push({ op: '-', texte: l });
    }
    for (const l of b) {
      const g = gardees.get(l) ?? 0;
      if (g > 0) gardees.set(l, g - 1); else ops.push({ op: '+', texte: l });
    }
    return ops;
  }
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  }
  const ops: { op: '=' | '-' | '+'; texte: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ op: '=', texte: a[i] }); i++; j++; }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) ops.push({ op: '-', texte: a[i++] });
    else ops.push({ op: '+', texte: b[j++] });
  }
  while (i < n) ops.push({ op: '-', texte: a[i++] });
  while (j < m) ops.push({ op: '+', texte: b[j++] });
  return ops;
}

/**
 * Ce qui change de `avant` à `apres` : seulement les lignes ajoutées et retirées, un « … » à la place des lignes
 * gardées entre deux changements ; 150 lignes montrées au plus (puis « … et N autres lignes changées »), chacune
 * coupée à 300 caractères — sauf `entier` (le bloc de CLAUDE.md : tout ce qui sera écrit est montré).
 */
export function difference(avant: string, apres: string, options: { entier?: boolean } = {}): Difference {
  const ops = operations(decouper(avant), decouper(apres));
  const lignes: LigneDiff[] = [];
  let ajoutees = 0, retirees = 0, nonVidesAvant = 0, nonVidesRetirees = 0, cachees = 0, saut = false;
  for (const o of ops) {
    if (o.op !== '+' && o.texte.trim() !== '') nonVidesAvant++;
    if (o.op === '=') { saut = lignes.length > 0; continue; }
    if (o.op === '+') ajoutees++; else { retirees++; if (o.texte.trim() !== '') nonVidesRetirees++; }
    if (!options.entier && lignes.length >= MAX_LIGNES_MONTREES) { cachees++; continue; }
    if (saut) { lignes.push({ sorte: '…', texte: '' }); saut = false; }
    lignes.push({ sorte: o.op, texte: options.entier ? o.texte : court(o.texte) });
  }
  if (cachees > 0) lignes.push({ sorte: '…', texte: `et ${cachees} autre${cachees > 1 ? 's' : ''} ligne${cachees > 1 ? 's' : ''} changée${cachees > 1 ? 's' : ''}` });
  return { lignes, ajoutees, retirees, nonVidesAvant, nonVidesRetirees };
}

/** Règle des 40 % : une réécriture qui retire plus de 40 % des lignes non vides du fichier actuel est refusée. */
export const SEUIL_RETRAIT = 0.4;
export const retireTrop = (d: Difference) => d.nonVidesAvant > 0 && d.nonVidesRetirees / d.nonVidesAvant > SEUIL_RETRAIT;
