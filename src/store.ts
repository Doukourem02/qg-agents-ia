'use client';
import { create } from 'zustand';
import { Engine, type Mode, type Snapshot } from '@/sim/engine';
import { resetVue } from '@/scene/vue';
import type { VuesQG } from '@/server/vues';
import type { ReunionScene } from '@/data/crise';
import { AGENTS_REELS } from '@/data/reels';
import { HEURE_DEMO, instantAbidjan, instantDemo } from '@/sim/lumiere';

// Une seule simulation pour toute la page. La scène 3D la fait avancer ; les panneaux lisent son instantané.
// Page privée : la simulation ne fait jamais « parler » les vrais agents (muets) ; /demo (vif) la garde entière.
let engine: Engine | null = null;
let vif = false; // mode démo : bureau plus animé
// Stalker (Claude Code avec moi) n'est réel que par sa présence : la simulation ne lui fait rien dire non plus.
// La journée qui vit (journee.ts) : la simulation naît à l'heure d'Abidjan (/demo : l'heure de ?heure=), pour que ceux
// déjà arrivés soient à leur poste dès la première image. Ensuite, la page la lui redonne chaque minute (QGApp).
/** L'heure affichée maintenant : page privée, l'heure réelle ; /demo, l'heure de départ (?heure=) plus le temps écoulé. */
export function horlogeDeLaPage(demo: boolean, now = Date.now()) {
  if (!demo) return instantAbidjan(now, null);
  const { heureDemo, debutDemo, jourDemo } = useQG.getState();
  return instantDemo(now, heureDemo ?? HEURE_DEMO, debutDemo ?? now, jourDemo);
}
const options = () => ({ vif, muets: vif ? [] : [...AGENTS_REELS, 'stalker'], prive: !vif, heure: horlogeDeLaPage(vif) });
export const getEngine = () => (engine ??= new Engine('calme', options()));

/** Le calque de comparaison : mon plan affiché en transparence par-dessus la page. */
export type Calque = 'aucun' | 'calme' | 'pleine';
/** Les noms, bulles et étiquettes : seulement au survol (écran épuré) ou toujours. */
export type Etiquettes = 'survol' | 'toujours';
/** Format de l'écran : large (ordinateur) ou haut (téléphone, tablette en portrait). */
export type Format = 'large' | 'haut';
export type Onglet = 'bureau' | 'equipe' | 'taches' | 'calendrier' | 'cerveau';
/**
 * Le panneau ouvert : une pièce ou un outil sur le côté (la fiche d'agent a son propre panneau),
 * ou le bureau de L, grand panneau au milieu comme les onglets.
 */
export type Volet = { type: 'piece' | 'outil'; id: string } | { type: 'bureauL' } | { type: 'releveLight' } | { type: 'bureauClara' } | { type: 'bureauMafe' } | { type: 'bureauLuffy' } | { type: 'bureauIsaac' } | { type: 'bureauZoro' } | { type: 'bureauLea' } | { type: 'bureauPaul' } | { type: 'bureauYe' } | { type: 'bureauFeu' } | null;
/** Les bureaux des vrais agents (« Le bureau de L / Light / Clara »), grands panneaux au milieu. */
export const BUREAUX = ['bureauL', 'releveLight', 'bureauClara', 'bureauMafe', 'bureauLuffy', 'bureauIsaac', 'bureauZoro', 'bureauLea', 'bureauPaul', 'bureauYe', 'bureauFeu'] as const;
/** Le bureau de chaque agent réel (Panels, OngletsReels, et `?bureau=` dans QGApp). */
export const BUREAU_PAR_AGENT: Record<string, (typeof BUREAUX)[number]> = { L: 'bureauL', light: 'releveLight', clara: 'bureauClara', mafe: 'bureauMafe', luffy: 'bureauLuffy', isaac: 'bureauIsaac', zoro: 'bureauZoro', lea: 'bureauLea', paul: 'bureauPaul', ye: 'bureauYe', feu: 'bureauFeu' };
export const estBureau = (v: Volet) => !!v && (BUREAUX as readonly string[]).includes(v.type);

