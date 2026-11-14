// Le relevé de Mafe : où en sont les projets GitHub perso du patron. Aucune IA : le serveur lit, la routine écrit les phrases.
// Le jeton ne part que vers api.github.com (les contenus passent par `repos/…/contents`, jamais par raw.githubusercontent.com).
import type { KV } from '../memoire';
import { Refus } from '../qg';
import { encoderChemin, lire, lireJson, listerDepots, type Recup } from '../light/sources';
import {
  choisirPriorite, derniereCochee, lireCases, lireListe, lireSeance, ouOnSArrete, suiteApres,
  type Avancement, type PointProjet, type Priorite, type Seance, type Version,
} from './avancement';
import { estExclu, nomProjet } from './projets';

export const CLES_MAFE = { releves: 'mafe:releves', notes: 'mafe:notes', messages: 'mafe:messages' } as const;

export type NoteAEcrire = { id: string; depot: string; nom: string; jour: string; jours: string[]; commits: { date: string; message: string; url: string }[] };
export type ReleveMafe = {
  jour: string; quand: number; projets: PointProjet[]; priorite: Priorite; aEcrire: NoteAEcrire[];
  phrase?: string; bilan?: string; pasAJour?: boolean;
};
export type DepsMafe = { fetch: typeof fetch; jeton?: string };

const JOUR_MS = 86_400_000;
const JOURS_PAUSE = 30;
const PAGES_COMMITS = 5;
const JOURS_COMMITS = 7;
const MAX_COMMITS_FICHIER = 30;
const JOURS_CONSERVES = 8;
const BUDGET_MS = 200_000;

export const jourDe = (now: number) => new Date(now).toISOString().slice(0, 10);

function lireBrut<T>(brut: unknown): T {
  return (typeof brut === 'string' ? JSON.parse(brut) : brut) as T;
}

export async function dernierReleve(kv: KV): Promise<ReleveMafe | null> {
  const tous = await kv.hgetall(CLES_MAFE.releves);
  const jour = Object.keys(tous).sort().pop();
  return jour ? lireBrut<ReleveMafe>(tous[jour]) : null;
}

// --- Choix des fichiers ----------------------------------------------------

/** Fichiers d'avancement possibles, dans l'ordre de recherche ; jamais une grille d'audit ni une vision long terme. */
export function candidats(chemins: string[]): string[] {
  const dossierDocs = (c: string) => c.split('/').length === 2 && c.toLowerCase().startsWith('docs/');
  const propres = chemins.filter((c) => /\.md$/i.test(c) && !/securite|roadmap/i.test(c));
  const exact = (nom: string) => propres.filter((c) => c.toLowerCase() === nom);
  const motif = (prefixe: string) => propres.filter((c) => dossierDocs(c) && c.toLowerCase().slice(5).startsWith(prefixe)).sort();
  return [...new Set([
    ...exact('taches.md'), ...motif('taches'), ...exact('check-list.md'), ...exact('docs/check-list.md'),
    ...motif('check-list'), ...motif('checklist'),
  ])];
}

