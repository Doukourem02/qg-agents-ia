// Deux étiquettes affichées (pièces, noms, bulles) ne se recouvrent jamais à l'écran. La simulation évite déjà de
// lancer une bulle trop près d'une autre (engine.ts, bullesProches) ; ici, à l'image, on règle ce qui reste (vraies
// bulles, zoom, personnages qui bougent, « Noms et bulles : toujours ») : dans l'ordre de priorité, chaque étiquette
// qui tomberait sur une étiquette déjà placée monte juste au-dessus.

export type BoiteBulle = { id: string; l: number; r: number; t: number; b: number };

/** Écart minimal entre deux bulles, en points d'écran. */
export const MARGE_BULLES = 3;

/**
 * `boites` dans l'ordre de priorité (la première ne bouge jamais). Renvoie, pour chaque bulle, de combien la monter
 * (en points, ≥ 0) pour qu'aucune ne recouvre une bulle placée avant elle.
 */
export function ecarterBulles(boites: readonly BoiteBulle[], marge = MARGE_BULLES): Map<string, number> {
  const placees: BoiteBulle[] = [];
  const out = new Map<string, number>();
  for (const x of boites) {
    let dy = 0;
    // au plus autant d'essais que de bulles déjà placées (chacune ne peut gêner qu'une fois en montant)
    for (let essai = 0; essai <= placees.length; essai++) {
      const t = x.t - dy, b = x.b - dy;
      const gene = placees.find(p => x.l < p.r + marge && x.r > p.l - marge && t < p.b + marge && b > p.t - marge);
      if (!gene) break;
      dy = x.b - gene.t + marge; // le bas de la bulle juste au-dessus du haut de celle qui gêne
    }
    out.set(x.id, dy);
    placees.push({ ...x, t: x.t - dy, b: x.b - dy });
  }
  return out;
}

/** Comment l'étiquette est accrochée à son point (globals.css) : `piece` centrée dessus, `nom` posé dessus, `bulle`
 * au-dessus avec sa pointe. */
export type Forme = 'piece' | 'nom' | 'bulle';

/**
 * La boîte à l'écran d'une étiquette de taille `w` × `h` (non agrandie) accrochée en (x, y), à l'échelle `sc` :
 * `.qg-room` translate(-50%, -50%), `.qg-tag` translate(-50%, -100%), `.qg-bubble` translate(-50%, -100% - 14px)
 * (sa pointe dépasse de 4,5 px dessous), chacune après scale(--sc).
 */
export function boiteEcran(id: string, forme: Forme, x: number, y: number, w: number, h: number, sc: number): BoiteBulle {
  const l = x - (w * sc) / 2, r = x + (w * sc) / 2;
  if (forme === 'piece') return { id, l, r, t: y - (h * sc) / 2, b: y + (h * sc) / 2 };
  if (forme === 'nom') return { id, l, r, t: y - h * sc, b: y };
  return { id, l, r, t: y - (h + 14) * sc, b: y - (14 - 4.5) * sc };
}
