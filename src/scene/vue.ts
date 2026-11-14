// La vue que je règle à la main : déplacement (glisser), zoom (molette, pincement), et la rotation 3D (clic droit
// glissé, ctrl ou option + glisser, rotation à deux doigts) : tourner autour du bureau et l'incliner.
// Partagée entre la caméra (qui l'applique) et les gestes (qui la modifient).

/** L'inclinaison de mes plans : vue à 30° (isométrie 2:1). */
export const ELEVATION = Math.PI / 6;
/** De presque à la verticale (vue de dessus) à une vue assez basse ; jamais sous l'île. */
export const ELEV_MIN = 0.3, ELEV_MAX = 1.4;
export const ZOOM_MIN = 0.7, ZOOM_MAX = 4;

export const vue = {
  panX: 0, // déplacement au sol, en cases
  panZ: 0,
  zoom: 1, // multiplicateur choisi au geste
  camZoom: 1, // zoom réel de la caméra, pour convertir les pixels en cases
  glisse: false, // vrai pendant un glisser (ou une rotation) : on ignore alors les clics
  /** La rotation voulue autour du bureau (radians, 0 = l'angle de mes plans) et l'inclinaison voulue. */
  azimut: 0,
  elevation: ELEVATION,
  /** La rotation et l'inclinaison de la caméra en ce moment (elles glissent vers les valeurs voulues). */
  az: 0,
  el: ELEVATION,
  /**
   * La hauteur des quatre murs du bâtiment (1 : debout, 0 : baissés en muret, comme dans les Sims). À l'angle de
   * départ, les murs de devant (sud) et de droite (est) sont des murets ; ceux du fond (nord, ouest) sont debout.
   */
  murs: { N: 1, W: 1, S: 0, E: 0 } as Record<CoteMur, number>,
};

/** Les quatre murs du bâtiment : le long mur du fond (N, y = 0), celui de gauche (W, x = 0), celui de devant, où est
 *  l'entrée (S, y = GRID.h), et celui de droite (E, x = GRID.w). */
export const COTES_MURS = ['N', 'W', 'S', 'E'] as const;
export type CoteMur = (typeof COTES_MURS)[number];

/** Déplacement et zoom remis à zéro (clic sur une pièce, retour) ; l'angle choisi reste. */
export function resetVue() {
  vue.panX = 0; vue.panZ = 0; vue.zoom = 1;
}

/** « Remettre la vue » : l'angle, l'inclinaison, le zoom et le cadrage exacts de mes plans. */
export function remettreLaVue() {
  resetVue();
  // le plus court chemin vers l'angle de départ (sans faire un tour complet à rebours)
  vue.azimut = vue.az - angleProche(vue.az, 0);
  vue.elevation = ELEVATION;
}

