import type { KV } from './memoire';
import { CLES, journaliser, type Entree, type Etat } from './qg';
import { astreinteDuJour, planningSemaine, semaineISO } from '@/sim/astreinte';
import { idsEnAttente, CLES_ACCORDS, type Accord } from './accords';
import { lireMemoire } from './l/memoire';
import { CLE_POSTS, CLE_PROPOSITIONS, sujetsRediges, type Post, type Proposition } from './l/posts';
import { CLES_LIGHT, jourDe } from './light/releve';
import { OUTILS_SUIVIS } from './light/versions';
import type { MessageJour } from './light/api';
import { vueClara } from './clara/vue';
import { vueMafe } from './mafe/vue';
import { vueLuffy } from './luffy/vue';
import { vueIsaac, goEntier } from './isaac/vue';
import { phraseZoro } from './zoro/vue';
import { lireTour } from './zoro/tour';
import { vueLea, phraseLea, gravesOuverts, noteTentative } from './lea/vue';
import { vuePaul, phrasePaul } from './paul/vue';
import { ACTIVATION_PAUL } from './paul/etiquette';
import { vueYe, phraseYe } from './ye/vue';
import { ACTIVATION_YE } from './ye/etiquette';
import { vueFeu } from './feu/vue';
import { ACTIVATION_FEU, FEU_VEILLE_MS, feuEnService, phraseFeu } from './feu/etiquette';
import { duree } from './luffy/vigie';
import { presencesActives } from './presence';
import { lireRegles, type RegleQG } from './regles';
import { vuesReunions } from './crise/vue';
import { lireReunions } from './crise/stock';
import { vueSilence } from './silence';
import type { VueSilence } from '@/data/silence';
import { estLigneJournal, type ReunionVue } from '@/data/crise';
import { enPauseA, pauseEnCours, phrasePause, type Pauses } from './pause-agents';
import { etatPassageMissions, lireDonneesMissions, type DonneesMissions } from './missions/file';
import { ACTIVATION_MISSIONS, HEURES_MISSIONS } from '@/data/missions';

// Les onglets Tâches, Calendrier et Cerveau de la page : seulement des données réelles, lues dans Upstash.
// Un seul document, relu par la page toutes les 20 s ; jamais de jeton, de mot de passe ni d'adresse de connexion.
// Heure d'Abidjan = UTC : toutes les dates sont calculées en UTC.

import { AGENTS_REELS } from '@/data/reels';
export { AGENTS_REELS };
export const NOMS: Record<string, string> = { kuroro: 'Kuroro', L: 'L', light: 'Light', clara: 'Clara', mafe: 'Mafe', luffy: 'Luffy', zoro: 'Zoro', lea: 'Léa', paul: 'Paul', ye: 'Ye', isaac: 'Isaac', feu: 'Feu' };

const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;
const EN_COURS_MAX = 30 * MIN;
/** Leurs tâches sont des routines Claude Code : sans autre outil déclaré, c'est Claude qui travaille. */
const ROUTINES_CLAUDE = ['L', 'light', 'mafe'];
/** Au plus 100 entrées par agent : un agent très actif ne chasse pas les autres de la liste. */
const FAITES_JOURS = 7, FAITES_MAX = 100;
/** Fenêtre où une entrée du journal compte comme le passage ; au-delà d'1 h sans entrée, le passage est raté. */
const FENETRE = 3 * H, RETARD = H;
const NOUVEAU = 48 * H;

export type Panneau = 'bureauL' | 'releveLight' | 'bureauClara' | 'bureauMafe' | 'bureauLuffy' | 'bureauIsaac' | 'bureauZoro' | 'bureauLea' | 'bureauPaul' | 'bureauYe' | 'bureauFeu';

// ───────────── Les routines ─────────────

type Routine = {
  id: string; agent: string; titre: string; jours: number[]; heures: string[];
  /** Les tâches du journal qui prouvent le passage (début de texte, sans accents ni majuscules). */
  motifs?: string[]; accord?: boolean; conditionnel?: boolean; prevu?: boolean;
  /** Mise en pause par le patron : les passages à partir de cette date sont « en pause » (ni faits, ni ratés). */
  pause?: number;
  /** La reprise : à partir de cette date, la routine repasse normalement (la pause n'aura duré qu'entre les deux). */
  reprise?: number;
  /** Mise en service de la routine : un passage prévu avant n'a pas d'état (jamais « raté »). */
  actif?: number;
};

/** Les routines de L et de Light ont été mises en service le 9 novembre 2026 à 12:46 (UTC). */
export const ACTIVATION_L_LIGHT = Date.UTC(2026, 10, 9, 12, 46);
/** Routines de Clara (ménage quotidien 09:00, bannis toutes les heures) créées et activées le 10 novembre 2026. */
export const ACTIVATION_CLARA = Date.UTC(2026, 10, 10, 12, 27);
/** Routines de Mafe (point 07:30 lun-ven, Telegram mardi 10:00 et vendredi 17:00) activées le 10 novembre 2026. */
export const ACTIVATION_MAFE = Date.UTC(2026, 10, 10, 14, 17);
/** Routine de Zoro (tour de sécurité, mardi 09:00) activée le 11 novembre 2026 à 13:21 (premier tour réel). */
export const ACTIVATION_ZORO = Date.UTC(2026, 10, 11, 13, 21);
/** Routine de Paul (README et CLAUDE.md, jeudi 18:00) : voir src/server/paul/etiquette.ts (la page en a besoin aussi). */
export { ACTIVATION_PAUL };
/** Routine de Ye (fiche portfolio, vendredi 17:30) : voir src/server/ye/etiquette.ts (fixée à la mise en service). */
export { ACTIVATION_YE };
/** Feu (analyse 08:00, 12:00, 16:00, 20:00 ; lecture du marché toutes les 15 min) : fixé à la mise en service. */
export { ACTIVATION_FEU };
/**
 * Compte rendu du matin de Kuroro (tous les jours 08:15, un seul message Telegram) : voir src/server/matin/.
 * Avant cette heure, ses créneaux sont « inactifs » (jamais ratés).
 */
