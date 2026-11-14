import { FIG_SEATS, MEETING_SEATS, POI, ROOMS, SEATS, roomAt, type Pt } from '@/data/layout';
import {
  BULLES_VIE, CABINES_WC, chemin, CIBLES, creneauA, ECHANGES_RDV, HAMAC, PLACES_PANIERS, placeDeBase, planDuJour, ROUTE, TERRAINS,
  TOUR_DU_POTAGER, versTerrain, type Creneau, type PlanJour, type Sport, type Terrain,
} from './vie';
import { AGENTS, agentById, routeMission } from './routing';
import { choisirAuditeur, type Choix } from './ecoute';
import { presentLaNuit } from './horaire';
import { bullesReunion, enCours, participantsDe, phaseA, titreSalle, type Phase, type ReunionScene } from '@/data/crise';
import {
  AU_REVOIRS, BONJOURS, BULLES_DEJEUNER, dejeuneDehors, echangesA, energieA, ENERGIES, hash01, heuresDuRepas,
  jourDe, minutesPrecises, momentA, pauseCafe, relanceA, type Energie, type MomentJour,
} from './journee';

// Le moteur de simulation : il fait vivre le bureau tant qu'il n'y a pas de données réelles.
// Il ne connaît ni React ni Three.js ; la scène lit ses positions, les panneaux lisent son instantané.

export type SimAgent = {
  id: string;
  look: string; // clé du sprite
  named: boolean; // un des 16 agents (sinon : figurant)
  home: Pt;
  x: number; y: number;
  path: Pt[];
  wait: number;
  still?: boolean;
  scripted?: boolean;
  step: number;
  errand?: Errand | null;
  facing: 1 | -1;
  /** Il arrive (de l'entrée à son poste) ou il part (de son poste à l'entrée). */
  sortie?: 'arrive' | 'part' | null;
  /** Il déjeune à la Cuisine (ou dans sa salle à manger) ou en salle de pause. */
  dejeune?: boolean;
  /** Il est (ou va) en salle de réunion pour une vraie réunion de crise. */
  reunion?: boolean;
  /** Ce qu'il fait de sa journée en ce moment (vie.ts) : toilettes, match, paniers, sieste, potager, café à deux… */
  activite?: EnCours | null;
};

/** Une activité de la journée : on y va (`aller`), puis on y est (`la`) ; `etape` : le tour du potager. */
type EnCours = { c: Creneau; phase: 'aller' | 'la'; etape: number };
type P3 = [number, number, number];
/** Le ballon d'un match ou des paniers de midi : porté (aux pieds, en dribble) ou en l'air (une passe, un tir). */
type Vol = { de: P3; a: P3; t: number; duree: number; haut: number; vers: string | null; tir?: { cible: P3; tireur: string } };
type Jeu = { cle: string; sport: Sport | 'paniers'; terrain: Terrain; ballon: P3; vol: Vol | null; porteur: string | null; prochaine: number };

type Errand = { p: Pt; txt?: string; dwell: [number, number] };
type Step = { go?: Pt | 'home'; wait?: number; say?: string; tools?: string[]; on?: (e: Engine) => void };

export type Bubble = { id: number; agentId: string; label: string; text: string; until: number; /** inventée par la simulation */ simulee?: boolean };

/**
 * Deux bulles se recouvriraient à l'écran (vue d'ensemble, plan isométrique 2:1, 15 points par case) : une bulle fait
 * jusqu'à ~130 points de large et ~34 de haut, posée au-dessus de la tête. Sert à ne pas en lancer une trop près d'une autre.
 */
export const BULLE_ECART = { x: 130, y: 36 };
export function bullesProches(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = 15 * ((a.x - a.y) - (b.x - b.y)), dy = 7.5 * ((a.x + a.y) - (b.x + b.y));
  return Math.abs(dx) < BULLE_ECART.x && Math.abs(dy) < BULLE_ECART.y;
}

/** Une tâche du QG : une mission que je donne, ou le travail régulier d'une routine. */
export type Tache = { id: number; quand: number; agentId: string; texte: string; statut: 'en cours' | 'faite'; origine: 'moi' | 'routine'; finT?: number };
/** Une utilisation d'outil par un agent, pour le panneau de chaque outil. */
export type Usage = { tool: string; agentId: string; quand: number };

/** Les deux moments de mes plans : plan-open-space.png (calme) et plan-open-space-rempli.png (pleine journée). */
export type Mode = 'calme' | 'pleine';

export type Snapshot = {
  bubbles: Omit<Bubble, 'until'>[];
  lit: string[];
  rooms: Record<string, string>;
  count: number;
  studioOn: boolean;
  tasks: Record<string, string>;
  /** Les agents qui ont écrit un état réel récemment (phase 2). */
  reels: string[];
  /** L'agent qui danse au son de mon vrai Spotify (un morceau en lecture), s'il y en a un. */
  danse: string[];
  taches: Tache[];
  usages: Usage[];
  /** Page privée : le titre de la salle pendant une vraie réunion de crise (« Réunion de crise · Livreo en panne depuis 14 min »). */
  salle: string | null;
};

const SPEED = 2.2; // cases par seconde
export const MAX_BUBBLES = 3;

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Les places du déjeuner (layout.ts) : une de la Cuisine, une de la salle de pause, et ainsi de suite ; une personne par place. */
export const PLACES_DEJEUNER: Pt[] = (() => {
  const { dejeunerCafe: cafe, dejeunerPause: pause } = POI, out: Pt[] = [];
  for (let i = 0; i < Math.max(cafe.length, pause.length); i++) { if (cafe[i]) out.push(cafe[i]); if (pause[i]) out.push(pause[i]); }
  return out;
})();

const ERRANDS: Errand[] = [
  ...POI.cafe.map(p => ({ p, txt: 'un café et j\'y retourne', dwell: [4, 8] as [number, number] })),
  { p: POI.imprimante, txt: 'récupère une impression', dwell: [2, 4] },
  { p: POI.sieste, txt: 'petite sieste de 10 min', dwell: [6, 10] },
  ...POI.babyfoot.map(p => ({ p, txt: 'une partie de baby-foot ?', dwell: [5, 9] as [number, number] })),
  // (les toilettes ont leurs vraies visites, 2 à 3 par jour : vie.ts)
  ...POI.cabines.map(p => ({ p, txt: 'un appel rapide', dwell: [8, 16] as [number, number] })),
  { p: POI.tele, txt: 'je regarde les infos deux minutes', dwell: [8, 14] },
  { p: POI.arcade, txt: 'une partie d\'arcade ?', dwell: [8, 14] },
  ...POI.reunion.map(p => ({ p, dwell: [6, 12] as [number, number] })),
];
/** La pause café de 16 h : seulement le café. */
const ERRANDS_CAFE = ERRANDS.filter(e => POI.cafe.includes(e.p));
/** Au déjeuner, le café et la salle de pause sont pris (une personne par place) : les courses vont ailleurs. */
const ERRANDS_MIDI = ERRANDS.filter(e => !POI.cafe.includes(e.p) && e.p !== POI.sieste && !POI.babyfoot.includes(e.p) && e.p !== POI.tele && e.p !== POI.arcade);
/** Un petit échange entre deux collègues proches : les répliques alternent, une toutes les ~2,6 s. */
type Echange = { a: string; b: string; lignes: string[]; i: number; prochaine: number };
const REPLIQUE = 2.6;
const FENETRE_ARRIVEE = 6; // minutes : à l'ouverture de la page, ceux arrivés depuis plus longtemps sont déjà à leur poste

const SCRIPTS: Record<string, Step[]> = {
  L: [
    { wait: 9, say: 'rédige le post de mercredi', tools: ['in', 'C'] },
    { go: POI.scene, on: e => (e.studioOn = true) },
    { wait: 9, say: 'tourne la vidéo du post de mercredi', tools: ['in'] },
    { go: 'home', on: e => (e.studioOn = false) },
    { wait: 14 },
  ],
  tom: [{ wait: 9.4 }, { go: POI.camera }, { wait: 8.6, tools: ['Cu'] }, { go: 'home' }, { wait: 14 }],
  ye: [
    { wait: 16, tools: ['Sa'] },
    { go: POI.guichet },
    { wait: 4, say: 'dépose le post de L au bureau des accords', tools: ['Tg'], on: e => e.accords.pending++ },
    { wait: 2, on: e => { e.accords.pending--; e.accords.ok++; } },
    { go: 'home' },
    { wait: 12 },
  ],
  // Feu (/demo) : il lit le marché et attend ; jamais un prix ni un montant, même inventé
  feu: [
    { wait: 11, say: 'lit les bougies 4h et 1h de BTC et ETH', tools: ['Bi'] },
    { wait: 7, say: 'on attend : il manque une condition' },
    { wait: 14, tools: ['Bi'] },
  ],
  kuroro: [
    { wait: 6, say: 'répartit les missions du jour', tools: ['C'] },
    { go: POI.centreComm },
    { wait: 3, say: 'fait le tour des pôles' },
    { go: POI.coinCode }, { wait: 2.5 },
    { go: POI.coinMac }, { wait: 2.5 },
    { go: POI.cafe[2] }, { wait: 3 },
    { go: 'home' }, { wait: 10 },
  ],
};

