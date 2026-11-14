import { POLES, agentById } from '@/sim/routing';
import { duree } from './duree';

// Les réunions de crise (décision du patron, 12 novembre 2026) : partagé par le serveur (src/server/crise/) et la page.
// Une réunion n'existe que si une vraie alerte existe (Luffy, Léa, Zoro, passages prévus ratés) : jamais simulée,
// jamais dans /demo. Fonctions pures, sans réseau. Heure d'Abidjan = UTC.

const MIN = 60_000;

/** Incident : petite réunion. Crise : tous les cadres. */
export type Niveau = 'incident' | 'crise';
/** D'où vient l'alerte : un site en panne (Luffy), un point grave (Léa), une faille critique (Zoro), un passage raté. */
export type GenreSujet = 'site' | 'lea' | 'zoro' | 'routine';

/** Une vraie alerte ouverte, telle que le suivi l'a lue dans Upstash. Jamais de secret : genre, projet, code. */
export type Sujet = {
  /** Unique et stable d'un passage à l'autre : « site:api-livreo », « lea:<id> », « zoro:<clé> », « routine:<id>@<heure> ». */
  cle: string;
  genre: GenreSujet;
  /** L'agent qui a donné l'alerte (luffy, lea, zoro, ou l'agent de la routine ratée). */
  agent: string;
  /** Le nom du projet (« Livreo ») ou de l'agent pour une routine. */
  projet: string;
  /** Le nom précis (« API Livreo ») ou le titre de la routine. */
  nom: string;
  /** Le vrai problème, en peu de mots : « 503 », « délai dépassé », « clé GitHub poussée », « faille critique dans next 15.0.0 ». */
  detail: string;
  /** Début du problème (1er échec, constat, tour, heure du passage). */
  depuis: number;
  /** Compte à lui seul pour un incident (site en panne depuis 10 min ou plus, point grave, faille critique). */
  grave: boolean;
  /** Réglé à cet instant (seulement dans `vus`, une fois le sujet disparu). */
  regle?: number;
  /** Ignoré par le patron à cet instant (« c'est connu », sur Telegram) : sorti de la réunion sans être réglé. */
  ignore?: number;
};

/** Une réunion, gardée dans Upstash (`crise:reunions`). `fin` absente : la réunion est en cours. */
export type Reunion = {
  id: string;
  niveau: Niveau;
  /** Le passage où l'alerte a été vue, à la minute. */
  debut: number;
  /** Le passage où plus rien ne la justifiait, à la minute. */
  fin?: number;
  /** Les alertes ouvertes au dernier passage. */
  sujets: Sujet[];
  /** Toutes les alertes vues pendant la réunion, avec l'heure où elles se sont réglées. */
  vus: Sujet[];
  /** Les agents qui ont donné une alerte pendant la réunion. */
  agents: string[];
  /** Le dernier passage du suivi. */
  vu: number;
  /** Ouverte en incident, devenue une crise à cet instant (un seul message Telegram pour le dire). */
  escalade?: number;
};

/** Ce que la page reçoit pour la salle : la réunion en cours (ou son débrief) et quand chaque agent revérifie. */
export type ReunionScene = Reunion & {
  /** sujet → prochaine vérification réelle (Luffy : son dernier passage + 5 min ; Zoro : son prochain tour). */
  relances: Record<string, number>;
};

/** Ce que le Calendrier et l'historique montrent d'une réunion. */
export type ReunionVue = {
  id: string; niveau: Niveau; debut: number; fin?: number;
  /** Les points de situation passés (xx:00 et xx:30), dans l'ordre. */
  points: number[];
  /** Le prochain point (réunion en cours). */
  prochain?: number;
  /** « Livreo en panne depuis 12 min » (en cours) ou ce qui l'a ouverte. */
  titre: string;
  /** « Livreo revenu » (finie). */
  bilan?: string;
  participants: string[];
};

// ───────────── Les seuils ─────────────

/** Un site compte comme incident quand sa panne (annoncée par Luffy) dure depuis 10 min ou plus. */
export const PANNE_INCIDENT = 10 * MIN;
/** Crise : au moins 2 sites en panne en même temps, ou 5 alertes ouvertes ou plus. */
export const SITES_CRISE = 2;
export const ALERTES_CRISE = 5;