export const ACTIVATION_MATIN = Date.UTC(2026, 10, 12, 11, 30); // mis en service le 12 novembre 2026 à 11:30 (planification QStash créée, premier envoi d’essai)
/** La routine « QG · missions » (toutes les heures, 08:00 à 20:00) : voir src/data/missions.ts (fixée à la mise en service). */
export { ACTIVATION_MISSIONS };
/** L · rédaction mise en pause le 10 novembre 2026 (« on ne poste pas pour l'instant »). */
export const PAUSE_L_REDACTION = Date.UTC(2026, 10, 10, 11, 49);
/** … et reprise le 14 novembre 2026 au soir (« je veux faire un post sur LinkedIn maintenant »). */
export const REPRISE_L_REDACTION = Date.UTC(2026, 10, 14, 22, 30);
/** Une routine est-elle en pause à l'instant `t` ? (entre sa pause et sa reprise, s'il y en a une) */
export const routineEnPause = (r: { pause?: number; reprise?: number }, t: number) => r.pause !== undefined && t >= r.pause && (r.reprise === undefined || t < r.reprise);
const TOUS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Les routines réelles (Claude Code, voir agents/<nom>/CONSIGNES.md). 0 = lundi.
 * - L · sujets : lundi 07:00, propose 3 sujets ;
 * - L · rédaction : mardi et jeudi 06:00, un brouillon envoyé pour accord sur Telegram ;
 * - Light · matin : tous les jours 08:00, le relevé des versions ;
 * - Light · relances : 14:00 et 19:00, seulement si le relevé du jour n'a pas été vu ;
 * - Kuroro · compte rendu du matin : tous les jours 08:15, sur Telegram (QStash) ;
 * - QG · missions : toutes les heures de 08:00 à 20:00, seulement s'il y a des missions en attente (comme les relances).
 * L · boîte (toutes les heures) est une ligne à part, pas 24 cases.
 */
export const ROUTINES: Routine[] = [
  { id: 'l-sujets', agent: 'L', titre: 'Propose 3 sujets de la semaine', jours: [0], heures: ['07:00'], motifs: ['propose 3 sujets'], actif: ACTIVATION_L_LIGHT },
  { id: 'l-redaction', agent: 'L', titre: 'Rédige un brouillon de post', jours: [1, 3], heures: ['06:00'], motifs: ['redige'], accord: true, actif: ACTIVATION_L_LIGHT, pause: PAUSE_L_REDACTION, reprise: REPRISE_L_REDACTION },
  { id: 'light-releve', agent: 'light', titre: 'Relevé des versions', jours: TOUS, heures: ['08:00'], motifs: ['releve du matin', 'envoie le releve', 'termine le rapport'], actif: ACTIVATION_L_LIGHT },
  { id: 'clara-menage', agent: 'clara', titre: 'Propose de nouveaux expéditeurs à nettoyer', jours: TOUS, heures: ['09:00'], motifs: ['statistiques', 'compte les mails', 'prepare des questions', 'questions posees'], actif: ACTIVATION_CLARA },
  { id: 'light-relance', agent: 'light', titre: 'Relance si le relevé n’est pas vu', jours: TOUS, heures: ['14:00', '19:00'], conditionnel: true, actif: ACTIVATION_L_LIGHT },
  { id: 'mafe-point', agent: 'mafe', titre: 'Point du matin', jours: [0, 1, 2, 3, 4], heures: ['07:30'], motifs: ['point du matin'], actif: ACTIVATION_MAFE },
  { id: 'mafe-mardi', agent: 'mafe', titre: 'Où tu t\'es arrêté (Telegram)', jours: [1], heures: ['10:00'], motifs: ['envoie le point sur telegram'], actif: ACTIVATION_MAFE },
  { id: 'mafe-vendredi', agent: 'mafe', titre: 'Bilan de la semaine (Telegram)', jours: [4], heures: ['17:00'], motifs: ['envoie le point sur telegram'], actif: ACTIVATION_MAFE },
  { id: 'zoro-securite', agent: 'zoro', titre: 'Tour de sécurité', jours: [1], heures: ['09:00'], motifs: ['fait le tour de securite'], actif: ACTIVATION_ZORO },
  { id: 'paul-readme', agent: 'paul', titre: 'README et CLAUDE.md', jours: [3], heures: ['18:00'], motifs: ['a relu la semaine'], actif: ACTIVATION_PAUL },
  { id: 'ye-portfolio', agent: 'ye', titre: 'Fiche portfolio', jours: [4], heures: ['17:30'], motifs: ['a compare la semaine'], actif: ACTIVATION_YE },
  // Feu : l'analyse du marché sur Telegram, prouvée par son envoi (« envoie l'analyse de 12:00 »)
  { id: 'feu-analyse', agent: 'feu', titre: 'Analyse du marché (Telegram)', jours: TOUS, heures: ['08:00', '12:00', '16:00', '20:00'], motifs: ['envoie l\'analyse'], actif: ACTIVATION_FEU },
  // Kuroro n'est pas un agent réel (pas de fiche) : seulement ce créneau, prouvé par son entrée du journal
  { id: 'kuroro-matin', agent: 'kuroro', titre: 'Compte rendu du matin', jours: TOUS, heures: ['08:15'], motifs: ['a envoye le compte rendu du matin'], actif: ACTIVATION_MATIN },
  // les missions de la barre et de Telegram (agents/Missions/CONSIGNES.md) : un passage fait quand il a pris des missions
  { id: 'qg-missions', agent: 'kuroro', titre: 'QG · missions', jours: TOUS, heures: HEURES_MISSIONS, conditionnel: true, actif: ACTIVATION_MISSIONS },
];

