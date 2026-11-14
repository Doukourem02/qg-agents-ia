import { GRID, partiesDe, PORTE, ROOMS, roomAt, type Pt } from '@/data/layout';
import type { CoteMur } from './vue';

// Qui est là, pour les lumières (règle « rien de faux qui semble réel ») : une pièce ne s'éclaire la nuit, ses fenêtres
// avec, que si quelqu'un y est vraiment présent (present() du moteur : la nuit, Luffy qui veille, l'agent d'astreinte,
// un vrai agent en vraie tâche, Stalker avec Claude Code) ; l'écran d'un poste n'est allumé que si son occupant est là.

type Agent = { id: string; x: number; y: number; home: Pt };
type Presence = { agents: readonly Agent[]; present: (id: string) => boolean };

/** Les pièces où quelqu'un est présent. */
export function piecesOccupees(e: Presence): Set<string> {
  const out = new Set<string>();
  for (const a of e.agents) {
    if (!e.present(a.id)) continue;
    const r = roomAt(a.x, a.y);
    if (r) out.add(r.id);
  }
  return out;
}

/** Une place (une cabine téléphonique) est occupée si quelqu'un de présent s'y trouve (à moins de 0,45 case). */
export function occupee(place: Pt, agents: readonly { id: string; x: number; y: number }[], present: (id: string) => boolean) {
  return agents.some(a => Math.hypot(a.x - place[0], a.y - place[1]) < 0.45 && present(a.id));
}

/** La clé d'un poste (une place assise). */
export const posteCle = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

/** Les postes dont l'occupant (celui dont c'est la place) est présent : leur écran est allumé. */
export function postesOccupes(e: Presence): Set<string> {
  const out = new Set<string>();
  for (const a of e.agents) if (e.present(a.id)) out.add(posteCle(a.home));
  return out;
}

/** Relu au plus 4 fois par seconde (la scène le demande à chaque image). */
let cache: { t: number; pieces: Set<string>; postes: Set<string> } | null = null;
export function occupation(e: Presence, now = performance.now()) {
  if (!cache || now - cache.t > 250 || now < cache.t) cache = { t: now, pieces: piecesOccupees(e), postes: postesOccupes(e) };
  return cache;
}

/** Les fenêtres des murs (leur début, en cases) : le long mur du fond (N), le mur de gauche (W), celui de devant (S, de
 *  part et d'autre de la porte d'entrée) et celui de droite (E). */
export const FENETRES_N = Array.from({ length: 12 }, (_, i) => 1.2 + i * 3.2);
export const FENETRES_W = Array.from({ length: 9 }, (_, i) => 1.2 + i * 3.3);
/** Une fenêtre fait 1,8 case de large. */
export const FENETRE = 1.8;
/** Devant : le même rythme que le mur du fond, sans fenêtre à la place de la porte d'entrée (un peu de marge de chaque côté). */
export const FENETRES_S = FENETRES_N.filter(x => x + FENETRE < PORTE.x - 0.3 || x > PORTE.x + PORTE.w + 0.3);
/** À droite : le même rythme que le mur de gauche. */
export const FENETRES_E = FENETRES_W;

/** La pièce derrière une fenêtre d'un mur (null : un couloir, qui reste sombre) ; la salle à manger compte pour la Cuisine. */
export function pieceDeFenetre(mur: CoteMur, debut: number): string | null {
  const c = debut + FENETRE / 2;
  const contre = ([x, y, w, d]: [number, number, number, number]) => {
    if (mur === 'N') return y <= 2.5 && c >= x && c <= x + w;
    if (mur === 'S') return y + d >= GRID.h - 1.5 && c >= x && c <= x + w;
    if (mur === 'W') return x <= 1.5 && c >= y && c <= y + d;
    return x + w >= GRID.w - 1.5 && c >= y && c <= y + d;
  };
  return ROOMS.find(r => partiesDe(r).some(p => contre(p.r)))?.id ?? null;
}

/**
 * Le volume éclairé d'une pièce occupée : son sol, ses murets (un peu au-delà) et son mobilier, sans entrer dans les
 * murs du bâtiment (leur face intérieure est en x = 0, y = 0, x = GRID.w, y = GRID.h) : un mur à moitié éclairé ferait
 * une découpe nette.
 */
export function volumePiece(id: string) {
  return volumesPiece(id)[0] ?? null;
}
/** Les volumes de toutes les parties d'une pièce (la Cuisine et sa salle à manger s'éclairent ensemble). */
export function volumesPiece(id: string) {
  const r = ROOMS.find(p => p.id === id);
  if (!r) return [];
  return partiesDe(r).map(({ r: [x, y, w, d] }) => ({
    x0: Math.max(0.01, x - 0.2), x1: Math.min(GRID.w - 0.01, x + w + 0.2), y0: Math.max(0.01, y - 0.2), y1: Math.min(GRID.h - 0.01, y + d + 0.2), h: 1.9,
  }));
}
