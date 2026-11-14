import type { KV } from '../memoire';
import { CLES_LUFFY, type EtatSite } from '../luffy/vigie';
import { SITES } from '../luffy/sites';
import { lireConstats } from '../lea/relecture';
import { gravesOuverts, nomCourt } from '../lea/etiquette';
import { lireTour } from '../zoro/tour';
import { nettoyer } from '../zoro/importance';
import { ROUTINES, vuesQG } from '../vues';
import { PANNE_INCIDENT, type GenreSujet, type Sujet } from '@/data/crise';

// Les vraies alertes ouvertes, lues dans Upstash là où les agents les rangent : jamais une alerte inventée.
//   Luffy : un site dont la panne a été annoncée (2 échecs de suite) ; grave à 10 min de panne ou plus.
//   Léa : un point grave pas encore marqué « Vu ». Zoro : une faille critique de son dernier tour.
//   Le bandeau des Tâches : un passage prévu aujourd'hui qui n'a pas eu lieu (compte seulement pour la crise).

/** Le nom du projet d'un site (les deux adresses de Livreo sont un seul projet) ; sinon le nom du site. */
const PROJET_DU_SITE: Record<string, string> = { 'api-livreo': 'Livreo', 'admin-livreo': 'Livreo' };

/** La raison d'une panne en peu de mots : « 503 », « délai dépassé », « site introuvable ». Jamais une adresse. */
const raisonCourte = (raison: string | undefined) => {
  const code = raison?.match(/^erreur (\d{3})$/);
  return code ? code[1] : raison === 'délai dépassé' || raison === 'site introuvable' ? raison : 'ne répond plus';
};

function lire<T>(brut: string | undefined): T | undefined {
  if (!brut) return undefined;
  try { return JSON.parse(brut) as T; } catch { return undefined; }
}

async function sitesEnPanne(kv: KV, now: number): Promise<Sujet[]> {
  const etats = await kv.hgetall(CLES_LUFFY.etat);
  return SITES.flatMap(s => {
    const e = lire<EtatSite>(etats[s.id]);
    if (!e?.annoncee || typeof e.depuis !== 'number') return [];
    return [{
      cle: `site:${s.id}`, genre: 'site' as const, agent: 'luffy', projet: PROJET_DU_SITE[s.id] ?? s.nom, nom: s.nom,
      detail: raisonCourte(e.raison), depuis: e.depuis, grave: now - e.depuis >= PANNE_INCIDENT,
    }];
  });
}

async function pointsGraves(kv: KV): Promise<Sujet[]> {
  return gravesOuverts(await lireConstats(kv)).map(c => ({
    cle: `lea:${c.id}`, genre: 'lea' as const, agent: 'lea', projet: nomCourt(c.depot), nom: nomCourt(c.depot),
    detail: nettoyer(c.quoi).slice(0, 70), depuis: c.quand, grave: true,
  }));
}

async function faillesCritiques(kv: KV): Promise<Sujet[]> {
  const t = await lireTour(kv);
  if (!t) return [];
  return t.importants.filter(i => i.partie === 'failles' && i.texte.startsWith('faille critique')).map(i => ({
    cle: `zoro:${i.cle}`, genre: 'zoro' as const, agent: 'zoro', projet: nettoyer(i.projet), nom: nettoyer(i.projet),
    detail: nettoyer(i.texte), depuis: t.quand, grave: true,
  }));
}

/** Les passages prévus aujourd'hui et ratés, comme le bandeau des Tâches (hors routines en pause et relances). */
async function passagesRates(kv: KV, now: number): Promise<Sujet[]> {
  const v = await vuesQG(kv, now);
  const enPause = new Set(ROUTINES.filter(r => r.pause !== undefined && r.pause <= now).map(r => r.id));
  return v.calendrier.creneaux
    .filter(c => c.jour === v.calendrier.aujourdhui && c.etat === 'rate' && !c.conditionnel && !enPause.has(c.routine))
    .map(c => ({
      cle: `routine:${c.routine}@${c.quand}`, genre: 'routine' as const, agent: c.agent, projet: c.nom, nom: `${c.nom} · ${c.titre}`,
      detail: 'aucune trace dans le journal', depuis: c.quand, grave: false,
    }));
}

export type Lecture = { sujets: Sujet[]; /** Les sources qui n'ont pas pu être lues : le suivi y garde ce qu'il savait. */ illisibles: GenreSujet[] };

/** Toutes les alertes ouvertes maintenant. Une source illisible n'ouvre rien et ne ferme rien (jamais d'alerte supposée). */
export async function lireSujets(kv: KV, now: number): Promise<Lecture> {
  const sources: [GenreSujet, () => Promise<Sujet[]>][] = [
    ['site', () => sitesEnPanne(kv, now)], ['lea', () => pointsGraves(kv)],
    ['zoro', () => faillesCritiques(kv)], ['routine', () => passagesRates(kv, now)],
  ];
  const lus = await Promise.all(sources.map(async ([genre, f]) => {
    try { return { genre, sujets: await f() }; } catch { return { genre, sujets: null }; }
  }));
  return {
    sujets: lus.flatMap(l => l.sujets ?? []),
    illisibles: lus.filter(l => l.sujets === null).map(l => l.genre),
  };
}