/** Le niveau qu'appellent les alertes ouvertes ; null : pas de réunion. */
export function niveauDe(sujets: readonly Sujet[]): Niveau | null {
  const sites = sujets.filter(s => s.genre === 'site').length;
  if (sites >= SITES_CRISE || sujets.length >= ALERTES_CRISE) return 'crise';
  return sujets.some(s => s.grave) ? 'incident' : null;
}

// ───────────── Qui vient ─────────────

const reelle = (id: string) => { const a = agentById(id); return !!a && !a.plusTard; };
const chefDe = (id: string) => POLES.find(p => p.id === agentById(id)?.pole)?.chef;

/**
 * Les participants. Incident : Kuroro, le chef du pôle concerné, l'agent qui a donné l'alerte. Crise : Kuroro, Stalker,
 * Obito, les chefs de pôle et les agents concernés. La nuit (bureau fermé) : seulement Kuroro et l'agent d'astreinte.
 */
export function participantsDe(niveau: Niveau, agents: readonly string[], nuit: boolean, astreinte: string | null): string[] {
  const liste = nuit ? ['kuroro', ...(astreinte ? [astreinte] : [])]
    : niveau === 'crise' ? ['kuroro', 'stalker', 'obito', ...POLES.map(p => p.chef), ...agents]
    : ['kuroro', ...agents.flatMap(a => chefDe(a) ?? []), ...agents];
  return [...new Set(liste)].filter(reelle);
}

/** Le nom court d'un agent : « Kuroro » (et non « Kuroro Lucifer »), « Léa ». */
export const nomCourt = (id: string) => (agentById(id)?.nom ?? id).split(' ')[0];

/** « Kuroro, Stalker et Luffy ». */
export function enMots(noms: readonly string[]): string {
  if (noms.length <= 1) return noms[0] ?? '';
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
}

// ───────────── Les heures ─────────────

/** Combien de temps tout le monde reste en salle : au début, à chaque point, au débrief. */
export const DUREE_DEBUT = 10 * MIN, DUREE_POINT = 5 * MIN, DUREE_DEBRIEF = 5 * MIN;
/** Un point de situation toutes les 30 minutes, à heure pile et à la demie. */
export const PAS_POINT = 30 * MIN;

export const aLaMinute = (ms: number) => ms - (((ms % MIN) + MIN) % MIN);
/** « 14:05 » (heure d'Abidjan = UTC). */
export const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** Le premier xx:00 ou xx:30 strictement après `t`. */
export const prochainPoint = (t: number) => (Math.floor(t / PAS_POINT) + 1) * PAS_POINT;

/** Les points de situation d'une réunion jusqu'à `jusqua` (inclus) : les xx:00 et xx:30 après son début, avant sa fin. */
export function pointsDe(r: Pick<Reunion, 'debut' | 'fin'>, jusqua: number): number[] {
  const out: number[] = [];
  const limite = r.fin === undefined ? jusqua : Math.min(jusqua, r.fin);
  for (let p = prochainPoint(r.debut); p <= limite; p += PAS_POINT) out.push(p);
  return out;
}

export type Phase = 'debut' | 'point' | 'debrief';

/** Les participants sont-ils en salle maintenant ? Au début (10 min), à chaque point (5 min), au débrief (5 min). */
export function phaseA(r: Pick<Reunion, 'debut' | 'fin'>, now: number): Phase | null {
  if (now < r.debut) return null;
  if (r.fin !== undefined) return now >= r.fin && now < r.fin + DUREE_DEBRIEF ? 'debrief' : null;
  if (now < r.debut + DUREE_DEBUT) return 'debut';
  const p = Math.floor(now / PAS_POINT) * PAS_POINT;
  return p > r.debut && now < p + DUREE_POINT ? 'point' : null;
}

/** La réunion compte encore pour la salle : en cours, ou dans son débrief. */
export const enCours = (r: Pick<Reunion, 'debut' | 'fin'>, now: number) => r.fin === undefined || now < r.fin + DUREE_DEBRIEF;

// ───────────── Les mots ─────────────