export class Engine {
  readonly mode: Mode;
  /** Mode démo (pour filmer) : bureau plus animé. */
  readonly vif: boolean;
  /**
   * Page privée : les vrais agents (L, Light, Clara) ne disent que leur vrai travail. La simulation les fait bouger
   * (décor) mais ne leur fait jamais « dire » une tâche inventée, et n'écrit pas de fausse tâche sur leur fiche.
   */
  readonly muets: ReadonlySet<string>;
  /** Page privée (pas /demo) : seule elle reçoit les vraies réunions de crise. */
  readonly prive: boolean;
  agents: SimAgent[] = [];
  t = 0;
  bubbles: Bubble[] = [];
  lit: Record<string, number> = {};
  accords = { pending: 2, ok: 0, ko: 0 };
  studioOn = false;
  tasks: Record<string, string> = {};
  taches: Tache[] = [];
  usages: Usage[] = [];
  reels = new Map<string, number>(); // agent → heure de son dernier état réel
  /** Ce que j'écoute sur mon vrai Spotify : l'agent qui a le casque et ce que sa fiche affiche. */
  ecoute: { agentId: string; texte: string; finT: number } | null = null;
  /** L'agent dont le compte rendu est ouvert : il salue à son poste. */
  salut: string | null = null;
  /** La nuit à Abidjan (page privée) : bureau fermé, seuls ceux qui travaillent vraiment restent (voir horaire.ts). */
  nuit = false;
  /** Luffy, le veilleur de nuit, vérifie vraiment les sites (lu sur /api/qg/vues). */
  luffyVeille = false;
  /** L'agent d'astreinte de la semaine (lu sur /api/qg/vues) : présent la nuit, sans être « au travail ». */
  astreinte: string | null = null;
  /** agent → heure de son dernier état réel « au travail » (les autres statuts l'effacent). */
  travail = new Map<string, number>();
  /**
   * La vraie réunion de crise (page privée, lue sur /api/etat), ou null. Jamais inventée par la simulation, jamais dans
   * /demo : sans elle, la salle de réunion vit comme avant.
   */
  reunion: ReunionScene | null = null;
  /** Ce que la réunion demande maintenant (recalculé à chaque image) : qui y va, et si c'est le moment d'être en salle. */
  private salle: { ouverte: boolean; phase: Phase | null; participants: string[] } = { ouverte: false, phase: null, participants: [] };
  private prochaineBulleSalle = 0;
  private assisSalle = '';
  /**
   * L'heure d'Abidjan donnée par la page (minutes UTC, avec fraction) et le jour : la journée qui vit (journee.ts).
   * null tant que la page ne l'a pas donnée : la pleine énergie du matin, tout le monde là (comme avant).
   */
  minutes: number | null = null;
  jour = 0;
  /** Ceux qui ne sont pas (encore, ou plus) au bureau : pas arrivés, ou déjà partis (Moment calme). */
  horsService = new Set<string>();
  /** Les arrivées et les départs à venir, un par un par l'entrée. */
  private file: { id: string; type: 'arrive' | 'part' }[] = [];
  private prochaineSortie = 0;
  private prochaineRelance = 18;
  private prochainEchange = 6;
  /** L'échange en cours entre deux collègues proches, s'il y en a un. */
  echange: Echange | null = null;
  private repas = new Map<string, { place: Pt; va: number; revient: number }>();
  /** Le programme du jour (vie.ts) : qui vient, en voiture ou à pied, les toilettes, les matchs, la sieste, le potager… */
  plan: PlanJour | null = null;
  /** Les matchs et les paniers en cours : le ballon de chacun. */
  jeux = new Map<string, Jeu>();
  private prochainRdv = new Map<string, number>();
  private repasJour = -1;
  private choixEcoute: Choix | null = null;
  private nextBubble = 1;
  private nextTache = 1;
  private lastUse: Record<string, number> = {};

  constructor(mode: Mode = 'calme', opts: { vif?: boolean; muets?: readonly string[]; prive?: boolean; heure?: number } = {}) {
    this.mode = mode;
    this.vif = !!opts.vif;
    this.muets = new Set(opts.muets ?? []);
    this.prive = !!opts.prive;
    for (const a of AGENTS) {
      const home = SEATS[a.id];
      if (!home) continue;
      this.agents.push({ id: a.id, look: a.id, named: true, home, x: home[0], y: home[1], path: [], wait: rnd(2, 10), step: -1, facing: 1, scripted: !!SCRIPTS[a.id] });
      this.tasks[a.id] = a.tache;
    }
    FIG_SEATS.forEach((p, i) => this.agents.push({ id: `fig${i}`, look: `fig${i}`, named: false, home: p, x: p[0], y: p[1], path: [], wait: rnd(2, 14), step: -1, facing: 1 }));
    const fixe = (id: string, p: Pt, i: number) => this.agents.push({ id, look: `fig${i}`, named: false, home: p, x: p[0], y: p[1], path: [], wait: 0, step: -1, facing: 1, still: true });
    fixe('barista', POI.barista, 4);
    fixe('guichetier', POI.guichetier, 2);
    // deux collègues qui discutent dans le couloir, comme sur mes plans
    fixe('couloir', POI.couloir[0], 7);
    fixe('couloir2', POI.couloir[1], 3);
    // page privée : pas d'historique inventé (tâches, utilisations d'outils) ; seulement ce que font les vrais agents
    if (!opts.prive) this.historique();
    if (mode === 'pleine') this.pleineJournee();
    else for (const a of this.agents) if (a.scripted) this.nextStep(a);
    if (opts.heure !== undefined) this.setHeure(opts.heure);
  }

  /** Un historique jamais vide (mode démo) : tâches en cours, tâches faites, dernières utilisations des outils. */
  private historique() {
    const now = Date.now(), min = 60_000;
    const enCours: [string, string][] = [
      ['L', 'rédiger le post de mercredi'], ['mafe', 'préparer le point du matin'], ['luffy', 'vérifier que les sites répondent'],
      ['lea', 'relire le dernier commit'], ['light', 'lister les nouvelles versions de la semaine'], ['zoro', 'passer les alertes de sécurité'],
      ['ye', 'mettre à jour une fiche du portfolio'], ['isaac', 'mesurer la place libre sur le disque'], ['clara', 'trier les mails de la semaine'],
    ];
    enCours.forEach(([agentId, texte], i) => this.taches.push({ id: this.nextTache++, quand: now - (i + 1) * 7 * min, agentId, texte, statut: 'en cours', origine: 'routine' }));
    const faites: [string, string, number][] = [
      ['luffy', 'tous les sites répondent', 40], ['mafe', 'point du matin affiché', 180], ['paul', 'README mis à jour', 120], ['L', 'post de lundi publié après mon accord', 1500],
    ];
    faites.forEach(([agentId, texte, m]) => this.taches.push({ id: this.nextTache++, quand: now - m * min, agentId, texte, statut: 'faite', origine: 'routine' }));
    // les outils qu'aucun agent n'a encore en propre ont aussi leur historique (mode démo)
    const autres: [string, string][] = [['Up', 'mafe'], ['Up', 'kuroro'], ['Pr', 'lea'], ['Pr', 'stalker'], ['Ne', 'luffy'], ['Ne', 'zoro'], ['Ex', 'stalker'], ['▲', 'paul'], ['Sa', 'L'],
      ['Tg', 'L'], ['Tg', 'ye'], ['Tg', 'luffy'], ['Gm', 'L'], ['No', 'kuroro'], ['Sp', 'stalker'], ['Sp', 'paul'], ['Sp', 'tom'], ['Sp', 'isaac']];
    autres.forEach(([tool, agentId], i) => this.usages.push({ tool, agentId, quand: now - (12 + i * 23) * min }));
    let k = 7;
    for (const a of AGENTS) for (const tool of a.outils) for (let i = 0; i < 2; i++) {
      k = (k * 31 + 17) % 233;
      this.usages.push({ tool, agentId: a.id, quand: now - (5 + k) * min });
    }
  }

  /** La pleine journée de mon plan rempli : réunion pleine, café plein, L et Tom au studio, Ye aux accords. */
  /** Pleine journée (demande du 10 novembre) : tout le monde à son poste, immobile ; la réunion est pleine. */
  private pleineJournee() {
    // les deux collègues du couloir retournent à leur poste : personne debout dans les couloirs
    this.agents = this.agents.filter(a => a.id !== 'couloir' && a.id !== 'couloir2');
    for (const a of this.agents) { a.x = a.home[0]; a.y = a.home[1]; a.still = true; a.scripted = false; a.path = []; }
    MEETING_SEATS.slice(0, 7).forEach((p, i) => this.agents.push({ id: `reu${i}`, look: `fig${20 + i}`, named: false, home: p, x: p[0], y: p[1], path: [], wait: 0, step: -1, facing: 1, still: true }));
    this.accords = { pending: 2, ok: 5, ko: 0 };
    this.tache('L', 'rédige le post de mercredi');
    this.tasks.kuroro = 'répartit les missions du jour';
    this.say('kuroro', 'répartit les missions du jour', Infinity, true);
    this.simule('L', 'rédige le post de mercredi', Infinity, true);
  }

  get(id: string) { return this.agents.find(a => a.id === id); }
  atHome(a: SimAgent) { return a.x === a.home[0] && a.y === a.home[1]; }

