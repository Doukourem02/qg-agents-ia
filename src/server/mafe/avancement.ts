// Mafe : calcul de l'avancement des projets. Fonctions pures, sans réseau ni KV.

export type Case = { texte: string; fait: boolean; section: string; facultatif: boolean; urgent: boolean };
export type ElementListe = { texte: string; section: string; urgent: boolean };
export type Version = { quand: string; contenu: string }; // plus récente d'abord
export type Avancement =
  | { genre: 'cases'; fichier: string; faites: number; total: number; derniere: { texte: string; quand: string } | null; suite: string | null; urgentes: string[] }
  | { genre: 'liste'; fichier: string; restantes: number; premiere: string | null; urgentes: string[] }
  | { genre: 'commits' };
export type Seance = { fichier: string; date: string; suite: string[] };
export type PointProjet = {
  depot: string; nom: string; pousse: string; dernierTravail: string | null; enPause: boolean;
  avancement: Avancement; seance: Seance | null; commits: { date: string; message: string; url: string }[];
  ouOnSArrete: string; lectureImpossible?: boolean;
};
export type Priorite = { depot: string; nom: string; raison: string } | null;

const JOUR_MS = 86_400_000;
const FENCE = /^\s*(```|~~~)/;
const TITRE = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const CASE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const PUCE_HAUTE = /^- +(.*)$/;

/** Texte propre : sans gras, espaces doublés réduits. */
function nettoyer(s: string): string {
  return s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

/** Lignes hors blocs de code, avec la section (dernier titre) au-dessus de chacune. */
function lignesUtiles(md: string): { ligne: string; section: string }[] {
  const sortie: { ligne: string; section: string }[] = [];
  let dansBloc = false;
  let section = '';
  for (const ligne of md.split(/\r?\n/)) {
    if (FENCE.test(ligne)) { dansBloc = !dansBloc; continue; }
    if (dansBloc) continue;
    const t = TITRE.exec(ligne);
    if (t) { section = nettoyer(t[1]); continue; }
    sortie.push({ ligne, section });
  }
  return sortie;
}

export function estUrgent(texte: string, section: string): boolean {
  const sansNegation = (s: string) => s.replace(/\b(?:non[\s-]+|pas\s+(?:encore\s+)?)(?:urgent|prioritaire)/gi, '');
  return [texte, section].some((s) => /urgent|prioritaire|⚠/iu.test(sansNegation(s)));
}

export function lireCases(md: string): Case[] {
  const cases: Case[] = [];
  for (const { ligne, section } of lignesUtiles(md)) {
    const m = CASE.exec(ligne);
    if (!m) continue;
    const texte = nettoyer(m[2]);
    cases.push({
      texte, fait: m[1] !== ' ', section,
      facultatif: /facultatif|optionnel/i.test(texte),
      urgent: estUrgent(texte, section),
    });
  }
  return cases;
}

export function lireListe(md: string): ElementListe[] {
  const elements: ElementListe[] = [];
  for (const { ligne, section } of lignesUtiles(md)) {
    const m = PUCE_HAUTE.exec(ligne);
    if (!m || CASE.test(ligne)) continue;
    const texte = nettoyer(m[1]);
    if (texte) elements.push({ texte, section, urgent: estUrgent(texte, section) });
  }
  return elements;
}

/**
 * Dernière case passée de `[ ]` à `[x]` : on compare chaque version à la précédente (plus ancienne).
 * Une case dont le texte a changé entre deux versions ne compte pas. S'il y en a plusieurs, la dernière du fichier.
 */
export function derniereCochee(versions: Version[]): { texte: string; quand: string } | null {
  for (let i = 0; i + 1 < versions.length; i++) {
    const avant = new Set(lireCases(versions[i + 1].contenu).filter((c) => !c.fait).map((c) => c.texte));
    const cochees = lireCases(versions[i].contenu).filter((c) => c.fait && avant.has(c.texte));
    if (cochees.length) return { texte: cochees[cochees.length - 1].texte, quand: versions[i].quand };
  }
  return null;
}

export function suiteApres(cases: Case[], derniere: string | null): string | null {
  if (derniere === null) return cases.find((c) => !c.fait && !c.facultatif)?.texte ?? null;
  const idx = cases.map((c) => c.texte).lastIndexOf(derniere);
  if (idx < 0) return cases.find((c) => !c.fait && !c.facultatif)?.texte ?? null;
  const apres = cases.slice(idx + 1).filter((c) => !c.fait);
  return (apres.find((c) => c.section === cases[idx].section) ?? apres[0])?.texte ?? null;
}

export function lireSeance(fichier: string, md: string): Seance | null {
  const d = /(\d{4}-\d{2}-\d{2})(?:-\d+)?\.md$/.exec(fichier);
  if (!d) return null;
  const suite: string[] = [];
  let dansSuite = false;
  let dansBloc = false;
  for (const ligne of md.split(/\r?\n/)) {
    if (FENCE.test(ligne)) { dansBloc = !dansBloc; continue; }
    if (dansBloc) continue;
    const t = TITRE.exec(ligne);
    if (t) { dansSuite = /^la suite\b/i.test(nettoyer(t[1])); continue; }
    if (!dansSuite) continue;
    const p = /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(ligne);
    const texte = p ? nettoyer(p[1]) : '';
    if (texte) suite.push(texte);
  }
  return { fichier, date: d[1], suite };
}

/** Date en français court (`8 nov.`), en UTC. Accepte AAAA-MM-JJ ou une date ISO. */
function dateCourte(iso: string): string {
  const t = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function ouOnSArrete(p: Omit<PointProjet, 'ouOnSArrete' | 'enPause'>): string {
  if (p.lectureImpossible) return 'lecture impossible aujourd\'hui';
  const a = p.avancement;
  const reference = a.genre === 'cases' ? a.derniere?.quand : a.genre === 'commits' ? p.commits[0]?.date : undefined;
  // Comparaison au jour près : une séance du même jour que le dernier travail fait foi (elle dit la suite).
  const s = p.seance;
  if (s && s.suite.length && (!reference || s.date >= reference.slice(0, 10))) {
    return `La suite (séance du ${dateCourte(s.date)}) : ${s.suite.join(' ; ')}`;
  }
  if (a.genre === 'cases') {
    if (a.derniere) {
      const debut = `Dernière case cochée : ${a.derniere.texte} (le ${dateCourte(a.derniere.quand)})`;
      return a.suite ? `${debut} → La suite : ${a.suite}` : debut;
    }
    return a.suite ? `La suite : ${a.suite}` : 'Toutes les cases sont cochées';
  }
  if (a.genre === 'liste') {
    const n = `${a.restantes} ${a.restantes > 1 ? 'tâches restantes' : 'tâche restante'}`;
    return a.premiere ? `${n}, la première : ${a.premiere}` : n;
  }
  const c = p.commits[0];
  return c ? `Dernier travail le ${dateCourte(c.date)} : ${c.message}` : `Dernier travail le ${dateCourte(p.pousse)}`;
}

function urgentes(p: PointProjet): string[] {
  return p.avancement.genre === 'commits' ? [] : p.avancement.urgentes;
}

/** Ce que le patron reprendrait : la suite de la séance, de la check-list, la première tâche ou le dernier commit. */
function aReprendre(p: PointProjet): string {
  const a = p.avancement;
  return p.seance?.suite[0]
    ?? (a.genre === 'cases' ? a.suite : a.genre === 'liste' ? a.premiere : null)
    ?? p.commits[0]?.message
    ?? p.ouOnSArrete;
}

const temps = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

export function choisirPriorite(projets: PointProjet[], now: number): Priorite {
  const recent = (a: PointProjet, b: PointProjet) => temps(b.dernierTravail) - temps(a.dernierTravail);

  const urgents = projets.filter((p) => urgentes(p).length).sort(recent);
  if (urgents.length) {
    const p = urgents[0];
    return { depot: p.depot, nom: p.nom, raison: `une tâche urgente attend : ${urgentes(p)[0]}` };
  }

  const actifs = projets.filter((p) => !p.enPause && !p.lectureImpossible);
  const travailles = actifs
    .filter((p) => p.dernierTravail && now - temps(p.dernierTravail) <= 7 * JOUR_MS)
    .sort(recent);
  if (travailles.length) {
    const p = travailles[0];
    return { depot: p.depot, nom: p.nom, raison: `tu étais dessus le ${dateCourte(p.dernierTravail as string)}, reprends : ${aReprendre(p)}` };
  }

  const pousses = [...actifs].sort((a, b) => temps(b.pousse) - temps(a.pousse));
  if (pousses.length) {
    const p = pousses[0];
    return { depot: p.depot, nom: p.nom, raison: `le dernier poussé, le ${dateCourte(p.pousse)} : ${aReprendre(p)}` };
  }
  return null;
}