const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? `${n} ${plusieurs}` : un);
export const projetsDe = (l: readonly Sujet[]) => [...new Set([...l].sort((a, b) => a.depuis - b.depuis).map(s => s.projet))];
const plusAncien = (l: readonly Sujet[]) => Math.min(...l.map(s => s.depuis));

/**
 * Les alertes ouvertes en une phrase : « Livreo en panne depuis 12 min », « point grave de Léa dans qg depuis 25 min ».
 * `toujours` : la même chose pour le rappel de chaque heure (« Livreo toujours en panne depuis 1 h 05 »).
 * `now` à null : sans durée, pour l'historique (« Livreo en panne »).
 */
export function resume(sujets: readonly Sujet[], now: number | null, toujours = false): string {
  const t = toujours ? ' toujours' : '';
  const depuis = (l: Sujet[]) => (now === null ? '' : ` depuis ${duree(now - plusAncien(l))}`);
  const morceaux: string[] = [];
  const sites = sujets.filter(s => s.genre === 'site');
  if (sites.length) morceaux.push(`${enMots(projetsDe(sites))}${t} en panne${depuis(sites)}`);
  const lea = sujets.filter(s => s.genre === 'lea');
  if (lea.length) {
    const ouverts = toujours ? (lea.length > 1 ? ' toujours ouverts' : ' toujours ouvert') : '';
    morceaux.push(`${pluriel(lea.length, 'point grave', 'points graves')} de Léa${ouverts} dans ${enMots(projetsDe(lea))}${depuis(lea)}`);
  }
  const zoro = sujets.filter(s => s.genre === 'zoro');
  if (zoro.length) {
    const ouvertes = toujours ? (zoro.length > 1 ? ' toujours ouvertes' : ' toujours ouverte') : '';
    morceaux.push(`${pluriel(zoro.length, 'faille critique', 'failles critiques')}${ouvertes} dans ${enMots(projetsDe(zoro))}${depuis(zoro)}`);
  }
  const routines = sujets.filter(s => s.genre === 'routine');
  if (routines.length) morceaux.push(`${pluriel(routines.length, 'passage prévu', 'passages prévus')}${t} ${routines.length > 1 ? 'ratés' : 'raté'} (${enMots(projetsDe(routines))})`);
  return morceaux.join(' ; ');
}

/**
 * Ce qui s'est réglé, pour la fin : « Livreo revenu après 38 min » (`avecDurees`) ou « Livreo revenu » (journal).
 * Une panne se compte de son début à son retour.
 */
export function bilan(r: Pick<Reunion, 'vus'>, avecDurees: boolean): string {
  // seulement ce qui s'est vraiment réglé (une alerte encore ouverte à la fin, trop petite pour une réunion, n'y est pas)
  const regles = r.vus.filter(s => s.regle !== undefined);
  const apres = (l: Sujet[]) => (avecDurees ? ` après ${duree(Math.max(...l.map(s => s.regle!)) - plusAncien(l))}` : '');
  const morceaux: string[] = [];
  const sites = regles.filter(s => s.genre === 'site');
  for (const projet of projetsDe(sites)) {
    const l = sites.filter(s => s.projet === projet);
    morceaux.push(`${projet} revenu${apres(l)}`);
  }
  const lea = regles.filter(s => s.genre === 'lea');
  if (lea.length) morceaux.push(lea.length > 1 ? 'points graves de Léa réglés' : 'point grave de Léa réglé');
  const zoro = regles.filter(s => s.genre === 'zoro');
  if (zoro.length) morceaux.push(zoro.length > 1 ? 'failles critiques réglées' : 'faille critique réglée');
  const routines = regles.filter(s => s.genre === 'routine');
  if (routines.length && !morceaux.length) morceaux.push(routines.length > 1 ? 'passages ratés rattrapés' : 'passage raté rattrapé');
  // ce que le patron a dit d'ignorer n'est pas « réglé » : on le dit tel quel
  const ignores = r.vus.filter(s => s.ignore !== undefined && s.regle === undefined);
  if (ignores.length) morceaux.push(`ignoré par toi : ${enMots(nomsIgnores(ignores))}`);
  return morceaux.length ? morceaux.join(', ') : 'plus d’alerte ouverte';
}