/** Les agents prévus (feuille de route), affichés en gris : aucun ne tourne encore. */
export const PREVUS: Routine[] = [
  // Mafe passera dans ROUTINES à l'activation (ajouter `actif`, retirer `prevu`) ; ses motifs sont déjà là.
];

/** Les rythmes qui ne tiennent pas dans une case. */
export const LIGNES: { agent: string; texte: string; prevu: boolean }[] = [
  { agent: 'L', texte: 'L : boîte relevée toutes les heures', prevu: false },
  { agent: 'clara', texte: 'Clara : mails des bannis à la corbeille toutes les heures ; agit aussi quand tu touches un bouton', prevu: false },
  { agent: 'luffy', texte: 'Luffy : vérifie tes sites toutes les 5 min', prevu: true },
  { agent: 'isaac', texte: 'Isaac : surveille la place toutes les heures', prevu: true },
  { agent: 'lea', texte: 'Léa : relit tes pushes toutes les heures', prevu: true },
  { agent: 'feu', texte: 'Feu : lit le marché toutes les 15 min (BTC et ETH)', prevu: true },
];

/** `rien-a-faire` : la rédaction n'avait aucun sujet à écrire (pas de proposition, ou les trois sont rédigés). */
export type EtatCreneau = 'fait' | 'rate' | 'a-venir' | 'sans-objet' | 'rien-a-faire' | 'inactif' | 'pause' | 'prevu';
export type Creneau = {
  routine: string; agent: string; nom: string; titre: string; jour: number; heure: string; quand: number;
  etat: EtatCreneau; accord?: boolean; conditionnel?: boolean; prevu?: boolean;
  entree?: { quand: number; texte: string; resultat?: string };
};

// ───────────── Le cerveau ─────────────

/** Les règles de base : chacune est garantie par le code (à tenir à jour). Dans le Cerveau, on ne les change pas. */
export const REGLES_QG = [
  'Rien ne sort du QG sans mon accord.',
  'Les accords passent par Telegram.',
  'Je publie moi-même sur LinkedIn (bouton « Publier »).',
  'Clara : corbeille seulement, jamais de suppression définitive.',
  'Mes VIP ne sont jamais touchés.',
  'Les clés vont dans Vercel, jamais dans le code.',
  'Les vrais noms de projets seulement dans ma page privée, jamais dans /demo.',
  'Seules les vraies actions allument une icône.',
];

/** Une carte par agent : quelques phrases simples ; le détail est dans son bureau. */
export type CerveauAgent = { agent: string; nom: string; ouvre: Panneau; lien: string; phrases: string[]; nouveau?: true };

/** L'état réel d'un agent branché : sa fiche (« En ce moment ») et l'en-tête de son bureau. */
export type EtatAgent = {
  agent: string; nom: string;
  /** `bloque` : le dernier passage prévu aujourd'hui (déjà passé) est raté, hors routines en pause. */
  statut: 'au travail' | 'au repos' | 'bloque';
  tache?: string;
  /** L'outil de la tâche en cours (clé de la barre d'outils), seulement « au travail ». */
  outil?: string;
  /** La dernière entrée de l'agent dans le journal. */
  dernierPassage: { quand: number; texte: string } | null;
  /** Le prochain créneau de ses routines (les relances conditionnelles ne comptent pas). */
  prochainPassage: { quand: number; titre: string } | null;
  /** Clara : pas de routine, elle agit quand je touche un bouton. */
  surDemande?: true;
  /** Un agent qui passe en continu (Luffy) : son rythme remplace le « prochain passage ». */
  rythme?: string;
  /** Une précision courte quand l'agent ne fait pas ce qu'on attend de lui (« ne vérifie plus »). */
  note?: string;
  /** Mis en pause par le patron : « en pause (par toi) jusqu’à lundi 16 à 00:00 » (ni bloqué, ni raté). */
  pause?: string;
};

export type VuesQG = {
  /** L'heure de la lecture (serveur) : la page compte « aujourd'hui », « hier », le prochain passage à partir d'elle. */
  maintenant: number;
  agents: EtatAgent[];
  taches: {
    /** `outil` : l'icône allumée dans la barre d'outils tant que la tâche tourne (en phase avec le compteur). */
    enCours: { agent: string; tache: string; depuis: number; outil?: string }[];
    enAttente: { agent: string; texte: string; nombre?: number; ouvre: Panneau }[];
    /** Les fins de tâche (et les erreurs) ; un début suivi de sa fin sous 10 min n'apparaît pas. */
    faites: { quand: number; agent: string; texte: string; resultat?: string; erreur?: true }[];
    alerte: { texte: string; passages: string[] } | null;
  };
  calendrier: { lundi: number; aujourdhui: number; jours: string[]; creneaux: Creneau[]; lignes: typeof LIGNES; /** Les 7 nuits d'astreinte (lundi à dimanche). */ nuits: { agent: string; nom: string }[] };
  cerveau: {
    /** Les règles de base, garanties par le code. */
    regles: string[];
    /** Une information, pas une règle : l'agent d'astreinte cette nuit. */
    nuit: string;
    /** Mes règles, écrites dans le Cerveau, lues par L, Light, Clara et Mafe à chaque passage. */
    mesRegles: RegleQG[];
    /** Ce que L a retenu (ses leçons d'écriture), toutes, modifiables dans le Cerveau. */
    lecons: string[];
    agents: CerveauAgent[];
  };
  /** Les agents de présence (Stalker : Claude Code avec moi sur le Mac) actifs maintenant (signe depuis moins de 15 min). */
  presences: string[];
  /** L'agent d'astreinte cette nuit (rotation fixe, un agent différent chaque nuit). */
  astreinte: string;
  /** Le planning de la semaine : un agent différent chaque nuit. */
  planningAstreinte: { jour: string; agent: string }[];
  /** Luffy veille vraiment (il a vérifié les sites depuis moins de 20 min) : le veilleur de nuit reste à son poste. */
  luffyVeille: boolean;
  /** Les réunions de crise (60 jours), la plus récente d'abord : seulement celles ouvertes par une vraie alerte. */
  crise: { reunions: ReunionVue[] };
  /** Ce que j'ai dit d'ignorer sur Telegram (« ignore Livreo ») et la pause des alertes ; absent dans /demo. */
  silence?: VueSilence;
};