  /** Affiche une bulle ; au-delà de 3, refusée (sauf `force`, qui remplace la plus ancienne). */
  say(agentId: string, text: string, dur = 5, force = false): boolean {
    this.bubbles = this.bubbles.filter(b => b.agentId !== agentId);
    if (this.bubbles.length >= MAX_BUBBLES) {
      if (!force) return false;
      // la plus ancienne s'efface, mais pas celle de l'échange en cours (il garde la priorité)
      const i = this.bubbles.findIndex(b => !this.enEchange(b.agentId));
      this.bubbles.splice(i < 0 ? 0 : i, 1);
    }
    const a = agentById(agentId);
    // un figurant n'a pas de nom : on dit où il est (les deux du couloir, le barista) ou « un collègue »
    const label = a ? a.nom : agentId.startsWith('couloir') ? 'dans le couloir' : agentId === 'barista' ? 'en cuisine' : agentId === 'guichetier' ? 'au guichet' : 'un collègue';
    this.bubbles.push({ id: this.nextBubble++, agentId, label, text, until: this.t + dur });
    return true;
  }

  /**
   * Une bulle inventée par la simulation : jamais au-dessus d'un vrai agent dans la page privée, et jamais trop près
   * d'une bulle déjà affichée (deux bulles ne se recouvrent pas à l'écran ; l'échange en cours garde la priorité).
   */
  private simule(agentId: string, text: string, dur = 5, force = false) {
    if (this.muets.has(agentId) || !this.visible(agentId) || this.bulleVoisine(agentId)) return false;
    const ok = this.say(agentId, text, dur, force);
    if (ok) this.bubbles[this.bubbles.length - 1].simulee = true;
    return ok;
  }

  /** Une autre bulle (d'un autre personnage) tomberait sur celle de cet agent à l'écran. */
  private bulleVoisine(agentId: string, sauf: readonly string[] = []) {
    const a = this.get(agentId);
    return !!a && this.bubbles.some(b => b.agentId !== agentId && !sauf.includes(b.agentId) && this.bullesSeTouchent(a, b.agentId));
  }

  private bullesSeTouchent(a: SimAgent, autreId: string) {
    const b = this.get(autreId);
    return !!b && this.present(b.id) && bullesProches(a, b);
  }

  /** Une tâche inventée par la simulation : jamais sur la fiche d'un vrai agent dans la page privée. */
  private tache(agentId: string, texte: string) {
    if (!this.muets.has(agentId)) this.tasks[agentId] = texte;
  }

  /**
   * Allume l'icône d'un outil. Décision du patron (9 novembre 2026) : seuls les outils VRAIMENT utilisés par un
   * agent réel s'allument (`reel`) ; la simulation ne les allume plus, pour ne jamais faire croire qu'un outil marche.
   */
  light(tool: string, s = 2.5, agentId?: string, reel = false) {
    if (!reel) return;
    this.lit[tool] = Math.max(this.lit[tool] ?? 0, this.t + s);
    if (!agentId) return;
    const key = `${agentId}:${tool}`;
    if (this.t - (this.lastUse[key] ?? -Infinity) < 20) return; // une utilisation notée toutes les 20 s au plus
    this.lastUse[key] = this.t;
    this.usages.push({ tool, agentId, quand: Date.now() });
    if (this.usages.length > 300) this.usages.splice(0, this.usages.length - 300);
  }

  private walkers() { return this.agents.filter(a => a.path.length && !a.scripted).length; }

  /** Dedans comme dehors (le terrain, le hamac, le potager, le parking) : vie.ts trace le chemin. */
  private goTo(a: SimAgent, p: Pt) {
    const path = chemin([a.x, a.y], p);
    a.path = path.length ? path : [];
  }

  private nextStep(a: SimAgent) {
    const sc = SCRIPTS[a.id];
    a.step = (a.step + 1) % sc.length;
    const s = sc[a.step];
    s.on?.(this);
    if (s.go) { this.goTo(a, s.go === 'home' ? a.home : s.go); a.wait = 0; if (!a.path.length) a.wait = 0.5; }
    else {
      // les agents à scénario suivent l'énergie du moment : plus lents dans le coup de mou de l'après-midi
      a.wait = (s.wait ?? 1) * (this.energie().attente[0] / ENERGIES.matinee.attente[0]);
      if (s.say) { this.simule(a.id, s.say, Math.min(a.wait, 7), true); this.tache(a.id, s.say); }
      (s.tools ?? []).forEach(k => this.light(k, a.wait, a.id));
    }
  }

  /** Jour ou nuit (page privée, vérifié chaque minute). La nuit, chacun rentre : le studio s'éteint. */
  setNuit(nuit: boolean) {
    if (nuit === this.nuit) return;
    this.nuit = nuit;
    if (nuit) this.studioOn = false;
  }

  setLuffyVeille(veille: boolean) {
    this.luffyVeille = veille;
  }

  setAstreinte(id: string | null) {
    this.astreinte = id;
  }

  /** La vraie réunion de crise lue sur /api/etat (page privée seulement ; /demo l'ignore). */
  setReunion(r: ReunionScene | null, now = Date.now()) {
    this.reunion = this.prive ? r : null;
    this.majSalle(now);
  }

  /**
   * Qui va en salle : les participants (incident, crise, ou la nuit Kuroro et l'agent d'astreinte), au début, à chaque
   * point (xx:00, xx:30) et au débrief ; entre deux, chacun à son poste.
   */
  private majSalle(now: number) {
    const r = this.reunion;
    if (!r || !enCours(r, now)) { this.salle = { ouverte: false, phase: null, participants: [] }; return; }
    const participants = participantsDe(r.niveau, r.agents, this.nuit, this.astreinte).filter(id => this.get(id)).slice(0, MEETING_SEATS.length);
    this.salle = { ouverte: true, phase: phaseA(r, now), participants };
  }

  /** Sa place à la table si c'est le moment d'être en salle ; un vrai agent en vraie tâche reste à son poste. */
  private siege(id: string, now = Date.now()): Pt | null {
    if (!this.salle.phase) return null;
    const i = this.salle.participants.indexOf(id);
    if (i < 0 || this.travailleVraiment(id, now)) return null;
    return MEETING_SEATS[i];
  }

  /** Il rejoint sa place en salle de réunion (directement s'il ne marche pas : Pleine journée, pas encore arrivé). */
  private allerEnSalle(a: SimAgent, p: Pt, st: number) {
    a.reunion = true; a.errand = null; a.dejeune = false; a.sortie = null; a.activite = null;
    if (this.enEchange(a.id)) this.echange = null;
    if (a.x === p[0] && a.y === p[1]) { a.path = []; return; }
    if (a.still || this.horsService.has(a.id)) { a.path = []; a.x = p[0]; a.y = p[1]; return; }
    const fin = a.path[a.path.length - 1];
    if (!fin || fin[0] !== p[0] || fin[1] !== p[1]) {
      this.goTo(a, p);
      if (!a.path.length) { a.x = p[0]; a.y = p[1]; return; }
    }
    const [tx, ty] = a.path[0];
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
    if (Math.abs(dx - dy) > 1e-3) a.facing = dx - dy > 0 ? 1 : -1;
    if (d <= st) { a.x = tx; a.y = ty; a.path.shift(); } else { a.x += (dx / d) * st; a.y += (dy / d) * st; }
  }

  /** Le point est fini : il retourne à son poste. */
  private retourDeSalle(a: SimAgent) {
    a.reunion = false; a.path = []; a.wait = 1;
    if (a.still || this.nuit || this.horsService.has(a.id)) { a.x = a.home[0]; a.y = a.home[1]; return; }
    this.goTo(a, a.home);
    if (!a.path.length) { a.x = a.home[0]; a.y = a.home[1]; }
  }

  /** Les bulles de la salle, tirées du vrai problème : toutes les 10 s pendant qu'on y est assis, et à chaque arrivée. */
  private bullesSalle(now: number) {
    if (!this.salle.phase || !this.reunion) { this.assisSalle = ''; return; }
    const assis = this.salle.participants.filter(id => { const a = this.get(id), p = this.siege(id, now); return !!a && !!p && a.x === p[0] && a.y === p[1]; });
    const cle = assis.join();
    if (!assis.length || (this.t < this.prochaineBulleSalle && cle === this.assisSalle)) return;
    this.assisSalle = cle;
    // les bulles d'avant (d'autres places) s'effacent : celles de la salle disent où on en est maintenant
    this.bubbles = this.bubbles.filter(b => !assis.includes(b.agentId));
    for (const b of bullesReunion(this.reunion, now, assis)) this.say(b.agentId, b.texte, 9, true);
    this.prochaineBulleSalle = this.t + 10;
  }

  /**
   * La nuit, seulement qui travaille vraiment (horaire.ts). Le jour, ceux qui sont arrivés et pas encore partis ;
   * un vrai agent en vraie tâche est là quelle que soit l'heure (avant son arrivée ou après son départ simulés).
   */
  present(id: string, now = Date.now()) {
    // une vraie réunion en cours : les participants sont là (même la nuit, même hors de leurs heures) ; la salle est à eux
    if (this.salle.ouverte) {
      if (id.startsWith('reu')) return false;
      if (this.salle.participants.includes(id)) return true;
    }
    if (this.nuit) return presentLaNuit(id, { travail: this.travail, luffyVeille: this.luffyVeille, astreinte: this.astreinte, now });
    return !this.horsService.has(id) || this.travailleVraiment(id, now);
  }

  /** Un vrai agent en vraie tâche (« au travail » depuis moins de 30 min), Luffy qui veille, Stalker avec Claude Code. */
  travailleVraiment(id: string, now = Date.now()) {
    return presentLaNuit(id, { travail: this.travail, luffyVeille: this.luffyVeille, astreinte: null, now });
  }

  /** Le moment de la journée (Moment calme) ; sans heure donnée, la pleine énergie du matin. */
  moment(): MomentJour {
    if (this.nuit) return 'nuit';
    return this.minutes === null ? 'matinee' : momentA(this.minutes);
  }