/** Les noms courts de ce qui a été ignoré : « API Livreo », « point grave de Léa », « failles critiques de Zoro ». */
function nomsIgnores(l: readonly Sujet[]): string[] {
  const noms = l.filter(s => s.genre === 'site').map(s => s.nom);
  const n = (g: GenreSujet) => l.filter(s => s.genre === g).length;
  if (n('lea')) noms.push(n('lea') > 1 ? 'points graves de Léa' : 'point grave de Léa');
  if (n('zoro')) noms.push(n('zoro') > 1 ? 'failles critiques de Zoro' : 'faille critique de Zoro');
  if (n('routine')) noms.push(n('routine') > 1 ? 'passages ratés' : 'passage raté');
  return [...new Set(noms)];
}

/** Le titre de la salle de réunion : « Réunion de crise · Livreo en panne depuis 14 min », « Incident · … ». */
export function titreSalle(r: Reunion, now: number): string {
  const prefixe = r.niveau === 'crise' ? 'Réunion de crise' : 'Incident';
  if (r.fin !== undefined) return `${prefixe} · débrief · ${bilan(r, false)}`;
  return `${prefixe} · ${resume(r.sujets, now)}`;
}

/** La ligne du journal à la fin : « réunion de crise 14:05–14:40 · Livreo revenu ». */
/** Le niveau en mots, comme Telegram et le journal le disent : « incident », « réunion de crise ». */
export const nomNiveau = (n: Niveau) => (n === 'crise' ? 'réunion de crise' : 'incident');

/** La ligne du journal à la fin : « incident 14:05–14:40 · Livreo revenu », « réunion de crise 14:05–14:40 · … ». */
export const ligneJournal = (r: Reunion & { fin: number }) => `${nomNiveau(r.niveau)} ${hhmm(r.debut)}–${hhmm(r.fin)} · ${bilan(r, false)}`;

/** Une ligne de journal de réunion (reconnue par les Tâches) : « incident 14:05–… » ou « réunion de crise 14:05–… ». */
export const estLigneJournal = (texte: string) => /^(incident|réunion de crise) \d\d:\d\d–\d\d:\d\d · /.test(texte);

/**
 * Les bulles de la salle, tirées du vrai problème : « API Livreo : 503 depuis 14:02 » (dit par l'agent qui a donné
 * l'alerte s'il est en salle, sinon par Kuroro), puis « Luffy revérifie dans 5 min » (Kuroro), seulement si la
 * vérification est vraiment prévue. `enSalle` : les participants présents. Trois bulles au plus.
 */
export function bullesReunion(r: ReunionScene, now: number, enSalle: readonly string[]): { agentId: string; texte: string }[] {
  const ici = (id: string) => enSalle.includes(id);
  const porteParole = enSalle.includes('kuroro') ? 'kuroro' : enSalle[0];
  if (!porteParole) return [];
  if (r.fin !== undefined) return [{ agentId: porteParole, texte: `débrief : ${bilan(r, true)}` }];
  const out: { agentId: string; texte: string }[] = [];
  const dits = new Set<string>();
  for (const s of [...r.sujets].sort((a, b) => Number(b.grave) - Number(a.grave) || a.depuis - b.depuis)) {
    const qui = ici(s.agent) && !dits.has(s.agent) ? s.agent : !dits.has(porteParole) ? porteParole : null;
    if (!qui) continue;
    dits.add(qui);
    out.push({ agentId: qui, texte: `${s.nom} : ${s.detail} depuis ${hhmm(s.depuis)}` });
    if (out.length >= 2) break;
  }
  // la suite réelle : quand l'agent revérifie (Luffy toutes les 5 min, Zoro à son prochain tour)
  const suite = r.sujets.flatMap(s => {
    const t = r.relances[s.cle];
    if (t === undefined || t < now - MIN) return [];
    const quand = s.genre === 'site'
      ? `dans ${Math.max(1, Math.ceil((t - now) / MIN))} min`
      : `le ${new Date(t).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })} à ${hhmm(t)}`;
    return [{ agent: s.agent, texte: `${nomCourt(s.agent)} revérifie ${quand}` }];
  })[0];
  if (suite) {
    const qui = !dits.has(porteParole) ? porteParole : enSalle.find(id => !dits.has(id));
    if (qui) out.push({ agentId: qui, texte: suite.texte });
  }
  return out.slice(0, 3);
}
