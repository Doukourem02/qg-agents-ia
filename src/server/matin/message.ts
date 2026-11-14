import type { Creneau, VuesQG } from '../vues';
import type { VueLuffy } from '../luffy/vue';
import type { VueLea } from '../lea/etiquette';
import { nomAffiche, type VueLight } from '../light/vue';
import type { VueMafe } from '../mafe/vue';
import { listeCourte, noteTentative } from '../lea/etiquette';
import { enMots, nomNiveau, projetsDe, resume, type Reunion } from '@/data/crise';
import type { VueSilence } from '@/data/silence';
import { ligneIgnores } from '../silence';
import { phraseFeu, type VueFeu } from '../feu/etiquette';

// Le compte rendu du matin de Kuroro : un seul message Telegram, chaque jour à 08:15 (Abidjan = UTC).
// Module pur : l'état est lu ailleurs (lecture.ts) et injecté ; aucune lecture, aucun réseau ici.
// Rien de faux qui semble réel : chaque ligne vient de l'état rangé par les agents. Une source illisible le dit
// (« je n'ai pas pu lire… »), un agent qui n'a rien à dire ce jour-là n'a pas de ligne.

const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;
/** Comme le Calendrier : un passage sans trace 1 h après son heure est raté. */
const RETARD = H;
const ATTENTE_MAX = 5, RATES_MAX = 4, PANNES_MAX = 3;

/** Ce que Kuroro lit avant d'écrire. `null` : la source n'a pas pu être lue. */
export type EtatMatin = {
  /** Les passages des routines réelles (la semaine d'avant et celle-ci), avec leur état comme dans le Calendrier. */
  passages: Creneau[] | null;
  /** Ce qui attend le patron, comme dans l'onglet Tâches. */
  enAttente: VuesQG['taches']['enAttente'] | null;
  luffy: VueLuffy | null;
  lea: VueLea | null;
  clara: EtatClara | null;
  light: VueLight | null;
  mafe: VueMafe | null;
  /** Les réunions de crise (src/server/crise/) ; absent ou null : rien à en dire (jamais de réunion supposée). */
  reunions?: Reunion[] | null;
  /** Ce que le patron a dit d'ignorer et la pause des alertes (src/server/silence.ts) ; absent : rien à en dire. */
  silence?: VueSilence | null;
  /** Le bureau de Feu (statuts du code, annonces) ; absent : pas de ligne ; null : illisible. */
  feu?: VueFeu | null;
};

export type EtatClara = {
  /** Le nombre d'expéditeurs bannis : sans banni, Clara n'a rien à faire la nuit (pas de ligne). */
  bannis: number;
  /** Ses mises à la corbeille (clara:journal) ; `nettoyagesComplets` : la liste n'a pas été coupée dans la nuit. */
  nettoyages: { quand: number; n: number }[];
  nettoyagesComplets: boolean;
  /** Ses entrées du journal du QG ; `journalComplet` : le journal remonte avant 20:00 hier. */
  journal: { quand: number; texte: string }[];
  journalComplet: boolean;
};