function lire<T>(brut: string | undefined): T | null {
  if (!brut) return null;
  try { return JSON.parse(brut) as T; } catch { return null; }
}
/**
 * Les débuts de tâche écrits avant que le journal ne garde le statut (avant le 10 novembre) : reconnus à leur texte
 * (voir src/server/clara/*.ts et src/server/light/api.ts). L écrit toujours « au travail », sans fin : rien n'est retiré.
 */
const DEBUTS: Record<string, string[]> = {
  clara: ['applique les bannissements', 'met des mails a la corbeille', 'compte les mails par expediteur', 'prepare des questions', 'verifie la connexion a gmail', 'cherche les contacts a proteger'],
  light: ['releve du matin'],
};
const ERREUR = /interromp|impossible/;
/** Le statut d'une entrée du journal : écrit depuis le 10 novembre, deviné à son texte avant. */
function statutDe(e: Entree): 'debut' | 'fin' | 'erreur' {
  if (e.statut) return e.statut === 'erreur' ? 'erreur' : e.statut === 'au travail' ? 'debut' : 'fin';
  const t = simple(e.texte);
  if (DEBUTS[e.agent]?.includes(t)) return 'debut';
  return ERREUR.test(t) ? 'erreur' : 'fin';
}
const FIN_SOUS = 10 * MIN;
const reel = (agent: string) => (AGENTS_REELS as readonly string[]).includes(agent);
/** Le débrief d'une réunion de crise : la seule ligne de Kuroro qui compte dans le journal des Tâches. */
const debrief = (e: Entree) => e.agent === 'kuroro' && estLigneJournal(e.texte);
/** Le bruit de l'installation (scripts/agent-test.mjs, 8 novembre) : « TEST · vérifie que le branchement fonctionne ». */
export const estTest = (texte: string) => /^TEST\b/.test(texte.trim());
/** Les agents à la demande, sans routine. */
const SUR_DEMANDE: string[] = []; // Clara a ses routines depuis le 10 novembre

/** Le prochain créneau de l'agent après `now` (cette semaine ou la suivante). */
export function prochainCreneau(agent: string, lundi: number, now: number, pauses?: Pauses): { quand: number; titre: string } | null {
  let mieux: { quand: number; titre: string } | null = null;
  for (const r of ROUTINES) {
    if (r.agent !== agent || r.conditionnel || r.prevu) continue;
    for (const semaine of [0, 1]) for (const jour of r.jours) for (const heure of r.heures) {
      const quand = aHeure(lundi + (semaine * 7 + jour) * JOUR, heure);
      if (quand <= now || (r.actif !== undefined && quand < r.actif) || routineEnPause(r, quand)) continue;
      if (pauses && enPauseA(pauses, agent, quand)) continue;
      if (!mieux || quand < mieux.quand) mieux = { quand, titre: r.titre };
    }
  }
  return mieux;
}
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const aHeure = (base: number, heure: string) => { const [h, m] = heure.split(':').map(Number); return base + h * H + m * MIN; };

/**
 * Les passages des routines réelles d'une semaine (`lundi` : son lundi 00:00 UTC), avec leur état : pour le compte rendu
 * du matin, qui regarde aussi la veille (la semaine d'avant, un lundi). Mêmes règles que le Calendrier.
 */
export function passagesSemaine(lundi: number, now: number, journal: Entree[], messages: Record<string, MessageJour>, extra: Extra = {}): Creneau[] {
  return creneaux(ROUTINES, lundi, now, journal, messages, false, extra);
}

/** Ce que le calendrier sait en plus : les pauses décidées par le patron, et la file des missions. */
export type Extra = { pauses?: Pauses; missions?: DonneesMissions };
const SANS_MISSIONS: DonneesMissions = { passages: {}, traces: [], enAttente: [], pauses: {} };

function creneaux(routines: Routine[], lundi: number, now: number, journal: Entree[], messages: Record<string, MessageJour>, rienARediger: boolean, extra: Extra = {}): Creneau[] {
  const out: Creneau[] = [];
  for (const r of routines) for (const jour of r.jours) for (const heure of r.heures) {
    const quand = aHeure(lundi + jour * JOUR, heure);
    const c: Creneau = {
      routine: r.id, agent: r.agent, nom: NOMS[r.agent] ?? r.agent, titre: r.titre, jour, heure, quand, etat: 'prevu',
      ...(r.accord ? { accord: true } : {}), ...(r.conditionnel ? { conditionnel: true } : {}), ...(r.prevu ? { prevu: true } : {}),
    };
    if (r.prevu) { /* gris, sans état */ } else if (r.actif !== undefined && quand < r.actif) c.etat = 'inactif';
    else if (routineEnPause(r, quand)) c.etat = 'pause';
    else c.etat = r.id === 'qg-missions' ? etatPassageMissions(quand, now, extra.missions ?? SANS_MISSIONS)
      : r.conditionnel ? etatRelance(quand, now, messages[jourDe(quand)]) : etatPassage(c, r.motifs ?? [], now, journal);
    // mis en pause par le patron : « en pause (par toi) », jamais raté (un passage fait quand même reste fait)
    if (c.etat !== 'fait' && c.etat !== 'inactif' && c.etat !== 'pause' && extra.pauses && enPauseA(extra.pauses, r.agent, quand)) c.etat = 'pause';
    if (c.etat === 'rate' && r.id === 'l-redaction' && rienARediger) c.etat = 'rien-a-faire';
    out.push(c);
  }
  return out.sort((a, b) => a.quand - b.quand || a.nom.localeCompare(b.nom));
}