  /** L'énergie du moment, en douceur d'un moment à l'autre ; « Pleine journée » garde la sienne (personne ne bouge). */
  energie(): Energie {
    if (this.nuit) return ENERGIES.nuit;
    return this.minutes === null ? ENERGIES.matinee : energieA(this.minutes);
  }

  /** La journée suit l'heure seulement en « Moment calme », et seulement quand la page l'a donnée. */
  private journee() { return this.mode === 'calme' && this.minutes !== null; }

  /**
   * L'heure d'Abidjan (la page la donne chaque minute ; /demo, l'heure de ?heure=). La première fois (ou après un saut),
   * ceux déjà arrivés sont directement à leur poste et ceux qui déjeunent directement à table ; ceux arrivés il y a
   * moins de 6 min entrent encore par la porte, un par un.
   */
  setHeure(ms: number) {
    const minutes = minutesPrecises(ms), jour = jourDe(ms);
    const initial = this.minutes === null || jour !== this.jour || Math.abs(minutes - this.minutes) > 10;
    if (!initial && Math.floor(minutes) === Math.floor(this.minutes!)) return;
    this.minutes = minutes; this.jour = jour;
    if (this.mode !== 'calme') return;
    this.majJournee(initial);
  }

  private majJournee(initial: boolean) {
    const m = this.minutes!, jour = this.jour;
    const fenetre = initial ? FENETRE_ARRIVEE : Infinity;
    const enFile = (id: string) => this.file.some(f => f.id === id);
    const nouveaux: { id: string; type: 'arrive' | 'part'; quand: number }[] = [];
    if (initial) this.file = [];
    if (this.plan?.jour !== jour) {
      this.plan = planDuJour(jour, this.agents.map(a => ({ id: a.id, still: a.still, scripted: a.scripted })));
      this.jeux.clear();
    }
    for (const a of this.agents) {
      const pr = this.plan.presence.get(a.id);
      const hors = this.horsService.has(a.id);
      // pas là aujourd'hui (le week-end, environ un tiers vient)
      if (!pr) { if (!hors) { this.dehors(a); a.sortie = null; a.dejeune = false; } continue; }
      const arr = pr.arrivee, dep = pr.depart;
      if (m < arr) {
        // pas encore arrivé (page ouverte tôt, ou nouveau jour) : il attend dehors
        if (!hors) { this.dehors(a); a.sortie = null; a.dejeune = false; }
      } else if (m < dep) {
        if (enFile(a.id) || a.sortie === 'arrive') continue;
        if (m - arr >= fenetre) {
          if (hors) { this.horsService.delete(a.id); this.aSonPoste(a); a.wait = rnd(1, 8); }
        } else if (hors || initial) {
          // à l'ouverture de la page, ceux arrivés il y a moins de 6 min sont encore dehors : ils entrent par la porte
          if (!hors) { this.dehors(a); a.sortie = null; }
          nouveaux.push({ id: a.id, type: 'arrive', quand: arr });
        }
      } else {
        if (hors || enFile(a.id) || a.sortie === 'part') continue;
        // en plein match (ou au potager) : il partira de là, à la fin (finirActivite)
        if (a.activite && !initial) continue;
        if (m - dep >= fenetre) { this.dehors(a); a.sortie = null; a.dejeune = false; }
        else nouveaux.push({ id: a.id, type: 'part', quand: dep });
      }
    }
    nouveaux.sort((x, y) => x.quand - y.quand).forEach(({ id, type }) => this.file.push({ id, type }));
    if (initial) this.prochaineSortie = this.t;
    this.majRepas(initial);
    if (initial) this.placerActivites();
  }

  /** Le déjeuner : environ la moitié part manger à la Cuisine ou en salle de pause, et y reste longtemps. */
  private majRepas(initial: boolean) {
    const m = this.minutes!, jour = this.jour;
    if (this.repasJour !== jour) {
      this.repasJour = jour;
      this.repas.clear();
      const qui = this.agents.filter(a => !a.still && !a.scripted && dejeuneDehors(a.id, jour)).sort((x, y) => hash01(`${x.id}|${jour}|place`) - hash01(`${y.id}|${jour}|place`));
      qui.slice(0, PLACES_DEJEUNER.length).forEach((a, i) => this.repas.set(a.id, { place: PLACES_DEJEUNER[i], ...heuresDuRepas(a.id, jour) }));
    }
    for (const a of this.agents) {
      const r = this.repas.get(a.id);
      if (!r) continue;
      const aTable = m >= r.va && m < r.revient && !this.horsService.has(a.id) && !a.sortie && !a.activite && !this.travailleVraiment(a.id);
      if (aTable && !a.dejeune) {
        a.dejeune = true;
        a.errand = { p: r.place, dwell: [8, 16] };
        if (initial) { a.path = []; a.x = r.place[0]; a.y = r.place[1]; a.wait = rnd(2, 12); }
        else { this.goTo(a, r.place); if (!a.path.length) { a.x = r.place[0]; a.y = r.place[1]; } }
      } else if (!aTable && a.dejeune) {
        a.dejeune = false; a.errand = null;
        if (!this.horsService.has(a.id) && !a.sortie) { this.goTo(a, a.home); if (!a.path.length) { a.x = a.home[0]; a.y = a.home[1]; } }
      }
    }
  }

  /** Il n'est pas (encore, ou plus) au bureau : invisible à son poste, sans bulle. */
  private dehors(a: SimAgent) {
    this.horsService.add(a.id);
    this.aSonPoste(a);
    this.bubbles = this.bubbles.filter(b => b.agentId !== a.id);
    if (this.echange && (this.echange.a === a.id || this.echange.b === a.id)) this.echange = null;
  }

  /** Fait entrer ou sortir le suivant de la file (un toutes les 3 à 6 s, par l'entrée). */
  private porte() {
    if (!this.file.length || this.t < this.prochaineSortie) return;
    const f = this.file.shift()!;
    const a = this.get(f.id);
    this.prochaineSortie = this.t + rnd(3, 6);
    if (!a) return;
    if (f.type === 'arrive') {
      if (!this.horsService.has(a.id)) return;
      this.horsService.delete(a.id);
      // un vrai agent déjà au travail est déjà à son poste : il ne refait pas l'entrée
      if (this.travailleVraiment(a.id)) { this.aSonPoste(a); return; }
      const pr = this.plan?.presence.get(a.id);
      // venu seulement pour le match (le week-end) : de sa voiture, ou de la route, il file au terrain (vivre)
      if (pr?.terrain) { const d = pr.vehicule ?? ROUTE; a.x = d[0]; a.y = d[1]; a.errand = null; a.sortie = null; a.wait = 0; return; }
      // en voiture, à moto, à vélo : il apparaît au parking et marche jusqu'à la porte, puis à son poste
      if (pr?.vehicule) { a.x = pr.vehicule[0]; a.y = pr.vehicule[1]; } else { a.x = POI.entree[0] + rnd(-0.3, 0.3); a.y = POI.entree[1] + rnd(-0.15, 0.15); }
      a.errand = null; a.sortie = 'arrive'; a.step = -1;
      this.goTo(a, a.home);
      if (!a.path.length) { a.sortie = null; this.aSonPoste(a); }
      return;
    }
    if (this.horsService.has(a.id) || a.sortie) return;
    // un vrai agent en vraie tâche reste à son poste ; il partira quand il aura fini (vérifié chaque minute)
    if (this.travailleVraiment(a.id)) return;
    // en pleine réunion de crise, ou dans une activité (toilettes, potager…) : il partira après
    if (a.reunion || a.activite) { this.file.push(f); this.prochaineSortie = this.t + 1; return; }
    // un agent à scénario part de son poste, entre deux scènes (L ne quitte pas le studio en plein tournage)
    if (a.scripted && (!this.atHome(a) || a.path.length)) { this.file.push(f); this.prochaineSortie = this.t + 1; return; }
    if (Math.random() < 0.3) this.simule(a.id, pick(AU_REVOIRS), 3.5);
    this.partir(a);
  }

  /** Il rentre chez lui : jusqu'à la porte, ou jusqu'à sa voiture (sa moto, son vélo), ou la route ; puis il disparaît. */
  private partir(a: SimAgent) {
    if (a.id === 'L') this.studioOn = false;
    if (this.enEchange(a.id)) this.echange = null;
    a.errand = null; a.dejeune = false; a.sortie = 'part'; a.activite = null;
    const pr = this.plan?.presence.get(a.id);
    this.goTo(a, pr?.vehicule ?? (pr?.terrain ? ROUTE : POI.entree));
    if (!a.path.length) { a.sortie = null; this.dehors(a); }
  }

  /** Ceux qui peuvent bavarder : là, assis ou arrêtés, ni scénario, ni vrai agent muet, ni vrai agent en vraie tâche. */
  private bavard(a: SimAgent) {
    // (dans une activité, on ne bavarde pas, sauf assis à son café à deux ou à son point avec Kuroro)
    const rdv = a.activite?.c.act.type === 'rdv' && a.activite.phase === 'la';
    return this.present(a.id) && !this.horsService.has(a.id) && !a.path.length && !a.sortie && (!a.scripted || rdv) && !a.reunion
      && (!a.activite || rdv) && !this.muets.has(a.id) && !this.travailleVraiment(a.id) && !this.surPlace(a.id);
  }

  /** Les deux sont proches : même pièce (ou tous deux dans le couloir), à moins de 2,6 cases. */
  private proches(a: SimAgent, b: SimAgent) {
    return roomAt(a.x, a.y)?.id === roomAt(b.x, b.y)?.id && Math.hypot(a.x - b.x, a.y - b.y) <= 2.6;
  }