const deux = (n: number) => String(n).padStart(2, '0');
const hhmm = (t: number) => { const d = new Date(t); return `${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}`; };
const minuit = (t: number) => t - (((t % JOUR) + JOUR) % JOUR);
const pl = (n: number, un: string, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;
const simple = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** « Propose 3 sujets » → « propose 3 sujets » ; « README et CLAUDE.md » reste tel quel. */
const minuscule = (t: string) => (/^[A-ZÀ-Ý][a-zà-ÿ']/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const couper = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

/** L'heure d'un moment proche, lisible : « 02:10 », « hier 23:40 », ou « le 10 nov. 14:00 ». */
export function quandLisible(t: number, now: number): string {
  const jour = minuit(now), d = minuit(t);
  if (d === jour) return hhmm(t);
  if (d === jour - JOUR) return `hier ${hhmm(t)}`;
  return `le ${new Date(t).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' })} ${hhmm(t)}`;
}

/** « Cette nuit » commence à la fermeture du bureau, la veille à 20:00. */
export const debutNuit = (now: number) => minuit(now) - 4 * H;

// ───────────── Cette nuit ─────────────

/** `ignores` : les sites que le patron a dit d'ignorer ; leur panne en cours n'est pas redite (la ligne « ignorés » le dit). */
export function ligneLuffy(v: VueLuffy | null, debut: number, now: number, ignores: readonly string[] = []): string {
  if (!v) return 'Luffy : je n\'ai pas pu lire son état';
  if (v.dernier === null) return 'Luffy : pas encore de vérification';
  const pannes = v.pannes7j.filter(p => p.debut <= now && (p.fin ?? now) >= debut && !(p.fin === undefined && ignores.includes(p.nom)))
    .sort((a, b) => a.debut - b.debut);
  const dites = pannes.slice(0, PANNES_MAX).map(p => (p.fin !== undefined
    ? `${p.nom} en panne de ${quandLisible(p.debut, now)} à ${quandLisible(p.fin, now)} (${p.duree}), revenu`
    : `${p.nom} en panne depuis ${quandLisible(p.debut, now)}`));
  if (pannes.length > PANNES_MAX) dites.push(`et ${pl(pannes.length - PANNES_MAX, 'autre panne', 'autres pannes')}`);
  if (v.endormi) return `Luffy : ne vérifie plus depuis ${quandLisible(v.dernier, now)}${dites.length ? ` ; avant : ${dites.join(' ; ')}` : ''}`;
  if (!pannes.length) return `Luffy : ${v.sites.length > 1 ? `les ${v.sites.length} sites ont tenu` : 'le site a tenu'}, aucune panne`;
  return `Luffy : ${pl(pannes.length, 'panne')} — ${dites.join(' ; ')}`;
}

/**
 * Les réunions de crise : celle en cours (« incident en cours depuis 02:15 · Livreo en panne depuis 6 h ») et celles finies
 * cette nuit (« incident Livreo 02:15–02:30, réglé »). Rien d'autre : sans réunion, pas de ligne.
 */
export function lignesReunions(reunions: Reunion[] | null | undefined, debut: number, now: number): string[] {
  if (!reunions) return [];
  const l = [...reunions].filter(r => r.debut <= now).sort((a, b) => a.debut - b.debut);
  return [
    ...l.filter(r => r.fin !== undefined && r.fin >= debut && r.fin <= now)
      .map(r => `${nomNiveau(r.niveau)} ${enMots(projetsDe(r.vus))} ${hhmm(r.debut)}–${hhmm(r.fin!)}, réglé`),
    ...l.filter(r => r.fin === undefined)
      .map(r => `${nomNiveau(r.niveau)} en cours depuis ${quandLisible(r.debut, now)} · ${resume(r.sujets, now)}`),
  ];
}

export function ligneLea(v: VueLea | null, debut: number, now: number): string {
  if (!v) return 'Léa : je n\'ai pas pu lire son état';
  const relues = v.relectures.filter(r => r.quand >= debut && r.quand <= now);
  const n = relues.reduce((s, r) => s + r.commits.length, 0);
  const nouveaux = v.constats.filter(c => c.statut === 'ouvert' && c.quand >= debut && c.quand <= now);
  const signale = (gravite: 'grave' | 'moyen', un: string, plusieurs: string) => {
    const l = nouveaux.filter(c => c.gravite === gravite);
    return l.length ? [`${pl(l.length, un, plusieurs)} (${listeCourte([...new Set(l.map(c => nomAffiche(c.depot)))])})`] : [];
  };
  const signalements = [
    ...signale('grave', 'point grave à corriger', 'points graves à corriger'),
    ...signale('moyen', 'point moyen à regarder', 'points moyens à regarder'),
  ];
  const mineurs = nouveaux.filter(c => c.gravite === 'mineur').length;
  if (mineurs) signalements.push(pl(mineurs, 'petite remarque', 'petites remarques'));
  const enPartie = relues.some(r => r.enPartie.length > 0 || r.clesNonVerifiees.length > 0);
  if (v.absente) {
    const note = noteTentative(v.tentative, now);
    const base = v.passage === null ? 'Léa : pas encore de relecture complète' : `Léa : pas de nouvelles depuis ${quandLisible(v.passage, now)}`;
    return [base + (note ? ` (${note})` : ''), ...signalements].join(', ');
  }
  const morceaux = [
    n ? `${pl(n, 'enregistrement relu', 'enregistrements relus')}` : 'rien de nouveau à relire',
    ...signalements,
    ...(enPartie ? ['une partie relue en partie seulement'] : []),
  ];
  if (n && !signalements.length && !enPartie) morceaux.push('rien à signaler');
  return `Léa : ${morceaux.join(', ')}`;
}

export function ligneClara(c: EtatClara | null, debut: number, now: number): string | null {
  if (!c) return 'Clara : je n\'ai pas pu lire son état';
  if (c.bannis === 0) return null; // aucun banni : rien à faire la nuit
  const nuit = (t: number) => t >= debut && t <= now;
  const passages = c.journal.filter(e => nuit(e.quand) && simple(e.texte).startsWith('bannissements appliques')).length;
  const echecs = c.journal.filter(e => nuit(e.quand) && simple(e.texte).startsWith('bannissements interrompus')).length;
  const mails = c.nettoyages.filter(x => nuit(x.quand)).reduce((s, x) => s + x.n, 0);
  const nombre = `${c.nettoyagesComplets ? '' : 'au moins '}${pl(mails, 'mail banni', 'mails bannis')} mis à la corbeille`;
  if (passages) {
    const ratees = echecs ? `, ${pl(echecs, 'passage interrompu', 'passages interrompus')}` : '';
    return `Clara : ${mails ? nombre : 'aucun mail de banni cette nuit'}${ratees}`;
  }
  if (echecs) return `Clara : la corbeille des bannis a échoué cette nuit (${pl(echecs, 'essai')})${mails ? ` ; ${nombre} quand même` : ''}`;
  if (mails) return `Clara : ${nombre}`;
  return c.journalComplet ? 'Clara : pas de passage cette nuit' : 'Clara : je n\'ai pas pu vérifier ses passages de la nuit';
}

// ───────────── Raté hier, ce matin, aujourd'hui ─────────────

/** Un passage qui compte : une routine active (ni pause, ni pas encore en service, ni seulement prévue). */
const actif = (c: Creneau) => !['inactif', 'pause', 'prevu'].includes(c.etat);
const estMatin = (c: Creneau) => c.routine === 'kuroro-matin';
/** « Où tu t'es arrêté (Telegram) » → « où tu t'es arrêté, sur Telegram » (pas de parenthèses dans les parenthèses). */
const titreCourt = (t: string) => minuscule(t).replace(/\s*\((Telegram)\)$/, ', sur $1').replace(/\s*\(([^)]*)\)$/, ', $1');

export function lignesRatees(passages: Creneau[], now: number): string[] {
  const hier = minuit(now) - JOUR;
  const rates = passages.filter(c => c.quand >= hier && c.quand < hier + JOUR && c.etat === 'rate');
  const l = rates.slice(0, RATES_MAX).map(c => `${c.nom} : ${titreCourt(c.titre)} (${c.heure}) n'a pas eu lieu`);
  if (rates.length > RATES_MAX) l.push(`et ${pl(rates.length - RATES_MAX, 'autre')}`);
  return l;
}

export function ligneLight(v: VueLight | null, c: Creneau, now: number): string {
  if (!v) return 'Light : je n\'ai pas pu lire son relevé';
  if (v.aJour) {
    if (!v.resume) return now >= c.quand + RETARD ? 'Light : relevé fait, mais son rapport n\'est pas arrivé' : 'Light : relevé en cours, rapport pas encore écrit';
    const alertes = v.historique.find(h => h.jour === v.jour)?.alertes ?? 0;
    const lectures = v.lectures.length;
    return `Light : relevé fait, ${alertes ? pl(alertes, 'alerte') : 'aucune alerte'}${lectures ? `, ${pl(lectures, 'lecture conseillée', 'lectures conseillées')}` : ''}`;
  }
  return c.etat === 'rate' ? `Light : le relevé de ${c.heure} n'est pas arrivé` : 'Light : relevé pas encore fait';
}

export function ligneMafe(v: VueMafe | null, c: Creneau, now: number): string {
  if (!v) return 'Mafe : je n\'ai pas pu lire son point';
  const duJour = v.releve && v.releve.jour === new Date(now).toISOString().slice(0, 10) ? v.releve : null;
  if (c.etat === 'fait' && duJour) {
    const p = duJour.priorite;
    return p ? `Mafe : ta priorité du jour — « ${couper(`${p.nom} : ${p.raison}`, 140)} »` : 'Mafe : point fait, aucune priorité ce matin';
  }
  return c.etat === 'rate' ? `Mafe : le point de ${c.heure} n'est pas arrivé` : `Mafe : le point de ${c.heure} n'est pas encore arrivé`;
}

/** Un passage de ce matin sans phrase à lui : son état, tel que le Calendrier le montre. */
function ligneGenerique(c: Creneau): string {
  const etat = c.etat === 'fait' ? 'fait' : c.etat === 'rate' ? `n'a pas eu lieu (${c.heure})`
    : c.etat === 'rien-a-faire' ? 'rien à faire' : c.etat === 'sans-objet' ? 'pas nécessaire' : `pas encore fait (${c.heure})`;
  return `${c.nom} : ${minuscule(c.titre)} — ${etat}`;
}

export function lignesMatin(e: EtatMatin & { passages: Creneau[] }, now: number): string[] {
  const jour = minuit(now);
  return e.passages
    .filter(c => c.quand >= jour && c.quand <= now && !estMatin(c) && actif(c) && !c.conditionnel)
    .map(c => (c.routine === 'light-releve' ? ligneLight(e.light, c, now) : c.routine === 'mafe-point' ? ligneMafe(e.mafe, c, now) : ligneGenerique(c)));
}

export function lignesAujourdhui(passages: Creneau[], now: number): string[] {
  const fin = minuit(now) + JOUR;
  return passages
    // les analyses de Feu ont leur ligne à elles (« Feu : … ; analyses à 12:00, 16:00, 20:00 »)
    .filter(c => c.quand > now && c.quand < fin && !estMatin(c) && c.etat === 'a-venir' && !c.conditionnel && c.routine !== 'feu-analyse')
    .map(c => `${c.nom} passe à ${c.heure} (${titreCourt(c.titre)})`);
}

const NOMS_ATTENTE: Record<string, string> = { L: 'L', light: 'Light', clara: 'Clara', mafe: 'Mafe', luffy: 'Luffy', zoro: 'Zoro', lea: 'Léa', paul: 'Paul', ye: 'Ye', isaac: 'Isaac', feu: 'Feu' };

export function lignesAttente(a: EtatMatin['enAttente']): string[] {
  if (a === null) return ['Ce qui t\'attend : je n\'ai pas pu le lire, regarde l\'onglet Tâches'];
  if (!a.length) return ['Ce qui t\'attend : rien à valider'];
  const dit = (x: (typeof a)[number]) => `${x.nombre ? `${x.nombre} ` : ''}${x.texte}`;
  const nom = (x: (typeof a)[number]) => NOMS_ATTENTE[x.agent] ?? x.agent;
  if (a.length === 1) return [`Ce qui t'attend : ${dit(a[0])} (${nom(a[0])})`];
  const l = a.slice(0, ATTENTE_MAX).map(x => `• ${nom(x)} : ${dit(x)}`);
  if (a.length > ATTENTE_MAX) l.push(`• et ${pl(a.length - ATTENTE_MAX, 'autre chose', 'autres choses')} dans l'onglet Tâches`);
  return ['Ce qui t\'attend', ...l];
}

/**
 * La ligne de Feu : « Feu : BTC et ETH en Hypothèse, on attend ; PPI américain à 13:30 (lu à 08:00) ». Un statut vieux de
 * plus d'une heure le dit ; sans lecture du marché, pas de ligne (Feu pas encore en service).
 */
export function ligneFeu(v: VueFeu | null | undefined, now: number, passages: Creneau[] | null = null): string | null {
  if (v === undefined) return null;
  if (v === null) return 'Feu : je n\'ai pas pu lire son bureau';
  if (!v.passage?.statuts.length) return null;
  const lu = Math.max(...v.passage.statuts.map(s => s.lu));
  const vieux = now - lu > H ? ` (dernière lecture ${quandLisible(lu, now)})` : ` (lu à ${hhmm(lu)})`;
  const fin = minuit(now) + JOUR;
  const analyses = (passages ?? []).filter(c => c.routine === 'feu-analyse' && c.quand > now && c.quand < fin && c.etat === 'a-venir').map(c => c.heure);
  return `Feu : ${phraseFeu(v, now).replace(/\.$/, '')}${vieux}${analyses.length ? ` ; analyses à ${analyses.join(', ')}` : ''}`;
}

// ───────────── Le message ─────────────

/** Le jour en toutes lettres : « jeudi 12 novembre ». */
export const jourEnLettres = (now: number) =>
  new Date(now).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

/** Le texte du compte rendu du matin (texte simple, pour Telegram). */
export function compteRendu(e: EtatMatin, now: number): string {
  const debut = debutNuit(now);
  const bloc = (titre: string, lignes: string[]) => (lignes.length ? [titre, ...lignes.map(l => `• ${l}`)] : []);
  const sitesIgnores = (e.silence?.ignores ?? []).filter(i => i.groupe.startsWith('site:')).map(i => i.libelle);
  const nuit = [
    ...lignesReunions(e.reunions, debut, now), ligneLuffy(e.luffy, debut, now, sitesIgnores), ligneLea(e.lea, debut, now),
    ligneClara(e.clara, debut, now), ligneIgnores(e.silence ?? null),
  ].filter((l): l is string => l !== null);
  const passages = e.passages;
  // sans journal, aucun passage n'est affirmé (ni fait, ni raté, ni « rien d'autre de prévu »)
  const routines = passages === null
    ? [bloc('Les routines', ['je n\'ai pas pu lire le journal : regarde le Calendrier'])]
    : [
      bloc('Raté hier', lignesRatees(passages, now)),
      bloc('Ce matin', lignesMatin({ ...e, passages }, now)),
      lignesAujourdhui(passages, now).length ? bloc('Aujourd\'hui', lignesAujourdhui(passages, now)) : ['Aujourd\'hui : rien d\'autre de prévu'],
    ];
  const blocs = [
    [`☀️ Bonjour patron · ${jourEnLettres(now)}`],
    bloc('Cette nuit', nuit),
    ...routines,
    ...(ligneFeu(e.feu, now, passages) ? [[ligneFeu(e.feu, now, passages)!]] : []),
    lignesAttente(e.enAttente),
  ].filter(b => b.length);
  return blocs.map(b => b.join('\n')).join('\n\n');
}