const simple = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/** La tâche commence par l'un des motifs. */
const correspond = (texte: string, motifs: string[]) => { const t = simple(texte); return motifs.some(m => t.startsWith(m)); };

/**
 * Fait : une entrée de l'agent dans [heure, heure + 3 h) dont la tâche est celle de la routine
 * (la plus récente est montrée). Raté : 1 h passée sans une telle entrée.
 */
function etatPassage(c: Creneau, motifs: string[], now: number, journal: Entree[]): EtatCreneau {
  // fait à l'heure (dans la fenêtre) ou rattrapé plus tard le même jour (par exemple relancé à la main) : plus « raté »
  const finDuJour = Date.UTC(new Date(c.quand).getUTCFullYear(), new Date(c.quand).getUTCMonth(), new Date(c.quand).getUTCDate()) + 24 * 60 * 60 * 1000;
  const e = journal.find(x => x.agent === c.agent && x.type === 'etat' && x.quand >= c.quand && x.quand < Math.max(c.quand + FENETRE, finDuJour) && correspond(x.texte, motifs));
  if (e) { c.entree = { quand: e.quand, texte: e.texte, ...(e.resultat ? { resultat: e.resultat } : {}) }; return 'fait'; }
  return now >= c.quand + RETARD ? 'rate' : 'a-venir';
}

/** Une relance n'a lieu que si le relevé du jour a été envoyé et pas encore vu à l'heure prévue. */
function etatRelance(quand: number, now: number, m: MessageJour | undefined): EtatCreneau {
  if (m?.relances?.some(t => t >= quand && t < quand + FENETRE)) return 'fait';
  if (now < quand + RETARD) return 'a-venir';
  const attendue = !!m?.envoye && m.envoye < quand && !(m.vu && m.vu <= quand + RETARD);
  return attendue ? 'rate' : 'sans-objet';
}

const JOURS_COURTS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

/**
 * Le planning des astreintes de la semaine (rotation fixe, sans IA) : une seule entrée du journal par semaine ISO (setnx), la première fois que la
 * semaine est lue. Kuroro n'est pas un agent réel : cette entrée n'entre ni dans Tâches ni dans le Calendrier.
 */
async function annoncerAstreintes(kv: KV, now: number, planning: { agent: string }[]) {
  const { annee, semaine } = semaineISO(now);
  if (!(await kv.setnx(`qg:astreinte:${annee}-W${semaine}`, '1', 15 * 24 * 3600))) return;
  const liste = planning.map((p, i) => `${JOURS_COURTS[i]} ${NOMS[p.agent] ?? p.agent}`).join(', ');
  await journaliser(kv, { quand: now, agent: 'kuroro', type: 'etat', statut: 'termine', texte: `Planning des astreintes, à tour de rôle : ${liste}`, origine: 'agent' });
}