  /** Un petit échange entre deux collègues proches, sur un sujet du moment. Renvoie vrai s'il a commencé. */
  lancerEchange(alea: () => number = Math.random): boolean {
    if (this.echange || this.nuit) return false;
    const sujets = echangesA(this.minutes ?? 9 * 60);
    if (!sujets.length) return false;
    const candidats = this.agents.filter(a => this.bavard(a));
    // on mélange, puis on prend le premier qui a un voisin proche
    const ordre = candidats.map(a => ({ a, k: alea() })).sort((x, y) => x.k - y.k).map(x => x.a);
    for (const a of ordre) {
      const voisins = candidats.filter(b => b !== a && this.proches(a, b));
      if (!voisins.length) continue;
      const b = voisins[Math.floor(alea() * voisins.length)];
      const lignes = sujets[Math.floor(alea() * sujets.length)];
      // pas d'échange là où une autre bulle est déjà affichée (ni au-dessus de l'un, ni de l'autre)
      if (this.bulleVoisine(a.id, [b.id]) || this.bulleVoisine(b.id, [a.id])) continue;
      // celui qui va répondre se tait d'abord : sa bulle d'avant s'efface (pas deux bulles côte à côte)
      const sienne = this.bubbles.find(x => x.agentId === b.id);
      if (sienne && !sienne.simulee) continue; // une vraie bulle reste : pas d'échange à côté
      this.bubbles = this.bubbles.filter(x => x.agentId !== b.id);
      if (!this.say(a.id, lignes[0], REPLIQUE + 1.2)) return false;
      this.bubbles[this.bubbles.length - 1].simulee = true;
      this.echange = { a: a.id, b: b.id, lignes, i: 1, prochaine: this.t + REPLIQUE };
      return true;
    }
    return false;
  }

  /** La réplique suivante de l'échange en cours ; il s'arrête si l'un des deux s'en va. */
  private suiteEchange() {
    const e = this.echange;
    if (!e || this.t < e.prochaine) return;
    const a = this.get(e.a), b = this.get(e.b);
    if (e.i >= e.lignes.length || !a || !b || !this.bavard(a) || !this.bavard(b) || this.nuit) { this.echange = null; return; }
    const qui = e.i % 2 ? e.b : e.a, autre = qui === e.a ? e.b : e.a;
    // les bulles l'une après l'autre : la réplique d'avant s'efface quand l'autre répond (pas deux bulles qui se cachent)
    this.bubbles = this.bubbles.filter(x => x.agentId !== autre);
    // l'échange garde la priorité : une bulle inventée qui tomberait dessus s'efface
    const q = this.get(qui)!;
    this.bubbles = this.bubbles.filter(x => !x.simulee || x.agentId === qui || !this.bullesSeTouchent(q, x.agentId));
    if (this.say(qui, e.lignes[e.i], REPLIQUE + 1.2, true)) this.bubbles[this.bubbles.length - 1].simulee = true;
    e.i++; e.prochaine = this.t + REPLIQUE;
  }

  /** En plein échange : il reste où il est. */
  private enEchange(id: string) {
    return !!this.echange && (this.echange.a === id || this.echange.b === id);
  }

  /** La nuit, personne ne circule : ceux qui restent sont à leur poste, les autres y attendent le matin (invisibles). */
  private aSonPoste(a: SimAgent) {
    a.path = []; a.errand = null; a.dejeune = false; a.activite = null;
    a.x = a.home[0]; a.y = a.home[1];
  }

