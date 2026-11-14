import type { KV } from '../memoire';
import { journaliser } from '../qg';
import { lireSujets, type Lecture } from './lecture';
import { CLES_CRISE, ecrire, lireReunions } from './stock';
import { messageDebut, messageEscalade, messageFin, messageHeure } from './message';
import { aLaMinute, ligneJournal, niveauDe, type Niveau, type Reunion, type Sujet } from '@/data/crise';
import type { Bouton } from '../telegram';
import { boutonsIgnorer, estIgnore, finirPauseEchue, garder, lireIgnores, nettoyerIgnores, pauseEnCours } from '../silence';

export { CLES_CRISE, lireReunions };

// Le suivi des réunions de crise : appelé juste après chaque passage de Luffy (QStash, toutes les 5 min).
// Il lit les vraies alertes, ouvre une réunion (une seule à la fois), la tient à jour, la ferme quand plus rien ne la
// justifie, et prévient sur Telegram : 🟠 incident ou 🔴 réunion de crise au début, un message si l'incident devient une
// crise, et un à la fin (de jour comme de nuit : c'est urgent). Le rappel de chaque heure n'est que pour une vraie panne
// (un site de Luffy), 3 au plus par réunion, jamais entre 22:00 et 07:00 ; un point de Léa ou une faille de Zoro (à
// corriger, pas une panne) n'a que le début et la fin.
// Chaque message a sa marque (`crise:annonce:<id>:<quoi>`), posée seulement après un envoi réussi : Telegram en échec,
// rien n'est marqué, nouvel essai au passage suivant (5 min). Un verrou : un passage à la fois.
// Ce que le patron a dit d'ignorer (src/server/silence.ts) ne compte plus pour la réunion ni pour les rappels ; s'il ne
// reste que de l'ignoré, la réunion se termine (« ignoré par toi : … »). Chaque message d'incident, de crise et de rappel
// porte un bouton « Ignorer » par problème. Pendant la pause générale, début, escalade et fin sont gardés pour la fin de
// la pause (et comptent comme partis) ; les rappels de l'heure attendent, sans être marqués.

export type DepsCrise = {
  envoyer: (texte: string, boutons?: Bouton[] | Bouton[][]) => Promise<unknown>;
  /** La lecture des alertes (Upstash) ; remplaçable dans les tests. */
  lire?: (kv: KV, now: number) => Promise<Lecture>;
};

const H = 3_600_000, JOUR = 24 * H;
const VERROU_S = 120;
const MARQUE_S = 30 * 86_400;
/** Une fin pas encore annoncée est encore envoyée pendant 24 h (Telegram en panne longtemps : on n'insiste plus). */
const FIN_A_ANNONCER = JOUR;
/** L'historique : 60 jours, 100 réunions au plus. */
const GARDE_MS = 60 * JOUR, GARDE_MAX = 100;
/** Au plus 3 rappels par réunion, puis le silence jusqu'à la fin. */
const RAPPELS_MAX = 3;
/** Pas de rappel la nuit, de 22:00 à 07:00 (Abidjan = UTC) ; le début et la fin partent quand même. */
const NUIT_RAPPELS = { debut: 22, fin: 7 };
const rappelPermis = (now: number) => { const h = new Date(now).getUTCHours(); return h >= NUIT_RAPPELS.fin && h < NUIT_RAPPELS.debut; };

/** Les agents qui comptent pour la réunion : ceux des alertes graves ; en crise, ceux de toutes les alertes. */
const agentsDe = (sujets: readonly Sujet[], niveau: Niveau) => [...new Set(sujets.filter(s => niveau === 'crise' || s.grave).map(s => s.agent))];

/**
 * Les alertes du passage, reliées à ce que la réunion savait : un même sujet garde son premier `depuis`. Un sujet qui
 * disparaît parce que le patron l'ignore (`ignores`) est marqué ignoré, jamais « réglé ».
 */