/** La séance la plus récente d'abord : par date, puis par numéro de la journée (`-2` après rien). */
function ordreSeances(chemins: string[]): string[] {
  const cle = (c: string) => {
    const m = /(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.md$/.exec(c);
    return m ? `${m[1]}-${String(m[2] ?? 1).padStart(4, '0')}` : '';
  };
  return chemins.filter((c) => /^docs\/seances\/.*\d{4}-\d{2}-\d{2}(?:-\d+)?\.md$/.test(c)).sort((a, b) => cle(b).localeCompare(cle(a)));
}

// --- Lecture d'un dépôt ----------------------------------------------------

type Commit = { date: string; message: string; url: string };

async function lireProjet(f: Recup, jeton: string, depot: string, pousse: string, now: number, fin: AbortSignal): Promise<{ p: PointProjet; fichiersSeances: string[] }> {
  const base = `https://api.github.com/repos/${depot}`;
  let illisible = false;

  const brut = async (chemin: string, ref?: string): Promise<string | null> => {
    const r = await lire(f, `${base}/contents/${encoderChemin(chemin)}${ref ? `?ref=${ref}` : ''}`, jeton, 'application/vnd.github.raw', fin);
    if (!r) { illisible = true; return null; }
    try { return await r.text(); } catch { illisible = true; return null; }
  };

  // L'arbre, une fois : check-list et séances en sortent.
  const arbre = (await lireJson(f, `${base}/git/trees/HEAD?recursive=1`, jeton, fin)) as { tree?: unknown } | null;
  let chemins: string[] = [];
  if (arbre && Array.isArray(arbre.tree)) {
    chemins = (arbre.tree as { path?: unknown; type?: unknown }[]).filter((e) => e.type === 'blob' && typeof e.path === 'string').map((e) => e.path as string);
  } else illisible = true;

  // Les commits des 7 derniers jours.
  const depuis = new Date(now - JOURS_COMMITS * JOUR_MS).toISOString();
  // Jusqu'à 5 pages de 100 : une grosse journée dépasse vite 30 commits.
  let liste: unknown = await lireJson(f, `${base}/commits?since=${depuis}&per_page=100`, jeton, fin);
  for (let page = 2, derniere = liste; page <= PAGES_COMMITS && Array.isArray(derniere) && derniere.length === 100; page++) {
    derniere = await lireJson(f, `${base}/commits?since=${depuis}&per_page=100&page=${page}`, jeton, fin);
    if (!Array.isArray(derniere)) { liste = null; break; }
    liste = [...(liste as unknown[]), ...derniere];
  }
  const commits: Commit[] = [];
  if (Array.isArray(liste)) {
    for (const c of liste as { html_url?: unknown; commit?: { message?: unknown; committer?: { date?: unknown }; author?: { date?: unknown } } }[]) {
      const date = c.commit?.committer?.date ?? c.commit?.author?.date;
      if (typeof date !== 'string') continue;
      const message = typeof c.commit?.message === 'string' ? c.commit.message.split('\n')[0].trim() : '';
      commits.push({ date, message, url: typeof c.html_url === 'string' ? c.html_url : '' });
    }
    commits.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  } else illisible = true;

  // L'avancement : le premier fichier qui a des cases, sinon le premier qui a une liste, sinon les commits.
  let avancement: Avancement = { genre: 'commits' };
  let liste1: { fichier: string; md: string } | null = null;
  let avecCases: { fichier: string; md: string } | null = null;
  for (const fichier of candidats(chemins)) {
    const md = await brut(fichier);
    if (md === null) continue;
    if (lireCases(md).length) { avecCases = { fichier, md }; break; }
    if (!liste1 && lireListe(md).length) liste1 = { fichier, md };
  }
  if (avecCases) {
    const cases = lireCases(avecCases.md);
    // L'historique : les 30 derniers commits du fichier, puis leur contenu à chaque `sha`.
    const versions: Version[] = [];
    const historique = await lireJson(f, `${base}/commits?path=${encoderChemin(avecCases.fichier)}&per_page=${MAX_COMMITS_FICHIER}`, jeton, fin);
    if (Array.isArray(historique)) {
      for (const h of historique as { sha?: unknown; commit?: { committer?: { date?: unknown } } }[]) {
        const quand = h.commit?.committer?.date;
        if (typeof h.sha !== 'string' || typeof quand !== 'string') continue;
        const contenu = await brut(avecCases.fichier, h.sha);
        if (contenu === null) break;
        versions.push({ quand, contenu });
      }
    } else illisible = true;
    const derniere = derniereCochee(versions);
    avancement = {
      genre: 'cases', fichier: avecCases.fichier, faites: cases.filter((c) => c.fait).length, total: cases.length,
      derniere, suite: suiteApres(cases, derniere?.texte ?? null),
      urgentes: cases.filter((c) => !c.fait && c.urgent).map((c) => c.texte),
    };
  } else if (liste1) {
    const elements = lireListe(liste1.md);
    avancement = {
      genre: 'liste', fichier: liste1.fichier, restantes: elements.length, premiere: elements[0]?.texte ?? null,
      urgentes: elements.filter((e) => e.urgent).map((e) => e.texte),
    };
  }

  // La séance la plus récente.
  let seance: Seance | null = null;
  const fichiersSeances = ordreSeances(chemins);
  const fichierSeance = fichiersSeances[0];
  if (fichierSeance) {
    const md = await brut(fichierSeance);
    if (md !== null) seance = lireSeance(fichierSeance, md);
  }

  const dernierTravail = [seance?.date, commits[0]?.date].filter((d): d is string => !!d)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const reference = Math.max(Date.parse(dernierTravail ?? '') || 0, Date.parse(pousse) || 0);
  const enPause = !(now - reference <= JOURS_PAUSE * JOUR_MS);

  const sans: Omit<PointProjet, 'ouOnSArrete' | 'enPause'> = {
    depot, nom: nomProjet(depot), pousse, dernierTravail, avancement, seance, commits,
    ...(illisible ? { lectureImpossible: true } : {}),
  };
  return { p: { ...sans, enPause, ouOnSArrete: ouOnSArrete(sans) }, fichiersSeances };
}

/** Les projets qui ont du travail récent sans note de séance : commits des jours « de la veille » (le lundi : ven., sam., dim.). */
function notesAEcrire(projets: PointProjet[], seances: Record<string, string[]>, rangees: Record<string, string>, now: number): NoteAEcrire[] {
  const hier = (n: number) => jourDe(now - n * JOUR_MS);
  const jours = new Set(new Date(now).getUTCDay() === 1 ? [hier(1), hier(2), hier(3)] : [hier(1)]);
  // Jours déjà couverts par une note rangée, par dépôt : ceux qu'elle liste dans `jours`, ou à défaut le jour de son identifiant.
  const couverts = new Map<string, Set<string>>();
  for (const [cle, brut] of Object.entries(rangees)) {
    let n: { depot?: unknown; jours?: unknown } = {};
    try { n = lireBrut<typeof n>(brut) ?? {}; } catch { n = {}; }
    const depot = typeof n.depot === 'string' ? n.depot : cle.slice(11);
    const liste = Array.isArray(n.jours) && n.jours.every((j) => typeof j === 'string') ? (n.jours as string[]) : [cle.slice(0, 10)];
    const ens = couverts.get(depot) ?? new Set<string>();
    for (const j of [...liste, cle.slice(0, 10)]) ens.add(j);
    couverts.set(depot, ens);
  }
  const sortie: NoteAEcrire[] = [];
  for (const p of projets) {
    const avecSeance = seances[p.depot] ?? [];
    const deja = couverts.get(p.depot);
    const commits = p.commits.filter((c) => {
      const j = c.date.slice(0, 10);
      return jours.has(j) && !avecSeance.some((fichier) => fichier.includes(j)) && !deja?.has(j);
    });
    if (!commits.length) continue;
    // Le jour de la note = le jour du travail le plus récent parmi ces commits (un seul jour la plupart du temps).
    const jour = commits[0].date.slice(0, 10);
    const id = `${jour}:${p.depot}`;
    if (id in rangees) continue;
    const joursNote = [...new Set(commits.map((c) => c.date.slice(0, 10)))].sort();
    sortie.push({ id, depot: p.depot, nom: p.nom, jour, jours: joursNote, commits });
  }
  return sortie;
}

export async function calculerReleve(kv: KV, deps: DepsMafe, now: number = Date.now()): Promise<ReleveMafe> {
  if (!deps.jeton) throw new Refus('jeton GitHub perso manquant', 503);
  const jeton = deps.jeton;
  const fin = AbortSignal.timeout(BUDGET_MS);

  // Si la liste est injoignable, `listerDepots` lève : rien n'est écrit.
  const depots = (await listerDepots(deps.fetch, jeton, 'perso', now, fin)).filter((d) => !estExclu(d.complet));

  const lus = await Promise.all(depots.map(async (d): Promise<{ p: PointProjet; fichiersSeances: string[] }> => {
    try { return await lireProjet(deps.fetch, jeton, d.complet, d.pousse, now, fin); }
    catch {
      const sans: Omit<PointProjet, 'ouOnSArrete' | 'enPause'> = {
        depot: d.complet, nom: nomProjet(d.complet), pousse: d.pousse, dernierTravail: null,
        avancement: { genre: 'commits' }, seance: null, commits: [], lectureImpossible: true,
      };
      return { p: { ...sans, enPause: false, ouOnSArrete: ouOnSArrete(sans) }, fichiersSeances: [] };
    }
  }));
  const activite = (p: PointProjet) => Date.parse(p.dernierTravail ?? p.pousse) || 0;
  const projets = lus.map((l) => l.p).sort((a, b) => Number(a.enPause) - Number(b.enPause) || activite(b) - activite(a));
  const seances: Record<string, string[]> = Object.fromEntries(lus.map((l) => [l.p.depot, l.fichiersSeances]));
  const rangees = await kv.hgetall(CLES_MAFE.notes);
  const jour = jourDe(now);
  const avant = (await kv.hgetall(CLES_MAFE.releves))[jour];
  let ancien: ReleveMafe | null = null;
  try { ancien = avant ? lireBrut<ReleveMafe>(avant) : null; } catch { ancien = null; } // relevé abîmé : comme s'il n'y en avait pas

  const releve: ReleveMafe = {
    jour, quand: now, projets, priorite: choisirPriorite(projets, now),
    aEcrire: notesAEcrire(projets, seances, rangees, now),
    ...(ancien?.phrase ? { phrase: ancien.phrase } : {}), ...(ancien?.bilan ? { bilan: ancien.bilan } : {}),
  };
  await kv.hset(CLES_MAFE.releves, jour, JSON.stringify(releve));

  // On ne garde que les 8 derniers jours.
  const tous = await kv.hgetall(CLES_MAFE.releves);
  const jours = Object.keys(tous).sort();
  if (jours.length > JOURS_CONSERVES) {
    for (const j of jours.slice(0, -JOURS_CONSERVES)) await kv.hdel(CLES_MAFE.releves, j);
  }
  return releve;
}