/** L'écart signé le plus court entre deux angles (dans ]-π, π]). */
export function angleProche(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** La vue a-t-elle bougé par rapport à celle de mes plans ? (le bouton « Remettre la vue » n'apparaît qu'alors) */
export const vueBougee = () =>
  Math.abs(angleProche(vue.azimut, 0)) > 1e-3 || Math.abs(vue.elevation - ELEVATION) > 1e-3 || Math.abs(vue.zoom - 1) > 1e-3 || Math.abs(vue.panX) > 1e-3 || Math.abs(vue.panZ) > 1e-3;

/** L'angle au sol de la caméra : 45° (entre +x et +y du plan) tourné de l'azimut. */
const theta = (az: number) => Math.PI / 4 + az;

/** La direction du centre de la vue vers la caméra (x, hauteur, y du plan), pour une rotation et une inclinaison. */
export function directionCamera(az: number, el: number): [number, number, number] {
  const t = theta(az);
  return [Math.cos(el) * Math.cos(t), Math.sin(el), Math.cos(el) * Math.sin(t)];
}

/**
 * Les axes du glisser, au sol : « droite de l'écran » et « haut de l'écran », selon la rotation (un glisser déplace
 * toujours dans le sens de l'écran, quel que soit l'angle).
 */
export function axesEcran(az: number) {
  const t = theta(az);
  return { droite: { x: Math.sin(t), z: -Math.cos(t) }, haut: { x: -Math.cos(t), z: -Math.sin(t) } };
}

/** La part de la hauteur de l'écran dont l'île remonte pendant la conversation avec Kuroro. */
export const REMONTEE_CONVERSATION = 0.38;

/**
 * Pendant la conversation avec Kuroro, l'île remonte à l'écran et laisse le ciel du bas à Kuroro et aux bulles : le
 * décalage au sol du point visé (vers le bas de l'écran, quel que soit l'angle), pour une remontée de
 * REMONTEE_CONVERSATION × la hauteur de l'écran (en pixels), au zoom de la caméra (pixels par case) et à l'inclinaison
 * donnés. Il s'ajoute au cadrage d'une pièce et au déplacement à la main.
 */
export function decalageConversation(az: number, el: number, hauteurEcran: number, zoom: number) {
  const { haut } = axesEcran(az), d = (REMONTEE_CONVERSATION * hauteurEcran) / zoom / Math.sin(el);
  return { x: -haut.x * d, z: -haut.z * d };
}

/**
 * Les murs à baisser (la règle des Sims, sur les quatre murs) : ceux qui se trouvent entre la caméra et l'intérieur.
 * Le mur nord (en y = 0) se baisse quand la caméra passe de son côté (y < 0), le mur sud (en y = GRID.h) quand elle
 * est devant (y > 0) ; de même l'ouest (x < 0) et l'est (x > 0). Un peu avant d'être de profil, pour qu'aucun ne cache
 * jamais rien : de profil, les deux murs opposés sont baissés ensemble.
 */
export function mursAbaisses(az: number): Record<CoteMur, boolean> {
  const t = theta(az), y = Math.sin(t), x = Math.cos(t);
  return { N: y < 0.2, W: x < 0.2, S: y > -0.2, E: x > -0.2 };
}

/** Le zoom, borné. */
export const zoomBorne = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Faire tourner et incliner la vue d'un glisser (en pixels) : un tour complet en ~800 px, l'inclinaison bornée. */
export function tourner(dx: number, dy: number) {
  vue.azimut -= dx * 0.008;
  vue.elevation = Math.min(ELEV_MAX, Math.max(ELEV_MIN, vue.elevation + dy * 0.005));
}

type Roulette = { ctrlKey: boolean; deltaY: number; deltaMode?: number; preventDefault: () => void };
/**
 * La molette et le pincement du pavé tactile (le navigateur l'envoie comme une molette avec ctrl) : on zoome la
 * scène, jamais la page (preventDefault, sur un écouteur non passif). Le pincement est plus fin, d'où un pas plus grand.
 */
export function surRoulette(e: Roulette) {
  e.preventDefault();
  const pas = e.ctrlKey ? 0.01 : 0.0015;
  vue.zoom = zoomBorne(vue.zoom * Math.exp(-e.deltaY * pas * (e.deltaMode === 1 ? 16 : 1)));
}

type Geste = { scale: number; rotation: number; preventDefault: () => void };
let debutGeste: { zoom: number; azimut: number; rotation: number } | null = null;
/**
 * Les gestes de Safari (pincer, tourner à deux doigts sur le pavé tactile) : jamais le zoom de la page
 * (preventDefault) ; l'écart de pincement règle le zoom de la scène, la rotation fait tourner le bureau.
 */
export function surGeste(type: 'gesturestart' | 'gesturechange' | 'gestureend', e: Geste) {
  e.preventDefault();
  if (type === 'gesturestart' || !debutGeste) debutGeste = { zoom: vue.zoom, azimut: vue.azimut, rotation: e.rotation ?? 0 };
  if (type === 'gesturechange') {
    vue.zoom = zoomBorne(debutGeste.zoom * (e.scale || 1));
    vue.azimut = debutGeste.azimut - (((e.rotation ?? 0) - debutGeste.rotation) * Math.PI) / 180;
    vue.glisse = true;
  }
  if (type === 'gestureend') { debutGeste = null; setTimeout(() => (vue.glisse = false), 0); }
}