export async function vuesQG(kv: KV, now = Date.now()): Promise<VuesQG> {
  const astreinte = astreinteDuJour(now);
  const planningAstreinte = planningSemaine(now);
  await annoncerAstreintes(kv, now, planningAstreinte).catch(() => {});
  const [brutEtats, brutJournal, attente, accords, propositions, brutPosts, brutMessages, memL, clara, mafe, luffy, isaac, tourZoro, lea, paul, ye, feu] = await Promise.all([
    kv.hgetall(CLES.etats), kv.lrange(CLES.journal, 0, -1), idsEnAttente(kv), kv.hgetall(CLES_ACCORDS.tous),
    kv.hgetall(CLE_PROPOSITIONS), kv.hgetall(CLE_POSTS), kv.hgetall(CLES_LIGHT.messages), lireMemoire(kv), vueClara(kv),
    vueMafe(kv, now).catch(() => ({ releve: null, derniereNote: null, message: null })),
    vueLuffy(kv, now).catch(() => null),
    vueIsaac(kv, now).catch(() => null),
    lireTour(kv).catch(() => null),
    vueLea(kv, now).catch(() => null),
    vuePaul(kv, now).catch(() => null),
    vueYe(kv, now).catch(() => null),
    vueFeu(kv, now).catch(() => null),
  ]);
  const reunions = await lireReunions(kv).then(r => vuesReunions(r, now)).catch(() => []);
  const silence = await vueSilence(kv, now).catch(() => ({ ignores: [], pause: null }));
  const donneesMissions = await lireDonneesMissions(kv).catch(() => SANS_MISSIONS);
  const pauses = donneesMissions.pauses;
  const extra: Extra = { pauses, missions: donneesMissions };
  const mesRegles = await lireRegles(kv).catch(() => []);
  const presences = await presencesActives(kv, now).catch(() => []);
  // le journal est rangé du plus récent au plus ancien
  const journal = brutJournal.flatMap(v => { const e = lire<Entree>(v); return e && !estTest(e.texte) ? [e] : []; });
  const messages: Record<string, MessageJour> = {};
  for (const [jour, v] of Object.entries(brutMessages)) { const m = lire<MessageJour>(v); if (m) messages[jour] = m; }

  // ── Tâches
  const enCours = Object.values(brutEtats).flatMap(v => { const e = lire<Etat>(v); return e ? [e] : []; })
    .filter(e => reel(e.agent) && e.statut === 'au travail' && now - e.quand < EN_COURS_MAX && !estTest(e.tache))
    .sort((a, b) => b.quand - a.quand)
    .map(e => {
      const outil = e.outil ?? (ROUTINES_CLAUDE.includes(e.agent) ? 'C' : undefined);
      return { agent: e.agent, tache: e.tache, depuis: e.quand, ...(outil ? { outil } : {}) };
    });

  const enAttente: VuesQG['taches']['enAttente'] = [];
  const accordsL = attente.filter(id => lire<Accord>(accords[id])?.agent === 'L').length;
  if (accordsL) enAttente.push({ agent: 'L', texte: 'brouillon à valider', nombre: accordsL, ouvre: 'bureauL' });
  const courante = Object.values(propositions).flatMap(v => { const p = lire<Proposition>(v); return p ? [p] : []; }).sort((a, b) => b.quand - a.quand)[0];
  // comme L (CONSIGNES § 8, rédaction) : rien à écrire sans proposition, ou si chaque sujet est déjà rédigé
  const posts = Object.values(brutPosts).flatMap(v => { const p = lire<Post>(v); return p ? [p] : []; });
  const rediges = courante ? await sujetsRediges(kv, courante, posts) : [];
  const rienARediger = !courante || courante.sujets.every((_, i) => rediges.includes(i));
  if (courante && courante.choix === undefined) enAttente.push({ agent: 'L', texte: 'choisir un sujet', ouvre: 'bureauL' });
  if (clara.questions.length) enAttente.push({ agent: 'clara', texte: 'question à répondre', nombre: clara.questions.length, ouvre: 'bureauClara' });
  const luffyVeille = !!luffy && luffy.dernier !== null && !luffy.endormi;
  const isaacVeille = !!isaac?.mac.enLigne;
  const sitesEnPanne = luffyVeille ? luffy.sites.filter(s => !s.enLigne) : [];
  if (sitesEnPanne.length) enAttente.push({ agent: 'luffy', texte: sitesEnPanne.length > 1 ? 'sites en panne' : 'site en panne', nombre: sitesEnPanne.length, ouvre: 'bureauLuffy' });
  const nbPropositions = isaac?.propositions.length ?? 0;
  if (nbPropositions) enAttente.push({ agent: 'isaac', texte: nbPropositions > 1 ? 'propositions à valider' : 'proposition à valider', nombre: nbPropositions, ouvre: 'bureauIsaac' });
  // Léa relit toutes les heures : sans passage complet depuis 3 h (ou jamais), elle est comptée bloquée, pas « en service »
  const leaVeille = !!lea && !lea.absente;
  // un essai raté de moins de 3 h dit ce qui n'a pas marché (elle est passée, sans finir), au lieu de « n'est pas passée depuis »
  const leaNote = lea ? noteTentative(lea.tentative, now) ?? (lea.passage == null ? 'pas encore de relecture' : `n'est pas passée depuis ${duree(now - lea.passage)}`) : 'pas encore de relecture';
  const graves = lea ? gravesOuverts(lea.constats).length : 0;
  if (graves) enAttente.push({ agent: 'lea', texte: graves > 1 ? 'points graves à corriger' : 'point grave à corriger', nombre: graves, ouvre: 'bureauLea' });
  const aValiderPaul = paul?.attente.length ?? 0;
  if (aValiderPaul) enAttente.push({ agent: 'paul', texte: aValiderPaul > 1 ? 'propositions à valider' : 'proposition à valider', nombre: aValiderPaul, ouvre: 'bureauPaul' });
  const aValiderYe = ye?.attente.length ?? 0, questionsYe = ye?.questions.length ?? 0;
  if (aValiderYe) enAttente.push({ agent: 'ye', texte: aValiderYe > 1 ? 'fiches à valider' : 'fiche à valider', nombre: aValiderYe, ouvre: 'bureauYe' });
  if (questionsYe) enAttente.push({ agent: 'ye', texte: questionsYe > 1 ? 'questions de compétences' : 'question de compétence', nombre: questionsYe, ouvre: 'bureauYe' });
  // Feu : un plan d'ordres au Signal (calculé par le code) attend ton regard ; la décision reste la tienne
  const signauxFeu = feu?.passage?.statuts.filter(s => s.statut === 'Signal').length ?? 0;
  if (signauxFeu) enAttente.push({ agent: 'feu', texte: signauxFeu > 1 ? 'plans d\'ordres à regarder' : 'plan d\'ordres à regarder', nombre: signauxFeu, ouvre: 'bureauFeu' });
  // Feu lit le marché toutes les 15 min, dès sa mise en service ; avant, il n'est jamais « bloqué »
  const feuVeille = !!feu?.passage && !feu.passage.erreur && now - feu.passage.quand < FEU_VEILLE_MS;
  const duJour = messages[jourDe(now)];
  if (duJour?.envoye && !duJour.vu) enAttente.push({ agent: 'light', texte: 'relevé du jour envoyé, pas encore vu', ouvre: 'releveLight' });

  // les missions que je dépose ne sont pas du travail fait : seulement ce que les agents ont écrit eux-mêmes
  const parAgent = new Map<string, number>();
  const recentes = journal.filter(e => (reel(e.agent) || debrief(e)) && e.type === 'etat' && e.quand <= now && now - e.quand < FAITES_JOURS * JOUR);
  // un début (« met des mails à la corbeille ») suivi de sa fin ou d'une erreur du même agent sous 10 min : seule la fin compte
  const suivi = (e: Entree) => recentes.some(x => x !== e && x.agent === e.agent && x.quand >= e.quand && x.quand - e.quand <= FIN_SOUS && statutDe(x) !== 'debut');
  const faites = recentes
    .filter(e => statutDe(e) !== 'debut' || !suivi(e))
    .sort((a, b) => b.quand - a.quand)
    .filter(e => { const n = (parAgent.get(e.agent) ?? 0) + 1; parAgent.set(e.agent, n); return n <= FAITES_MAX; })
    .map(e => ({ quand: e.quand, agent: e.agent, texte: e.texte, ...(e.resultat ? { resultat: e.resultat } : {}), ...(statutDe(e) === 'erreur' ? { erreur: true as const } : {}) }));

  // ── Calendrier
  const minuit = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const aujourdhui = (new Date(now).getUTCDay() + 6) % 7;
  const lundi = minuit - aujourdhui * JOUR;
  const tous = [...creneaux(ROUTINES, lundi, now, journal, messages, rienARediger, extra), ...creneaux(PREVUS, lundi, now, journal, messages, rienARediger)]
    .sort((a, b) => a.quand - b.quand || a.nom.localeCompare(b.nom));
  // le bandeau ne signale que ce qui demande encore une action : pas une routine mise en pause depuis
  const enPause = new Set(ROUTINES.filter(r => routineEnPause(r, now)).map(r => r.id));
  const rates = tous.filter(c => c.jour === aujourdhui && c.etat === 'rate' && !c.conditionnel && !enPause.has(c.routine));
  const alerte = rates.length
    ? { texte: 'Un passage prévu n\'a pas eu lieu (routines bloquées ?)', passages: rates.map(c => `${c.nom} · ${c.heure}`) }
    : null;

  // ── L'état de chaque agent réel
  const agents: EtatAgent[] = AGENTS_REELS.map(agent => {
    const travail = enCours.find(e => e.agent === agent);
    const periode = pauseEnCours(pauses, agent, now);
    const pause = periode ? phrasePause(agent, periode, now) : undefined;
    // une routine mise en pause depuis ne rend pas l'agent « bloqué » (le créneau reste « raté » dans le Calendrier)
    const passe = tous.filter(c => c.agent === agent && c.jour === aujourdhui && !c.prevu && !c.conditionnel && c.quand <= now && !enPause.has(c.routine));
    const bloque = passe.length > 0 && passe[passe.length - 1].etat === 'rate';
    // une pause ou une reprise décidée par moi n'est pas un passage de l'agent
    const dernier = journal.filter(e => e.agent === agent && e.type === 'etat' && e.origine !== 'moi' && e.quand <= now).sort((a, b) => b.quand - a.quand)[0];
    const surDemande = SUR_DEMANDE.includes(agent);
    const continu = agent === 'luffy' || agent === 'isaac' || agent === 'lea' || (agent === 'feu' && feuEnService(now));
    const veille = agent === 'luffy' ? luffyVeille : agent === 'lea' ? leaVeille : agent === 'feu' ? feuVeille : isaacVeille;
    // en pause par le patron : ni bloqué ni endormi
    const sommeil = continu && !veille && !pause;
    // Luffy ne journalise que ses messages, le relais d'Isaac ses seuls événements : leur dernier passage est leur dernier signe
    const signe = agent === 'luffy' ? (luffy?.dernier != null ? { quand: luffy.dernier, texte: 'vérifie les sites' } : null)
      : agent === 'lea' ? (lea?.passage != null ? { quand: lea.passage, texte: 'relit les pushes' } : null)
      : agent === 'feu' ? (feu?.passage ? { quand: feu.passage.quand, texte: 'lit le marché' } : null)
      : isaac?.mac.vu != null ? { quand: isaac.mac.vu, texte: 'surveille la place' } : null;
    return {
      agent, nom: NOMS[agent] ?? agent,
      statut: travail ? 'au travail' : (bloque && !pause) || sommeil ? 'bloque' : 'au repos',
      ...(travail ? { tache: travail.tache } : {}),
      ...(travail?.outil ? { outil: travail.outil } : {}),
      // Paul : son dernier passage est son passage du jeudi (le même que dans son bureau), pas un clic Valider/Refuser
      dernierPassage: continu || agent === 'feu' ? signe
        : agent === 'paul' ? (paul?.passage ? { quand: paul.passage.quand, texte: paul.passage.illisibles.length ? 'a relu la semaine en partie' : 'a relu la semaine' } : null)
        : agent === 'ye' ? (ye?.passage ? { quand: ye.passage.quand, texte: ye.passage.illisibles.length ? 'a comparé la semaine en partie' : 'a comparé la semaine' } : null)
        : dernier ? { quand: dernier.quand, texte: dernier.texte } : null,
      prochainPassage: surDemande || continu ? null : prochainCreneau(agent, lundi, now, pauses),
      ...(continu && veille && !pause ? { rythme: agent === 'luffy' ? 'toutes les 5 min' : agent === 'feu' ? 'toutes les 15 min' : 'toutes les heures' } : {}),
      ...(pause ? { pause } : {}),
      ...(sommeil ? { note: agent === 'feu' ? (feu?.passage == null ? 'pas encore de lecture du marché' : 'ne lit plus le marché') : agent === 'lea' ? leaNote : agent === 'luffy' ? (luffy?.dernier == null ? 'pas encore de vérification' : 'ne vérifie plus') : isaac?.mac.vu == null ? 'pas encore de passage' : 'le Mac est éteint' } : {}),
      ...(surDemande ? { surDemande: true as const } : {}),
    };
  });

  // ── Cerveau
  const n = memL.publies.length;
  const nommes = Object.entries(memL.autorisations).filter(([, v]) => v === 'nomme').map(([p]) => p);
  const nbVip = clara.vip.length;
  const nbBannis = clara.bannis.length;
  const nbNouveaux = clara.bannis.filter(b => now - b.depuis < NOUVEAU).length;
  const phrasesClara = [
    nbVip ? `Protège ${nbVip} VIP (${clara.vip.slice(0, 2).join(', ')}${nbVip > 2 ? '…' : ''}).` : 'Aucun VIP pour l’instant.',
    nbBannis ? `Jette automatiquement les mails de ${pluriel(nbBannis, 'expéditeur')} ${nbBannis > 1 ? 'bannis' : 'banni'}.` : 'Aucun expéditeur banni.',
    // seulement si ce n'est pas « tous » (sinon la phrase n'apporte rien)
    ...(nbNouveaux && nbNouveaux < nbBannis ? [`Dont ${nbNouveaux} ${nbNouveaux > 1 ? 'nouveaux' : 'nouveau'} depuis hier.`] : []),
    ...(clara.gardes.length ? [`${clara.gardes.length} ${clara.gardes.length > 1 ? 'gardés' : 'gardé'}`] : []),
  ];
  const projetsMafe = mafe.releve?.projets.length ?? 0;
  const phrasesMafe = mafe.releve
    ? [`Suit ${pluriel(projetsMafe, 'projet')}${mafe.releve.priorite ? ` ; commence par ${mafe.releve.priorite.nom}` : ''}.`]
    : ['Pas encore de relevé.'];
  const nbSites = luffy?.sites.length ?? 0;
  const phrasesLuffy = !luffy || luffy.dernier === null ? ['Pas encore de vérification.']
    : luffy.endormi ? ['Ne vérifie plus.']
    : [`Surveille ${pluriel(nbSites, 'site')} ; ${sitesEnPanne.length ? `${sitesEnPanne.length} en panne` : 'tous en ligne'}.`];
  // Isaac : une mesure de plus de 3 h n'est pas affirmée alors que le Mac répond
  const mesureFraiche = !!isaac?.place && now - isaac.place.quand < 3 * 3_600_000;
  const aValider = nbPropositions ? ` ; ${pluriel(nbPropositions, 'proposition')} à valider` : '';
  const phrasesIsaac = !isaac || isaac.mac.vu === null ? ['Pas encore de passage.']
    : !isaac.mac.enLigne ? ['Le Mac est éteint.']
    : [`${mesureFraiche ? `Ton Mac a ${goEntier(isaac.place!.libre)} Go libres` : 'Pas de mesure récente'}${aValider}.`];
  const cerveau: VuesQG['cerveau'] = {
    regles: [...REGLES_QG],
    nuit: `Cette nuit, ${NOMS[astreinte] ?? astreinte} est d'astreinte.`,
    mesRegles,
    lecons: [...memL.regles],
    agents: [
      {
        agent: 'L', nom: 'L', ouvre: 'bureauL', lien: 'Le bureau de L', phrases: [
          nommes.length ? `Ne nomme que : ${nommes.map(n => (n.toLowerCase() === 'qg' ? 'le QG' : n)).join(', ')}.` : 'Ne nomme aucun projet.',
          n ? `${pluriel(n, 'post')} ${n > 1 ? 'publiés' : 'publié'}.` : 'Aucun post publié.',
        ],
      },
      {
        agent: 'light', nom: 'Light', ouvre: 'releveLight', lien: 'Le bureau de Light', phrases: [
          `Surveille ${OUTILS_SUIVIS.length} outils dans tes projets perso.`,
          'Te prévient pour une version majeure, 2 versions de retard ou plus, ou une fin de support.',
        ],
      },
      {
        agent: 'clara', nom: 'Clara', ouvre: 'bureauClara', lien: 'Le bureau de Clara', phrases: phrasesClara,
        ...(nbNouveaux ? { nouveau: true as const } : {}),
      },
      { agent: 'mafe', nom: 'Mafe', ouvre: 'bureauMafe', lien: 'Le bureau de Mafe', phrases: phrasesMafe },
      { agent: 'luffy', nom: 'Luffy', ouvre: 'bureauLuffy', lien: 'Le bureau de Luffy', phrases: phrasesLuffy },
      { agent: 'isaac', nom: 'Isaac', ouvre: 'bureauIsaac', lien: 'Le bureau d’Isaac', phrases: phrasesIsaac },
      { agent: 'zoro', nom: 'Zoro', ouvre: 'bureauZoro', lien: 'Le bureau de Zoro', phrases: [phraseZoro(tourZoro)] },
      { agent: 'lea', nom: 'Léa', ouvre: 'bureauLea', lien: 'Le bureau de Léa', phrases: [phraseLea(lea, now)] },
      { agent: 'paul', nom: 'Paul', ouvre: 'bureauPaul', lien: 'Le bureau de Paul', phrases: [phrasePaul(paul)] },
      { agent: 'ye', nom: 'Ye', ouvre: 'bureauYe', lien: 'Le bureau de Ye', phrases: [phraseYe(ye)] },
      { agent: 'feu', nom: 'Feu', ouvre: 'bureauFeu', lien: 'Le bureau de Feu', phrases: [phraseFeu(feu, now), 'Ne passe jamais un ordre : il propose, tu décides.'] },
    ],
  };

  return {
    maintenant: now,
    agents,
    taches: { enCours, enAttente, faites, alerte },
    calendrier: {
      lundi, aujourdhui, jours: TOUS.map(i => jourDe(lundi + i * JOUR)), creneaux: tous,
      nuits: planningAstreinte.map(p => ({ agent: p.agent, nom: NOMS[p.agent] ?? p.agent })),
      // Luffy : le rythme de 5 min n'est affiché que s'il vérifie vraiment
      // un agent mis en pause par le patron : sa ligne le dit (en gris)
      lignes: LIGNES.map(l => pauseEnCours(pauses, l.agent, now) ? { ...l, texte: `${NOMS[l.agent] ?? l.agent} : ${phrasePause(l.agent, pauseEnCours(pauses, l.agent, now)!, now)}`, prevu: true }
        : l.agent === 'luffy' ? (luffyVeille ? { ...l, prevu: false } : luffy?.dernier != null ? { ...l, texte: 'Luffy : ne vérifie plus' } : l)
        : l.agent === 'isaac' ? (isaacVeille ? { ...l, prevu: false } : isaac?.mac.vu != null ? { ...l, texte: 'Isaac : le Mac est éteint' } : l)
        : l.agent === 'feu' ? (feuVeille ? { ...l, prevu: false } : feu?.passage ? { ...l, texte: `Feu : ne lit plus le marché (dernière lecture ${new Date(feu.passage.quand).toISOString().slice(11, 16)})` } : l)
        : l.agent === 'lea' ? (leaVeille ? { ...l, prevu: false } : lea?.passage != null || (lea && noteTentative(lea.tentative, now)) ? { ...l, texte: `Léa : ${leaNote}` } : l) : l),
    },
    cerveau,
    presences,
    astreinte,
    planningAstreinte,
    luffyVeille,
    crise: { reunions },
    silence,
  };
}