function relier(r: Reunion, sujets: Sujet[], now: number, ignores: ReadonlySet<string> = new Set()): Reunion {
  const avant = new Map(r.vus.map(s => [s.cle, s]));
  const ouverts = sujets.map(s => ({ ...s, depuis: Math.min(s.depuis, avant.get(s.cle)?.depuis ?? s.depuis) }));
  const ici = new Set(ouverts.map(s => s.cle));
  const sorti = (s: Sujet): Sujet => {
    if (s.regle !== undefined) return s;
    if (ignores.has(s.cle)) return s.ignore === undefined ? { ...s, ignore: now } : s;
    const propre = { ...s, regle: now };
    delete propre.ignore;
    return propre;
  };
  const vus = [
    ...r.vus.map(s => (ici.has(s.cle) ? { ...ouverts.find(o => o.cle === s.cle)! } : sorti(s))),
    ...ouverts.filter(s => !avant.has(s.cle)),
  ];
  return { ...r, sujets: ouverts, vus };
}

type Envoi = { quoi: string; id: string; texte: string; boutons?: Bouton[][] };
export type ResultatCrise =
  | { occupe: true }
  | { reunion: string | null; niveau: Niveau | null; envoyes: string[]; echecs: string[] };

export async function suivreCrise(kv: KV, deps: DepsCrise, now: number = Date.now()): Promise<ResultatCrise> {
  if (!(await kv.setnx(CLES_CRISE.verrou, String(now), VERROU_S))) return { occupe: true };
  try {
    return await passage(kv, deps, now);
  } finally {
    await kv.del(CLES_CRISE.verrou).catch(() => undefined);
  }
}