type State = {
  snap: Snapshot | null;
  selected: string | null;
  toast: string | null;
  mode: Mode;
  version: number; // change quand on recrée la simulation
  calque: Calque;
  etiquettes: Etiquettes;
  hoverAgent: string | null;
  hoverRoom: string | null;
  focus: string | null; // pièce sur laquelle la caméra est centrée
  onglet: Onglet;
  volet: Volet;
  format: Format;
  demo: boolean;
  /** Page privée : la nuit à Abidjan (20:00 – 07:00 UTC), bureau fermé. Jamais dans /demo. */
  nuit: boolean;
  /** L'heure d'Abidjan (UTC), à la minute : le ciel, la lumière, les ombres et l'horloge du mur la suivent. */
  horloge: number;
  /** /demo seulement (`?heure=HH:MM`) : l'heure de départ, en minutes, pour filmer ou vérifier. Jamais sur la page privée. */
  heureDemo: number | null;
  /** /demo : l'instant (réel) où la démo a commencé ; elle avance ensuite en temps réel depuis `heureDemo`. */
  debutDemo: number | null;
  /** /demo seulement (`?jour=samedi`) : le jour de la semaine (0 = dimanche), pour voir le week-end. */
  jourDemo: number | null;
  /** La souris est sur l'horloge du mur : son étiquette (« 17:20 · mercredi 11 novembre ») s'affiche. */
  hoverHorloge: boolean;
  /** Le menu d'arrivée (comptes rendus) : ouvert ou non, et le nombre de comptes rendus connus. */
  arrivee: boolean;
  /** La conversation avec Kuroro est ouverte (sur téléphone, le plan et les réglages lui laissent la place). */
  conversation: boolean;
  nbComptesRendus: number | null;
  /** Phase 2 : d'où vient l'état réel (Upstash, mémoire locale) et quand il a été lu. */
  reel: { source: 'upstash' | 'memoire' | 'hors ligne'; derniere: number | null } | null;
  /** Tâches, Calendrier et Cerveau : les vraies données lues sur /api/qg/vues (jamais dans /demo). */
  vues: VuesQG | null;
  vuesHorsLigne: boolean;
  /** La vraie réunion de crise en cours (ou son débrief), lue sur /api/etat avec l'état des agents. Jamais dans /demo. */
  reunion: ReunionScene | null;
  setSnap: (s: Snapshot) => void;
  select: (id: string | null) => void;
  showToast: (t: string) => void;
  setMode: (m: Mode) => void;
  nextCalque: () => void;
  toggleEtiquettes: () => void;
  /** Les sons du jardin (oiseaux le jour, un grillon la nuit) : coupés par défaut, retenus dans ce navigateur. */
  sons: boolean;
  setHoverAgent: (id: string | null) => void;
  setHoverRoom: (id: string | null) => void;
  setFocus: (id: string | null) => void;
  setOnglet: (o: Onglet) => void;
  ouvrir: (v: Volet) => void;
  setFormat: (f: Format) => void;
  setArrivee: (ouvert: boolean) => void;
  setNbComptesRendus: (n: number | null) => void;
  /** Le mode démo, pour filmer : adresse /demo, bulles visibles, bureau plus animé. */
  setDemo: (moment: Mode) => void;
  revenir: () => void;
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useQG = create<State>((set, get) => ({
  snap: null,
  selected: null,
  toast: null,
  mode: 'calme',
  version: 0,
  arrivee: false,
  conversation: false,
  nbComptesRendus: null,
  calque: 'aucun',
  etiquettes: 'survol',
  sons: false,
  hoverAgent: null,
  hoverRoom: null,
  focus: null,
  onglet: 'bureau',
  volet: null,
  format: 'large',
  demo: false,
  nuit: false,
  horloge: instantAbidjan(Date.now(), null),
  heureDemo: null,
  debutDemo: null,
  jourDemo: null,
  hoverHorloge: false,
  reel: null,
  vues: null,
  vuesHorsLigne: false,
  reunion: null,
  setSnap: snap => set({ snap }),
  select: selected => set(selected ? { selected, volet: null } : { selected }),
  showToast: toast => {
    clearTimeout(toastTimer);
    set({ toast });
    toastTimer = setTimeout(() => set({ toast: null }), 3200);
  },
  setMode: mode => {
    if (mode === get().mode) return;
    engine = new Engine(mode, options());
    set({ mode, version: get().version + 1, snap: engine.snapshot(), selected: null });
  },
  nextCalque: () => {
    const order: Calque[] = ['aucun', 'calme', 'pleine'];
    set({ calque: order[(order.indexOf(get().calque) + 1) % order.length] });
  },
  toggleEtiquettes: () => set({ etiquettes: get().etiquettes === 'survol' ? 'toujours' : 'survol' }),
  setHoverAgent: hoverAgent => set({ hoverAgent }),
  setHoverRoom: hoverRoom => { if (get().hoverRoom !== hoverRoom) set({ hoverRoom }); },
  setFocus: focus => { resetVue(); set({ focus: get().focus === focus ? null : focus }); },
  setOnglet: onglet => {
    const suivant = get().onglet === onglet ? 'bureau' : onglet;
    // un onglet et le bureau de L (ou le relevé de Light) prennent la même place : l'un ferme l'autre
    set(suivant !== 'bureau' && estBureau(get().volet) ? { onglet: suivant, volet: null } : { onglet: suivant });
  },
  ouvrir: volet => set(!volet ? { volet } : estBureau(volet) ? { volet, selected: null, onglet: 'bureau' } : { volet, selected: null }),
  setDemo: moment => {
    vif = true;
    engine = new Engine(moment, options());
    set({ demo: true, mode: moment, version: get().version + 1, snap: engine.snapshot(), calque: 'aucun' });
  },
  setArrivee: arrivee => { if (get().arrivee !== arrivee) set({ arrivee }); },
  setNbComptesRendus: nbComptesRendus => { if (get().nbComptesRendus !== nbComptesRendus) set({ nbComptesRendus }); },
  setFormat: format => { if (get().format !== format) set({ format }); },
  /** Échap : tout fermer et revenir à la vue d'ensemble. */
  revenir: () => { resetVue(); set({ selected: null, focus: null, volet: null, onglet: 'bureau', arrivee: false }); },
}));