  tick(dt: number) {
    this.t += dt;
    const journee = this.journee() && !this.nuit;
    const en = this.energie();
    const vitesse = SPEED * en.vitesse;
    const now = Date.now();
    this.majSalle(now);
    if (journee) this.porte();
    for (const a of this.agents) {
      // une vraie réunion de crise passe avant tout (la nuit aussi) : au début, aux points et au débrief, en salle
      const place = this.siege(a.id, now);
      if (place) { this.allerEnSalle(a, place, vitesse * dt); continue; }
      if (a.reunion) this.retourDeSalle(a);
      if (this.nuit) { this.aSonPoste(a); continue; }
      // pas encore arrivé, ou déjà parti : il attend à son poste, invisible (un vrai agent en vraie tâche y est, visible)
      if (this.horsService.has(a.id)) { this.aSonPoste(a); a.sortie = null; a.dejeune = false; continue; }
      // sa journée (vie.ts) : toilettes, match, paniers, sieste, potager, café à deux, point avec Kuroro
      if (journee && this.vivre(a, dt, vitesse)) continue;
      // (un figurant fixe, revenu des toilettes, rejoint sa place à pied)
      if (a.still && !a.sortie && !a.path.length) continue;
      if (a.path.length) {
        const [tx, ty] = a.path[0];
        const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy), st = vitesse * dt;
        if (Math.abs(dx - dy) > 1e-3) a.facing = dx - dy > 0 ? 1 : -1;
        if (d <= st) {
          a.x = tx; a.y = ty; a.path.shift();
          if (!a.path.length) {
            if (a.sortie === 'arrive') {
              // arrivé à son poste par la porte : parfois un « bonjour »
              a.sortie = null; a.wait = rnd(...en.attente);
              if (Math.random() < 0.4) this.simule(a.id, pick(BONJOURS), 3.5);
            } else if (a.sortie === 'part') {
              // arrivé à la porte : il rentre chez lui
              a.sortie = null; this.dehors(a);
            } else if (a.scripted && !this.surPlace(a.id)) this.nextStep(a);
            else if (a.scripted) a.wait = 1;
            else if (a.dejeune) {
              a.wait = rnd(8, 16);
              if (Math.random() < 0.4) this.simule(a.id, pick(BULLES_DEJEUNER), 4);
            } else if (a.errand) {
              a.wait = rnd(...a.errand.dwell);
              if (a.errand.txt && Math.random() < 0.5 * Math.min(1, en.bulle / 0.3)) this.simule(a.id, a.errand.txt, 4);
            } else a.wait = rnd(...en.attente);
          }
        } else { a.x += (dx / d) * st; a.y += (dy / d) * st; }
        continue;
      }
      a.wait -= dt;
      if (a.wait > 0) continue;
      // l'auditeur de mon Spotify (même un agent à scénario, comme Tom) met tout en pause : retour au poste, puis il danse
      if (this.surPlace(a.id)) {
        if (!this.atHome(a)) { a.errand = null; a.dejeune = false; this.goTo(a, a.home); if (!a.path.length) { a.x = a.home[0]; a.y = a.home[1]; } }
        a.wait = 1;
        continue;
      }
      // en pleine conversation avec un collègue : il reste là
      if (this.enEchange(a.id)) { a.wait = 0.5; continue; }
      if (a.scripted) { this.nextStep(a); continue; }
      // un vrai agent en vraie tâche est à son poste (pas de course, pas de déjeuner, pas de coup de mou simulé)
      if (this.travailleVraiment(a.id)) {
        a.dejeune = false;
        if (!this.atHome(a)) { a.errand = null; this.goTo(a, a.home); if (!a.path.length) { a.x = a.home[0]; a.y = a.home[1]; } }
        a.wait = 2;
        continue;
      }
      // à table : il y reste jusqu'à la fin de son déjeuner (majRepas le renvoie à son poste)
      if (a.dejeune && a.errand) {
        const p = a.errand.p;
        if (a.x !== p[0] || a.y !== p[1]) { this.goTo(a, p); if (!a.path.length) { a.x = p[0]; a.y = p[1]; } continue; }
        a.wait = rnd(8, 16);
        if (Math.random() < 0.2) this.simule(a.id, pick(BULLES_DEJEUNER), 4);
        continue;
      }
      if (!this.atHome(a)) { a.errand = null; this.goTo(a, a.home); if (!a.path.length) { a.x = a.home[0]; a.y = a.home[1]; } continue; }
      // selon le moment : au plus 4 en vadrouille le matin (6 en démo), 1 dans le coup de mou de l'après-midi
      const cafe = journee && pauseCafe(this.minutes!);
      const max = Math.round(en.marcheurs * (this.vif ? 1.5 : 1));
      const chance = Math.min(1, en.course * (this.vif ? 1.5 : 1) * (cafe ? 1.6 : 1));
      if (this.walkers() < max && Math.random() < chance) {
        const courses = cafe ? ERRANDS_CAFE : this.moment() === 'dejeuner' ? ERRANDS_MIDI : ERRANDS;
        // pendant une vraie réunion de crise, la salle n'est pas une course
        const e = pick(this.salle.ouverte ? courses.filter(x => !POI.reunion.includes(x.p)) : courses);
        a.errand = { ...e, p: [e.p[0] + rnd(-0.25, 0.25), e.p[1] + rnd(-0.2, 0.2)] };
        this.goTo(a, a.errand.p);
        if (!a.path.length) { a.errand = null; a.wait = rnd(5, 10); }
      } else {
        a.wait = rnd(...en.attente);
        const info = agentById(a.id);
        if (info) {
          info.outils.forEach(k => this.light(k, 2.5, a.id));
          if (Math.random() < en.bulle) {
            // à midi, on parle d'autre chose que du travail
            if (this.moment() === 'dejeuner') this.simule(a.id, pick(BULLES_DEJEUNER), 4.5);
            else { this.simule(a.id, info.tache, 4.5); this.tache(a.id, info.tache); }
          }
        }
      }
    }
    // les missions données dans la barre se terminent au bout d'un moment (simulé)
    for (const t of this.taches) if (t.statut === 'en cours' && t.finT !== undefined && this.t >= t.finT) {
      t.statut = 'faite'; t.quand = Date.now();
      this.simule(t.agentId, `c'est fait : ${t.texte.slice(0, 40)}`, 4);
    }
    if (this.mode === 'calme' && !this.nuit) {
      // le couloir relance selon le moment : souvent le matin, rarement l'après-midi, la pause café vers 16 h
      if (this.t >= this.prochaineRelance) {
        const r = relanceA(this.minutes ?? 9 * 60);
        const qui = ['couloir', 'couloir2'].find(id => this.get(id) && this.present(id) && !this.enEchange(id));
        if (qui && r.textes.length) this.simule(qui, pick(r.textes), 6);
        this.prochaineRelance = this.t + r.intervalle * rnd(0.85, 1.15);
      }
      // de temps en temps, deux collègues proches échangent quelques mots (souvent le matin et à midi, rarement après)
      this.suiteEchange();
      if (!this.echange && this.t >= this.prochainEchange) {
        this.lancerEchange();
        this.prochainEchange = this.t + en.bavardage * (this.vif ? 0.7 : 1) * rnd(0.7, 1.3);
      }
    }
    if (journee) this.majJeux(dt);
    else this.jeux.clear();
    this.bullesSalle(now);
    this.bubbles = this.bubbles.filter(b => this.t <= b.until);
  }

  // ── La journée de chacun (vie.ts) : tout ce qu'on voit sert vraiment

  /** Dans une cabine des toilettes, porte fermée : on ne le voit pas (il est bien là). */
  cache(id: string) {
    const a = this.get(id);
    return !!a?.activite && a.activite.c.act.type === 'toilettes' && a.activite.phase === 'la';
  }

  /** Présent et pas caché dans une cabine : on le dessine (son nom, ses bulles). */
  visible(id: string, now = Date.now()) {
    return this.present(id, now) && !this.cache(id);
  }

  /** Les quatre cabines des toilettes : occupée (porte fermée) ou libre (porte ouverte). */
  cabinesOccupees(): boolean[] {
    const out = [false, false, false, false];
    for (const a of this.agents) {
      const act = a.activite;
      if (act?.phase === 'la' && act.c.act.type === 'toilettes' && this.present(a.id)) out[act.c.act.cabine] = true;
    }
    return out;
  }

  /** Allongé dans le hamac, pour sa sieste. */
  allonge(a: SimAgent) {
    return a.activite?.c.act.type === 'hamac' && a.activite.phase === 'la' && !a.path.length;
  }

  /** Les ballons en jeu (un par match, un pour les paniers de midi). */
  ballons(): { x: number; y: number; z: number; sport: Sport }[] {
    return [...this.jeux.values()].map(j => ({ x: j.ballon[0], y: j.ballon[1], z: j.ballon[2], sport: j.sport === 'foot' ? 'foot' : 'basket' }));
  }

  /** Le créneau de sa journée, s'il en a un maintenant (et seulement de jour, en « Moment calme »). */
  private creneau(a: SimAgent): Creneau | null {
    return this.plan && this.minutes !== null && !a.reunion ? creneauA(this.plan, a.id, this.minutes) : null;
  }

  /**
   * Sa journée : il commence une activité quand son créneau arrive (s'il est libre), la poursuit, et la quitte à la fin
   * (ou dès qu'il travaille vraiment, ou qu'il met le casque). Renvoie vrai si l'activité s'occupe de lui cette image.
   */
  private vivre(a: SimAgent, dt: number, vitesse: number): boolean {
    const c = this.creneau(a), act = a.activite;
    if (act && (act.c !== c || this.travailleVraiment(a.id) || this.surPlace(a.id))) { this.finirActivite(a); return false; }
    if (!act) {
      if (!c || !this.peutCommencer(a)) return false;
      this.commencer(a, c);
    }
    this.poursuivre(a, dt, vitesse);
    return true;
  }

  /** Libre de partir à son activité : là, ni en route (arrivée, départ), ni à table, ni en réunion, ni en pleine conversation. */
  private peutCommencer(a: SimAgent) {
    if (!this.present(a.id) || this.horsService.has(a.id) || a.sortie || a.reunion || a.dejeune) return false;
    if (this.enEchange(a.id) || this.surPlace(a.id) || this.travailleVraiment(a.id)) return false;
    // un agent à scénario part de son poste, entre deux scènes (Kuroro pour son point sur le canapé)
    return !a.scripted || (this.atHome(a) && !a.path.length);
  }

  /** Où va son activité. */
  private butDe(c: Creneau, dedans = false): Pt {
    const x = c.act;
    switch (x.type) {
      case 'toilettes': return dedans ? CABINES_WC[x.cabine].dedans : CABINES_WC[x.cabine].devant;
      case 'match': return versTerrain(TERRAINS[x.sport], placeDeBase(x.sport, x.equipe, x.rang));
      case 'paniers': return versTerrain(TERRAINS.basket, PLACES_PANIERS[x.rang % PLACES_PANIERS.length]);
      case 'hamac': return HAMAC;
      case 'arrosage': return TOUR_DU_POTAGER[0].p;
      case 'rdv': return x.place;
    }
  }

  private commencer(a: SimAgent, c: Creneau) {
    a.errand = null; a.dejeune = false;
    a.activite = { c, phase: 'aller', etape: 0 };
    const x = c.act;
    // quelques mots en partant (pas à chaque fois)
    const premier = this.plan?.creneaux.find(y => y.act.type === x.type && 'cle' in y.act && 'cle' in x && y.act.cle === x.cle) === c;
    if (x.type === 'toilettes' && Math.random() < 0.12) this.simule(a.id, pick(BULLES_VIE.toilettes), 3);
    else if (x.type === 'match' && premier) this.simule(a.id, pick(x.sport === 'foot' ? BULLES_VIE.matchFoot : BULLES_VIE.matchBasket), 4);
    else if (x.type === 'paniers' && premier) this.simule(a.id, pick(BULLES_VIE.paniers), 4);
    else if (x.type === 'rdv' && x.lieu === 'salle' && premier && Math.random() < 0.6) this.simule(a.id, pick(BULLES_VIE.cafeADeux), 4);
    const but = this.butDe(c);
    this.goTo(a, but);
    if (!a.path.length) { a.x = but[0]; a.y = but[1]; this.arriver(a); }
  }

  /** Arrivé à son activité. */
  private arriver(a: SimAgent) {
    const act = a.activite!, x = act.c.act;
    if (x.type === 'toilettes') {
      // une personne par cabine : si elle est encore prise, il attend devant
      const prise = this.agents.some(b => b !== a && b.activite?.phase === 'la' && b.activite.c.act.type === 'toilettes' && b.activite.c.act.cabine === x.cabine);
      if (prise) { a.wait = 1; return; }
      const d = CABINES_WC[x.cabine].dedans;
      a.x = d[0]; a.y = d[1];
    }
    if (x.type === 'hamac' && Math.random() < 0.6) this.simule(a.id, pick(BULLES_VIE.hamac), 4);
    act.phase = 'la';
    a.wait = rnd(0.2, 1);
  }

  /** L'activité suit son cours : la marche jusque-là, puis ce qu'on y fait. */
  private poursuivre(a: SimAgent, dt: number, vitesse: number) {
    const act = a.activite!, x = act.c.act;
    const court = act.phase === 'la' && (x.type === 'match' || x.type === 'paniers');
    if (a.path.length) {
      if (this.pas(a, vitesse * (court ? 1.35 : 1) * dt) && act.phase === 'aller') this.arriver(a);
      return;
    }
    if (act.phase === 'aller') { a.wait -= dt; if (a.wait <= 0) this.arriver(a); return; }
    if (x.type === 'match' || x.type === 'paniers') { this.jouer(a, dt); return; }
    if (x.type === 'arrosage') {
      a.wait -= dt;
      if (a.wait > 0) return;
      // le tour du potager : un rang après l'autre, en s'arrêtant pour arroser
      act.etape = (act.etape + 1) % TOUR_DU_POTAGER.length;
      const e = TOUR_DU_POTAGER[act.etape];
      a.path = [e.p];
      a.wait = e.arrose ? rnd(4, 7) : 0.2;
      if (e.arrose && act.etape === 1 && Math.random() < 0.6) this.simule(a.id, pick(BULLES_VIE.arrosage), 4);
      return;
    }
    if (x.type === 'rdv') {
      // assis tous les deux : ils parlent, de temps en temps
      const b = this.get(x.avec);
      if (!b || b.activite?.c.act.type !== 'rdv' || b.activite.phase !== 'la' || b.path.length || this.echange) return;
      if (this.t < (this.prochainRdv.get(x.cle) ?? 0)) return;
      this.prochainRdv.set(x.cle, this.t + rnd(20, 35));
      if (this.bavard(a) && this.bavard(b)) this.echangeEntre(a, b, pick(ECHANGES_RDV[x.lieu]));
    }
  }

  /** Un pas sur son chemin ; vrai quand le chemin est fini. */
  private pas(a: SimAgent, st: number) {
    const [tx, ty] = a.path[0];
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
    if (Math.abs(dx - dy) > 1e-3) a.facing = dx - dy > 0 ? 1 : -1;
    if (d <= st) { a.x = tx; a.y = ty; a.path.shift(); return !a.path.length; }
    a.x += (dx / d) * st; a.y += (dy / d) * st;
    return false;
  }

  /** Fin de l'activité : il ressort de sa cabine, puis retourne à son poste ; ou rentre chez lui si c'est l'heure. */
  private finirActivite(a: SimAgent) {
    const act = a.activite!;
    a.activite = null; a.path = []; a.wait = rnd(1, 4);
    if (act.c.act.type === 'toilettes' && act.phase === 'la') { const d = CABINES_WC[act.c.act.cabine].devant; a.x = d[0]; a.y = d[1]; }
    const pr = this.plan?.presence.get(a.id);
    if (pr && this.minutes !== null && this.minutes >= pr.depart - 5 && !this.travailleVraiment(a.id) && !a.reunion) {
      this.file = this.file.filter(f => f.id !== a.id);
      this.partir(a);
      return;
    }
    this.goTo(a, a.home);
    if (!a.path.length) { a.x = a.home[0]; a.y = a.home[1]; }
  }

  /** À l'ouverture de la page (ou après un saut d'heure) : ceux qui sont dans une activité y sont déjà. */
  private placerActivites() {
    for (const a of this.agents) {
      const c = this.creneau(a);
      if (!c || !this.peutCommencer(a)) continue;
      a.errand = null; a.path = [];
      a.activite = { c, phase: 'la', etape: 0 };
      const p = this.butDe(c, true);
      a.x = p[0]; a.y = p[1]; a.wait = rnd(0, 1.5);
    }
  }

  /** Le jeu d'un match ou des paniers de midi. */
  private jeuDe(a: SimAgent): Jeu | undefined {
    const x = a.activite?.c.act;
    return x && (x.type === 'match' || x.type === 'paniers') ? this.jeux.get(x.cle) : undefined;
  }

  /** Un joueur : de courtes courses autour de sa place, vers le ballon parfois ; celui qui l'a avance vers le but. */
  private jouer(a: SimAgent, dt: number) {
    const x = a.activite!.c.act;
    if (x.type !== 'match' && x.type !== 'paniers') return;
    const j = this.jeuDe(a);
    // celui qui va recevoir la passe court à sa rencontre
    if (j?.vol?.vers === a.id && Math.hypot(j.vol.a[0] - a.x, j.vol.a[1] - a.y) > 0.3) { a.path = [[j.vol.a[0], j.vol.a[1]]]; return; }
    a.wait -= dt;
    if (a.wait > 0) return;
    const T = x.type === 'match' ? TERRAINS[x.sport] : TERRAINS.basket;
    const base = this.butDe(a.activite!.c);
    let cible: Pt;
    if (x.type === 'paniers') cible = [base[0] + rnd(-0.35, 0.35), base[1] + rnd(-0.3, 0.3)];
    else if (j?.porteur === a.id) {
      // il avance vers le but adverse (l'équipe 0 attaque vers le bas)
      const sens = x.equipe === 0 ? 1 : -1;
      cible = [a.x + rnd(-0.8, 0.8), a.y + sens * rnd(0.6, 1.4)];
    } else if (j && Math.random() < 0.4) cible = [(base[0] + j.ballon[0]) / 2 + rnd(-0.5, 0.5), (base[1] + j.ballon[1]) / 2 + rnd(-0.5, 0.5)];
    else cible = [base[0] + rnd(-0.9, 0.9), base[1] + rnd(-0.9, 0.9)];
    const m = 0.25;
    cible = [Math.min(T.x + T.w - m, Math.max(T.x + m, cible[0])), Math.min(T.y + T.d - m, Math.max(T.y + m, cible[1]))];
    a.path = [cible];
    a.wait = x.type === 'paniers' ? rnd(1.5, 3) : rnd(0.3, 1.2);
  }

  /** Les ballons : porté, passé, tiré au but ou au panier, puis rendu à un joueur. */
  private majJeux(dt: number) {
    const surTerrain = new Map<string, { a: SimAgent; x: Extract<Creneau['act'], { type: 'match' | 'paniers' }> }[]>();
    for (const a of this.agents) {
      const x = a.activite?.c.act;
      if (!x || (x.type !== 'match' && x.type !== 'paniers') || a.activite!.phase !== 'la' || !this.present(a.id)) continue;
      surTerrain.set(x.cle, [...(surTerrain.get(x.cle) ?? []), { a, x }]);
    }
    for (const cle of [...this.jeux.keys()]) if (!surTerrain.has(cle)) this.jeux.delete(cle);
    for (const [cle, js] of surTerrain) {
      const x0 = js[0].x, sport = x0.type === 'match' ? x0.sport : 'paniers';
      const terrain = x0.type === 'match' ? TERRAINS[x0.sport] : TERRAINS.basket;
      let j = this.jeux.get(cle);
      if (!j) {
        j = { cle, sport, terrain, ballon: [terrain.x + terrain.w / 2, terrain.y + terrain.d * (sport === 'paniers' ? 0.75 : 0.5), 0.1], vol: null, porteur: null, prochaine: this.t + 1 };
        this.jeux.set(cle, j);
      }
      const joueur = (id: string | null) => js.find(y => y.a.id === id);
      const foot = sport === 'foot';
      if (j.vol) {
        const v = j.vol;
        v.t += dt;
        const f = Math.min(1, v.t / v.duree);
        j.ballon = [v.de[0] + (v.a[0] - v.de[0]) * f, v.de[1] + (v.a[1] - v.de[1]) * f, v.de[2] + (v.a[2] - v.de[2]) * f + 4 * v.haut * f * (1 - f)];
        if (f < 1) continue;
        j.vol = null;
        if (v.tir) {
          // au but (ou au panier) : parfois réussi, et on le dit ; puis le ballon revient à un joueur
          if (Math.random() < 0.5 && Math.random() < 0.45) this.simule(v.tir.tireur, pick(foot ? BULLES_VIE.but : BULLES_VIE.panier), 3);
          const tireur = joueur(v.tir.tireur);
          const autres = js.filter(y => sport === 'paniers' ? y.a.id !== v.tir!.tireur : y.x.type === 'match' && tireur?.x.type === 'match' && y.x.equipe !== tireur.x.equipe);
          const r = (autres.length ? pick(autres) : pick(js)).a;
          j.vol = { de: [v.a[0], v.a[1], v.a[2]], a: [r.x, r.y, foot ? 0.09 : 0.6], t: 0, duree: foot ? 1.0 : 0.9, haut: foot ? 0.2 : 0.4, vers: r.id };
        } else j.porteur = joueur(v.vers)?.a.id ?? null;
        j.prochaine = this.t + rnd(0.8, 2.2);
        continue;
      }
      const p = joueur(j.porteur)?.a;
      if (!p) {
        // personne n'a le ballon : le plus proche le prend
        const r = js.reduce((m, y) => (Math.hypot(y.a.x - j!.ballon[0], y.a.y - j!.ballon[1]) < Math.hypot(m.a.x - j!.ballon[0], m.a.y - j!.ballon[1]) ? y : m)).a;
        j.vol = { de: [...j.ballon], a: [r.x, r.y, foot ? 0.09 : 0.6], t: 0, duree: 0.6, haut: 0.15, vers: r.id };
        continue;
      }
      // aux pieds, ou en dribble
      j.ballon = foot ? [p.x + 0.14, p.y + 0.14, 0.09] : [p.x + 0.2, p.y + 0.08, 0.12 + Math.abs(Math.sin(this.t * 7)) * 0.45];
      if (this.t < j.prochaine) continue;
      const px = joueur(p.id)!.x;
      const equipe = px.type === 'match' ? px.equipe : 0;
      const coequipiers = js.filter(y => y.a !== p && (sport === 'paniers' || (y.x.type === 'match' && y.x.equipe === equipe)));
      const cibles = CIBLES[foot ? 'foot' : 'basket'];
      // l'équipe 0 attaque vers le bas ; aux paniers de midi, on tire au panier du bas, chacun son tour
      const cible = sport === 'paniers' ? cibles[1] : cibles[equipe === 0 ? 1 : 0];
      const pres = Math.abs(p.y - cible[1]) < terrain.d * 0.45;
      if (sport === 'paniers' || (pres && Math.random() < 0.35) || !coequipiers.length) {
        const [cx, cy, cz] = cible;
        j.vol = { de: [...j.ballon], a: [cx + (foot ? rnd(-0.6, 0.6) : 0), cy, foot ? rnd(0.1, 0.5) : cz], t: 0, duree: foot ? 0.7 : 1.0, haut: foot ? 0.25 : 1.1, vers: null, tir: { cible, tireur: p.id } };
      } else {
        const r = pick(coequipiers).a;
        const d = Math.hypot(r.x - p.x, r.y - p.y);
        j.vol = { de: [...j.ballon], a: [r.x, r.y, foot ? 0.09 : 0.6], t: 0, duree: Math.min(1, Math.max(0.3, d / (foot ? 6 : 7))), haut: foot ? 0.12 : 0.35, vers: r.id };
        if (Math.random() < 0.06) this.simule(r.id, pick(BULLES_VIE.jeu), 2.5);
      }
      j.porteur = null;
    }
  }

  /** Un échange choisi entre deux collègues (le café à deux, le point avec Kuroro). */
  private echangeEntre(a: SimAgent, b: SimAgent, lignes: string[]) {
    if (this.bulleVoisine(a.id, [b.id]) || this.bulleVoisine(b.id, [a.id])) return false;
    this.bubbles = this.bubbles.filter(x => x.agentId !== b.id || !x.simulee);
    if (!this.say(a.id, lignes[0], REPLIQUE + 1.2)) return false;
    this.bubbles[this.bubbles.length - 1].simulee = true;
    this.echange = { a: a.id, b: b.id, lignes, i: 1, prochaine: this.t + REPLIQUE };
    return true;
  }

  /**
   * Phase 2 : applique l'état réel lu dans Upstash. Un agent qui a écrit depuis moins de 30 min
   * affiche sa vraie tâche (bulle et fiche) et allume son outil ; les autres continuent la simulation.
   */
  appliquerReel(etats: Record<string, { statut: string; tache: string; outil?: string; quand: number }>, now = Date.now()) {
    for (const [id, e] of Object.entries(etats)) {
      // le bruit de l'installation (« TEST · … », scripts/agent-test.mjs) n'est pas du travail
      if (now - e.quand > 30 * 60_000 || !this.get(id) || /^TEST\b/.test(e.tache.trim())) { this.travail.delete(id); continue; }
      if (e.statut === 'au travail') this.travail.set(id, e.quand); else this.travail.delete(id);
      const nouveau = this.reels.get(id) !== e.quand;
      this.reels.set(id, e.quand);
      this.tasks[id] = e.tache;
      if (nouveau) {
        this.say(id, e.tache, 6, true);
        if (e.outil) this.light(e.outil, 6, id, true);
      }
    }
    for (const [id, quand] of this.reels) if (now - quand > 30 * 60_000) this.reels.delete(id);
  }

  /**
   * Mon vrai Spotify (lu par la page toutes les 15 s) : à chaque nouveau morceau, un des quatre agents reliés à
   * Spotify, tiré au sort, met le casque (bulle « 🎧 Titre · Artiste ») et l'icône Spotify s'allume pour de vrai.
   * Le même agent garde le casque tout le morceau. En pause ou sans musique : plus de casque, icône éteinte.
   */
  appliquerEcoute(e: { id: string; titre: string; artistes: string; joue: boolean; dureeMs?: number; progressionMs?: number } | null, alea: () => number = Math.random) {
    if (!e) { this.arreterEcoute(); this.choixEcoute = null; return; }
    const nouveau = this.choixEcoute?.morceau !== e.id;
    this.choixEcoute = choisirAuditeur(e.id, this.choixEcoute, alea);
    if (!e.joue) { this.arreterEcoute(); return; }
    const { agentId } = this.choixEcoute;
    const etiquette = e.artistes ? `${e.titre} · ${e.artistes}` : e.titre;
    const reprise = this.ecoute?.agentId !== agentId;
    if (nouveau && this.ecoute && this.ecoute.agentId !== agentId) this.bubbles = this.bubbles.filter(b => b.agentId !== this.ecoute!.agentId || !b.text.startsWith('🎧'));
    // fin estimée du morceau (+ 2 s) : la danse s'arrête même si la lecture suivante tarde
    const reste = e.dureeMs ? Math.max(0, e.dureeMs - (e.progressionMs ?? 0)) / 1000 + 2 : Infinity;
    this.ecoute = { agentId, texte: `écoute : ${etiquette}`, finT: this.t + reste };
    if (nouveau || reprise) this.say(agentId, `🎧 ${etiquette}`, 8, true);
    this.light('Sp', 20, agentId, true);
  }

  /** Vrai si cet agent écoute un morceau en lecture : il danse à son poste. */
  dansant(agentId: string) {
    return !!this.ecoute && this.ecoute.agentId === agentId && this.t < this.ecoute.finT;
  }

  /** Vrai pendant que le compte rendu de cet agent est ouvert : il salue à son poste. */
  salue(agentId: string) {
    return this.salut === agentId;
  }

  saluer(agentId: string | null) {
    this.salut = agentId;
  }

  /** Il reste à son poste : il danse ou il salue. */
  private surPlace(agentId: string) {
    return this.dansant(agentId) || this.salue(agentId);
  }

  private arreterEcoute() {
    if (!this.ecoute) return;
    if (this.lit.Sp !== undefined) this.lit.Sp = Math.min(this.lit.Sp, this.t);
    this.ecoute = null;
  }

  /** Une mission confiée directement à un agent, depuis sa fiche. */
  missionDirecte(agentId: string, texte: string) {
    this.taches.push({ id: this.nextTache++, quand: Date.now(), agentId, texte, statut: 'en cours', origine: 'moi', finT: this.t + rnd(25, 45) });
    this.tache(agentId, texte);
    this.simule(agentId, texte.slice(0, 60), 5, true);
  }

  /** Une mission écrite dans la barre : Kuroro la confie au bon agent (simulé à ce stade). */
  mission(texte: string) {
    const { agent, pole } = routeMission(texte);
    this.say('kuroro', `nouvelle mission : ${texte.slice(0, 50)}`, 4, true);
    this.light('C', 2, 'kuroro');
    this.taches.push({ id: this.nextTache++, quand: Date.now(), agentId: agent.id, texte, statut: 'en cours', origine: 'moi', finT: this.t + rnd(25, 45) });
    if (agent.id !== 'kuroro') {
      this.tache(agent.id, texte);
      setTimeout(() => this.simule(agent.id, texte.slice(0, 60), 5, true), 900);
    }
    return { agent, pole };
  }

  /** Le tournage : L est vraiment au studio, arrêté devant la caméra (pas en chemin) ; ON AIR s'allume alors. */
  private tournage() {
    const L = this.get('L');
    return !!L && this.studioOn && this.present('L') && !L.path.length && roomAt(L.x, L.y)?.id === 'studio';
  }

  /** La nuit, l'agent d'astreinte garde une bulle fixe « d'astreinte » (une présence, pas une tâche). */
  private bulleAstreinte() {
    const a = this.nuit && this.astreinte ? this.get(this.astreinte) : null;
    if (!a || this.bubbles.some(b => b.agentId === a.id)) return [];
    return [{ id: 900_000, agentId: a.id, label: agentById(a.id)?.nom ?? a.id, text: "d'astreinte" }];
  }

  snapshot(): Snapshot {
    // la nuit, seuls ceux qui sont là comptent (pièces, compteur, bulles)
    const ici = this.agents.filter(a => this.present(a.id));
    const named = ici.filter(a => a.named);
    const inRoom = (id: string) => named.filter(a => roomAt(a.x, a.y)?.id === id);
    const pole = (id: string, total: number, roomId: string) => inRoom(roomId).filter(a => agentById(a.id)?.pole === id).length + `/${total} au poste`;
    const crowd = (roomId: string) => ici.filter(a => !a.still && roomAt(a.x, a.y)?.id === roomId).length;
    const kuroro = this.get('kuroro')!;
    // les étiquettes disent ce qu'on voit : qui est vraiment au studio (et pas « L et Tom » quand Tom n'y est pas)
    const auStudio = inRoom('studio');
    const noms = (l: SimAgent[]) => { const n = l.map(a => agentById(a.id)?.nom ?? a.id); return n.length > 1 ? `${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}` : n[0] ?? ''; };
    const comAuStudio = auStudio.filter(a => agentById(a.id)?.pole === 'communication');
    const tournage = this.tournage();
    const rooms: Record<string, string> = {
      code: pole('code', 7, 'code'),
      direction: pole('direction', 3, 'direction') + (this.present('kuroro') && roomAt(kuroro.x, kuroro.y)?.id !== 'direction' ? ' · Kuroro circule' : ''),
      communication: comAuStudio.length ? `${noms(comAuStudio)} au studio` : pole('communication', 3, 'communication'),
      mac: pole('mac', 3, 'mac'),
      cafe: (() => { const n = ici.filter(a => a.id !== 'barista' && roomAt(a.x, a.y)?.id === 'cafe').length; return this.moment() === 'dejeuner' && this.mode === 'calme' ? `${n} à table` : `${n} en pause`; })(),
      pause: 'PS5 · baby-foot · arcade',
      atelier: '5 projets en cours',
      reunion: (() => { const n = ici.filter(a => roomAt(a.x, a.y)?.id === 'reunion').length; return n ? `${n} en réunion` : 'libre'; })(),
      toilettes: crowd('toilettes') ? 'occupées' : 'libres',
      cabines: crowd('cabines') ? `${crowd('cabines')} appel${crowd('cabines') > 1 ? 's' : ''} en cours` : 'libres',
      studio: tournage ? 'tournage en cours' : auStudio.length ? `${noms(auStudio)} au studio` : 'libre',
      accords: [`${this.accords.pending} en attente`, this.accords.ok ? `${this.accords.ok} validé${this.accords.ok > 1 ? 's' : ''}` : '', this.accords.ko ? `${this.accords.ko} refusé` : ''].filter(Boolean).join(' · '),
    };
    for (const r of ROOMS) rooms[r.id] ??= '';
    return {
      bubbles: [
        ...this.bubbles.filter(b => this.visible(b.agentId)).map(b => ({ id: b.id, agentId: b.agentId, label: b.label, text: b.text })),
        ...this.bulleAstreinte(),
      ],
      lit: Object.keys(this.lit).filter(k => this.lit[k] > this.t),
      rooms,
      count: named.filter(a => this.atHome(a) || a.scripted).length,
      studioOn: tournage,
      tasks: this.ecoute ? { ...this.tasks, [this.ecoute.agentId]: this.ecoute.texte } : { ...this.tasks },
      reels: [...this.reels.keys()],
      danse: this.ecoute && this.dansant(this.ecoute.agentId) ? [this.ecoute.agentId] : [],
      taches: [...this.taches].sort((a, b) => b.quand - a.quand),
      usages: [...this.usages].sort((a, b) => b.quand - a.quand),
      salle: this.salle.ouverte && this.reunion ? titreSalle(this.reunion, Date.now()) : null,
    };
  }
}