async function passage(kv: KV, deps: DepsCrise, now: number): Promise<ResultatCrise> {
  const reunions = await lireReunions(kv);
  const ouverte = reunions.find(r => r.fin === undefined) ?? null;
  const lu = await (deps.lire ?? lireSujets)(kv, now);
  // la pause échue : un seul message dit ce qui a été gardé, avant tout le reste
  await finirPauseEchue(kv, deps.envoyer, now);
  // ce que le patron a dit d'ignorer : oublié si le problème a changé (retour automatique), sinon retiré des alertes
  const ignores = await nettoyerIgnores(kv, await lireIgnores(kv), lu);
  const ignoresIci = new Set([
    ...lu.sujets.filter(s => estIgnore(ignores, s)).map(s => s.cle),
    ...ignores.filter(i => lu.illisibles.includes(i.genre)).map(i => i.cle),
  ]);
  // une source illisible : on garde ce que la réunion en savait (rien ne s'ouvre ni ne se ferme sur une lecture ratée)
  const gardes = ouverte ? ouverte.sujets.filter(s => lu.illisibles.includes(s.genre) && !ignoresIci.has(s.cle)) : [];
  const sujets = [...lu.sujets.filter(s => !ignoresIci.has(s.cle)), ...gardes];
  const niveau = niveauDe(sujets);
  const minute = aLaMinute(now);

  let courante: Reunion | null = null;
  let fermee: (Reunion & { fin: number }) | null = null;
  if (!ouverte && niveau) {
    const id = reunions.some(r => r.id === String(minute)) ? `${minute}-2` : String(minute);
    courante = { id, niveau, debut: minute, sujets, vus: sujets, agents: agentsDe(sujets, niveau), vu: now };
    await ecrire(kv, courante);
  } else if (ouverte && niveau) {
    const r = relier(ouverte, sujets, now, ignoresIci);
    const niv: Niveau = ouverte.niveau === 'crise' || niveau === 'crise' ? 'crise' : 'incident'; // une crise ne redescend pas
    courante = {
      ...r, niveau: niv, agents: [...new Set([...ouverte.agents, ...agentsDe(sujets, niv)])], vu: now,
      ...(ouverte.niveau === 'incident' && niv === 'crise' ? { escalade: now } : {}),
    };
    await ecrire(kv, courante);
  } else if (ouverte) {
    const r = relier(ouverte, sujets, now, ignoresIci);
    fermee = { ...r, fin: Math.max(minute, ouverte.debut), vu: now };
    await ecrire(kv, fermee);
    // le débrief : une seule ligne dans le journal, au nom de Kuroro
    await journaliser(kv, { quand: now, agent: 'kuroro', type: 'etat', statut: 'termine', texte: ligneJournal(fermee), origine: 'agent' });
  }

  // ── Telegram : les fins pas encore annoncées (la réunion fermée à l'instant, ou une fin dont l'envoi a échoué)
  const envois: Envoi[] = [];
  const finies = [...(fermee ? [fermee] : []), ...reunions.filter(r => r.fin !== undefined && r.id !== fermee?.id && now - r.fin < FIN_A_ANNONCER)] as (Reunion & { fin: number })[];
  for (const r of finies) if ((await kv.get(CLES_CRISE.annonce(r.id, 'fin'))) === null) envois.push({ quoi: 'fin', id: r.id, texte: messageFin(r) });
  const enPause = (await pauseEnCours(kv, now)) !== null;
  if (courante) {
    const heures = Math.floor((now - courante.debut) / H);
    // un bouton « Ignorer » par problème ouvert de la réunion
    const boutons = boutonsIgnorer(courante.sujets);
    if ((await kv.get(CLES_CRISE.annonce(courante.id, 'debut'))) === null) {
      envois.push({ quoi: 'debut', id: courante.id, texte: messageDebut(courante, now), boutons });
    } else if (courante.escalade !== undefined && (await kv.get(CLES_CRISE.annonce(courante.id, 'escalade'))) === null) {
      envois.push({ quoi: 'escalade', id: courante.id, texte: messageEscalade(courante, now), boutons });
    } else if (
      courante.sujets.some(s => s.genre === 'site') && heures >= 1 && heures <= RAPPELS_MAX && rappelPermis(now) && !enPause
      && (await kv.get(CLES_CRISE.annonce(courante.id, `h${heures}`))) === null
    ) {
      envois.push({ quoi: `h${heures}`, id: courante.id, texte: messageHeure(courante, now), boutons });
    }
  }
  const envoyes: string[] = [], echecs: string[] = [];
  for (const e of envois) {
    try {
      // pendant la pause : gardé pour la fin de la pause (et compté comme parti)
      if (enPause) await garder(kv, e.texte);
      else await deps.envoyer(e.texte, e.boutons);
    } catch {
      console.error('crise : envoi Telegram échoué');
      echecs.push(`${e.id}:${e.quoi}`);
      continue;
    }
    await kv.setnx(CLES_CRISE.annonce(e.id, e.quoi), String(now), MARQUE_S);
    envoyes.push(`${e.id}:${e.quoi}`);
    // un début annoncé en retard dit déjà où on en est (niveau compris) : ni rappel de l'heure, ni « devient une crise » derrière
    if (courante && e.quoi === 'debut') {
      const heures = Math.floor((now - courante.debut) / H);
      if (heures >= 1) await kv.setnx(CLES_CRISE.annonce(e.id, `h${heures}`), String(now), MARQUE_S);
      if (courante.escalade !== undefined) await kv.setnx(CLES_CRISE.annonce(e.id, 'escalade'), String(now), MARQUE_S);
    }
  }

  // ── l'historique : 60 jours, 100 réunions au plus (jamais la réunion en cours)
  const gardees = new Set(reunions.filter(r => r.fin === undefined || now - r.fin < GARDE_MS).slice(0, GARDE_MAX).map(r => r.id));
  for (const r of reunions) if (!gardees.has(r.id) && r.fin !== undefined) await kv.hdel(CLES_CRISE.reunions, r.id);

  return { reunion: courante?.id ?? null, niveau: courante?.niveau ?? null, envoyes, echecs };
}
