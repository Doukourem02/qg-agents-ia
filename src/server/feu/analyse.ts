// L'analyse de Feu, quatre fois par jour (routine Claude Code « Feu · marché », 07:55, 11:55, 15:55, 19:55) :
//  - `a-analyser` (GET) : le QG lit le marché tout de suite et prépare le lot : statuts calculés par le code, bougies
//    résumées, niveaux, solde, journal, calendrier, questions du patron en attente ;
//  - `rapport` (POST) : l'analyse écrite au format du prompt du patron, VÉRIFIÉE par le serveur (champs autorisés,
//    tout prix cité vient du lot, aucun « Signal » si le code n'en a pas, rien de hors périmètre — Futures, marge,
//    levier, copy trading, bots, memecoins, airdrops —, aucune pression à agir, aucun secret, aucune injonction,
//    sources datées). Le plan d'ordres n'est jamais écrit par la routine : le code l'ajoute, au Signal seulement.
// Le QG l'envoie sur Telegram à 08:00, 12:00, 16:00, 20:00 (passage de 15 min), avec les statuts lus à l'envoi.
import type { KV } from '../memoire';
import { CLES, ecrireEtat, Refus, type Mission } from '../qg';
import { contientSecret } from '../paul/secrets';
import { contientInvisible } from '../paul/rapport';
import { estInjonction } from '../missions/file';
import { CERTITUDE, PRESSION, proposeHorsPerimetre } from './textes';
import { envoyerAlerte } from '../silence';
import { CLES_FEU, ecrireEtatFeu, lireCompte, lireEtatFeu, lirePassageFeu, type EtatFeu } from './etat';
import { soldes } from './compte';
import { closes, hhmm, nomPaire, prixFr, usdt } from './indicateurs';
import { lireBougies } from './marche';
import { ligneStatut, lignesPlan, TETE } from './messages';
import { passageFeu, situation, type DepsFeu } from './passage';
import { PAIRES, type Bougie, type Intervalle, type StatutPaire } from './types';

const MIN = 60_000, H = 60 * MIN, JOUR = 24 * H;
/** Les envois de l'analyse (Abidjan = UTC), à la clôture des bougies 4h. */
export const HEURES_ANALYSE = ['08:00', '12:00', '16:00', '20:00'] as const;
/** Un réveil quelques secondes avant l'heure (horloges) compte pour l'heure. */
const MARGE_MS = 2 * MIN;
/** Une analyse pas encore partie 3 h après son créneau est périmée : elle n'est plus envoyée (prix trop vieux). */
const PEREMPTION_MS = 3 * H;
const GARDE_ANALYSES = 12;
const RESUME: Record<Intervalle, number> = { '4h': 12, '1h': 24, '15m': 16 };

export type SourceDatee = { texte: string; source: string; date: string };
export type Analyse = {
  id: string; creneau: number | null; recu: number;
  lecture: string; analyse: string; opportunite: string; action: string; pourquoi: string;
  actualite: SourceDatee[]; reponses: { question: string; texte: string }[];
  envoye?: number; perimee?: true;
};
export type MetaLot = {
  id: string; quand: number; creneau: number | null; prix: number[]; signal: string[]; questions: { id: string; texte: string }[];
  /** Le statut calculé par le code pour chaque paire (« BTCUSDT » → « Surveillance ») : l'analyse ne peut pas en dire un autre. */
  statuts?: Record<string, string>;
};

const lire = <T>(brut: string | undefined | null): T | null => { if (!brut) return null; try { return JSON.parse(brut) as T; } catch { return null; } };
const aHeure = (minuit: number, h: string) => minuit + Number(h.slice(0, 2)) * H + Number(h.slice(3)) * MIN;

/** Le créneau d'envoi visé : le plus récent dans (now − 3 h, now + 30 min] ; null en dehors (la nuit). */
export function creneauVise(now: number): number | null {
  const minuit = now - (((now % JOUR) + JOUR) % JOUR);
  const tous = [-1, 0, 1].flatMap(j => HEURES_ANALYSE.map(h => aHeure(minuit + j * JOUR, h)));
  return tous.filter(t => t > now - PEREMPTION_MS && t <= now + 30 * MIN).sort((a, b) => b - a)[0] ?? null;
}

// ───────────── Le lot ─────────────

const resume = (b: readonly Bougie[], n: number, now: number) => closes(b, now).slice(-n).map(x => [new Date(x.t).toISOString().slice(0, 16), x.o, x.h, x.l, x.c, Math.round(x.v * 100) / 100] as const);

/** Les missions du patron pour Feu encore dans la file (la routine des missions ne les a pas prises). */
async function questionsEnAttente(kv: KV): Promise<Mission[]> {
  return (await kv.lrange(CLES.missions('feu'), 0, -1)).flatMap(v => lire<Mission>(v) ?? []).reverse();
}

/** Tous les nombres du lot qu'une analyse a le droit de citer comme prix (bougies, niveaux, statuts, plans, soldes). */
function prixDuLot(etat: EtatFeu, statuts: StatutPaire[], bougies: Record<string, Record<string, readonly (readonly (string | number)[])[]>>, extra: number[]): number[] {
  const p: number[] = [...extra];
  for (const parPaire of Object.values(bougies)) for (const l of Object.values(parPaire)) for (const x of l) p.push(...x.slice(1, 5).map(Number));
  for (const n of Object.values(etat.niveaux)) {
    for (const z of [...n.supports, ...n.resistances]) p.push(z.bas, z.haut);
    p.push(...n.surveilles.map(s => s.prix));
    if (n.contexte) p.push(n.contexte.prix);
  }
  for (const s of statuts) {
    p.push(s.prix);
    if (s.zone) p.push(s.zone.bas, s.zone.haut);
    if (s.objectif) p.push(s.objectif);
    if (s.plan) p.push(s.plan.entree, s.plan.stop, s.plan.stopLimite, s.plan.objectif, ...s.plan.ocos.flatMap(o => [o.objectif, o.declenchement, o.limite]));
  }
  return [...new Set(p.filter(x => Number.isFinite(x) && x > 0))];
}

/**
 * `a-analyser` : un passage tout de suite (statuts frais ; ses alertes partent comme d'habitude), puis le lot. Le
 * serveur garde ce qu'il faut pour vérifier le rapport (prix permis, paires au Signal, questions).
 */
export async function preparerLot(kv: KV, deps: DepsFeu, now: number) {
  await passageFeu(kv, deps, now);
  const passage = await lirePassageFeu(kv);
  if (!passage || now - passage.quand > 20 * MIN || !passage.statuts.length) throw new Refus('le marché n\'a pas pu être lu : pas d\'analyse sans prix frais, arrête-toi', 503);
  const etat = await lireEtatFeu(kv, now);
  const compte = await lireCompte(kv);
  const prix = Object.fromEntries(passage.statuts.map(s => [s.paire, s.prix]));
  const sit = situation(etat, compte, prix, now);
  const bougies: Record<string, Record<string, ReturnType<typeof resume>>> = {};
  for (const p of PAIRES) {
    const [b4h, b1h, b15m] = await Promise.all((['4h', '1h', '15m'] as const).map(i => lireBougies(deps.fetch, p, i, RESUME[i] + 2)));
    bougies[p] = { '4h': resume(b4h, RESUME['4h'], now), '1h': resume(b1h, RESUME['1h'], now), '15m': resume(b15m, RESUME['15m'], now) };
  }
  const questions = (await questionsEnAttente(kv)).slice(0, 5);
  const creneau = creneauVise(now);
  const id = `feu-${now.toString(36)}`;
  const meta: MetaLot = {
    id, quand: now, creneau,
    prix: prixDuLot(etat, passage.statuts, bougies, sit.positions.flatMap(p => [p.prixEntree, p.objectif ?? 0, p.stop ?? 0])),
    signal: passage.statuts.filter(s => s.statut === 'Signal').map(s => s.paire),
    statuts: Object.fromEntries(passage.statuts.map(s => [s.paire, s.statut])),
    questions: questions.map(q => ({ id: q.id, texte: q.texte })),
  };
  await kv.hset(CLES_FEU.lot, 'json', JSON.stringify(meta));
  await ecrireEtat(kv, { agent: 'feu', statut: 'au travail', tache: `prépare l'analyse de ${creneau ? hhmm(creneau) : hhmm(now)}`, outil: 'C' }, now, { journal: false });
  return {
    lot: {
      id, quand: now, creneau, lu: passage.quand,
      statuts: passage.statuts,
      bougies,
      niveaux: etat.niveaux,
      capital: sit.capital, regime: sit.regime,
      compte: compte ? { cle: compte.cle, quand: compte.quand, ...(compte.cle === 'ok' ? soldes(compte, prix) : {}) } : null,
      journal: sit.journal, positions: sit.positions, pause: sit.pause, interdit: sit.interdit,
      annonces: etat.annonces.filter(a => a.quand >= now - JOUR), points: etat.points,
      questions: meta.questions,
    },
  };
}

// ───────────── Le rapport vérifié ─────────────

const CHAMPS = ['lot', 'lecture', 'analyse', 'opportunite', 'action', 'pourquoi', 'actualite', 'calendrier', 'reponses'];
const MAX: Record<string, number> = { lecture: 600, analyse: 900, opportunite: 600, action: 300, pourquoi: 320 };
const ACTIONS = /\b(acheter|attendre|on attend|surveiller|vendre)\b/iu;
const UNITES = /^\s*(?:%|pour ?cent|millions?|milliards?|md|m\b|k\b|\$|dollars?|€|euros?|points?|pb|jours?|heures?|h\b|min|ans?|semaines?|mois|usdt|fcfa|btc\b|eth\b|bougies?|op[ée]rations?)/iu;
const MOIS = '(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)';

class RefusFeu extends Refus {}
const refuser = (m: string, code = 422): never => { throw new RefusFeu(m, code); };

/** Les nombres d'un texte qui peuvent être des prix (≥ `seuil`), hors heures, dates, pourcentages et montants d'actualité. */
export function prixCites(t: string, seuil: number): number[] {
  const propre = t
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?Z?)?\b/g, ' ')
    .replace(/\b\d{1,2}\s*[:h]\s*\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
    .replace(new RegExp(`\\b\\d{1,2}(?:er)?\\s+${MOIS}(?:\\s+20\\d{2})?`, 'giu'), ' ')
    .replace(new RegExp(`${MOIS}\\s+20\\d{2}`, 'giu'), ' ')
    .replace(/\b20[2-3]\d\b(?![\s  ]?\d)(?![.,]\d)/g, ' ');
  const out: number[] = [];
  for (const m of propre.matchAll(/\d{1,3}(?:[   ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g)) {
    const apres = propre.slice(m.index! + m[0].length);
    if (UNITES.test(apres)) continue;
    const v = Number(m[0].replace(/[   ]/g, '').replace(',', '.'));
    if (Number.isFinite(v) && v >= seuil) out.push(v);
  }
  return out;
}

const STATUTS_MOTS: [RegExp, string][] = [[/\bhypoth[eè]ses?\b/iu, 'Hypothèse'], [/\bsurveillance\b/iu, 'Surveillance'], [/\bsignal\b/iu, 'Signal']];
const PAIRES_MOTS: [RegExp, string][] = [[/\b(btc|bitcoin)\b/iu, 'BTCUSDT'], [/\b(eth|ether|ethereum)\b/iu, 'ETHUSDT']];
/**
 * Un statut écrit dans le texte doit être celui du code pour la paire dont parle la phrase (« BTC … Hypothèse » alors que
 * le code dit Surveillance : refusé). Une phrase qui nomme un statut sans paire, ou deux paires, doit valoir pour toutes.
 */
export function statutContredit(t: string, statuts: Record<string, string> | undefined): string | null {
  if (!statuts || !Object.keys(statuts).length) return null;
  for (const phrase of t.split(/(?<=[.;!?\n])\s*|\s+—\s+/u)) {
    const dits = STATUTS_MOTS.filter(([re]) => re.test(phrase)).map(([, nom]) => nom);
    if (!dits.length) continue;
    const paires = PAIRES_MOTS.filter(([re]) => re.test(phrase)).map(([, p]) => p).filter(p => p in statuts);
    const visees = paires.length ? paires : Object.keys(statuts);
    for (const p of visees) {
      if (!dits.includes(statuts[p])) return `le statut écrit (${dits.join(', ')}) n'est pas celui du code pour ${p.replace('USDT', '/USDT')} (${statuts[p]})`;
    }
  }
  return null;
}

const permis = (v: number, prix: readonly number[]) => prix.some(p => Math.abs(v - p) / p <= 0.001);

function texte(v: unknown, champ: string, max: number, meta: MetaLot): string {
  if (typeof v !== 'string' || !v.trim()) refuser(`« ${champ} » : un texte non vide est attendu`, 400);
  const t = (v as string).trim().replace(/\r\n/g, '\n');
  if (t.length > max) refuser(`« ${champ} » : ${max} caractères au plus`);
  if (contientInvisible(t.replace(/\n/g, ''))) refuser(`« ${champ} » : caractère invisible refusé`);
  if (contientSecret(t)) refuser(`« ${champ} » : un secret a été reconnu`);
  if (estInjonction(t)) refuser(`« ${champ} » : une consigne ou une commande a été reconnue`);
  if (proposeHorsPerimetre(t, champ === 'action' || champ === 'opportunite')) refuser(`« ${champ} » : hors périmètre (Futures, marge, levier, copy trading, bots, memecoins, airdrops…) : jamais proposé`);
  if (PRESSION.test(t)) refuser(`« ${champ} » : jamais pousser à agir, à déposer plus ni à se refaire`);
  if (CERTITUDE.test(t)) refuser(`« ${champ} » : jamais une prédiction présentée comme certaine`);
  if (!meta.signal.length && /\bsignal\b/iu.test(t)) refuser(`« ${champ} » : le code n'a aucun Signal, le mot « Signal » est interdit`);
  const contredit = statutContredit(t, meta.statuts);
  if (contredit) refuser(`« ${champ} » : ${contredit}`);
  const seuil = 0.5 * Math.min(...meta.prix.filter(p => p >= 100));
  const faux = prixCites(t, Number.isFinite(seuil) ? seuil : 1000).filter(x => !permis(x, meta.prix));
  if (faux.length) refuser(`« ${champ} » : un prix cité ne vient pas du lot (${faux.slice(0, 3).map(x => prixFr(x)).join(', ')}) : seulement les prix du lot`);
  return t;
}

function sourcesDatees(v: unknown, now: number, meta: MetaLot): SourceDatee[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 4) refuser('« actualite » : 1 à 4 éléments { texte, source, date }', 400);
  return (v as unknown[]).map((x, i) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (Object.keys(o).some(k => !['texte', 'source', 'date'].includes(k))) refuser(`actualite[${i}] : seulement texte, source, date`, 400);
    const t = texte(o.texte, `actualite[${i}].texte`, 300, meta);
    if (typeof o.source !== 'string' || !/^https:\/\/[^\s<>"'`]{4,300}$/.test(o.source)) refuser(`actualite[${i}] : une source https est attendue`, 400);
    if (typeof o.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) refuser(`actualite[${i}] : une date AAAA-MM-JJ est attendue`, 400);
    const d = Date.parse(`${o.date}T00:00:00Z`);
    if (!Number.isFinite(d) || d > now || now - d > 8 * JOUR) refuser(`actualite[${i}] : la date doit être de la semaine (jamais dans le futur)`);
    if (contientSecret(o.source as string)) refuser(`actualite[${i}] : un secret a été reconnu`);
    return { texte: t, source: o.source as string, date: o.date as string };
  });
}

function calendrierValide(v: unknown, now: number, meta: MetaLot): EtatFeu['annonces'] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 10) refuser('« calendrier » : 10 annonces au plus', 400);
  return (v as unknown[]).map((x, i) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const quand = typeof o.quand === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00)?Z$/.test(o.quand) ? Date.parse(o.quand) : NaN;
    if (!Number.isFinite(quand)) refuser(`calendrier[${i}] : « quand » en UTC, AAAA-MM-JJTHH:MMZ`, 400);
    if (quand < now - JOUR || quand > now + 45 * JOUR) refuser(`calendrier[${i}] : une annonce des 45 prochains jours`);
    const nom = texte(o.nom, `calendrier[${i}].nom`, 80, meta);
    if (typeof o.source !== 'string' || !/^https:\/\/[^\s<>"'`]{4,300}$/.test(o.source)) refuser(`calendrier[${i}] : une source https est attendue`, 400);
    return { quand, nom, source: o.source as string };
  });
}

/** Le rapport de la routine, vérifié contre le lot. Forme fausse → 400 ; contenu refusé → 422 (message fixe). */
export function validerAnalyse(corps: unknown, meta: MetaLot, now: number): { analyse: Analyse; calendrier: EtatFeu['annonces']; reponses: { id: string; texte: string }[] } {
  const o = (corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : null) as Record<string, unknown> | null;
  if (!o) refuser('rapport : un objet JSON est attendu', 400);
  for (const k of Object.keys(o!)) if (!CHAMPS.includes(k)) refuser(`champ non autorisé (seulement ${CHAMPS.join(', ')}) ; le plan d'ordres est écrit par le code`, 400);
  const champs = Object.fromEntries(Object.entries(MAX).map(([k, max]) => [k, texte(o![k], k, max, meta)])) as Pick<Analyse, 'lecture' | 'analyse' | 'opportunite' | 'action' | 'pourquoi'>;
  if (!ACTIONS.test(champs.action)) refuser('« action » : acheter, attendre, surveiller ou vendre');
  if (/\bach[eè]te[rz]?\b/iu.test(champs.action) && !meta.signal.length) refuser('« action » : acheter seulement au Signal du code');
  if (champs.pourquoi.split('\n').filter(Boolean).length > 2) refuser('« pourquoi » : deux lignes au plus');
  const actualite = sourcesDatees(o!.actualite, now, meta);
  const calendrier = calendrierValide(o!.calendrier, now, meta);
  const reponses: { id: string; texte: string }[] = [];
  if (o!.reponses !== undefined) {
    if (!Array.isArray(o!.reponses) || o!.reponses.length > 5) refuser('« reponses » : 5 au plus', 400);
    for (const [i, r] of (o!.reponses as unknown[]).entries()) {
      const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      if (typeof x.id !== 'string' || !meta.questions.some(q => q.id === x.id)) refuser(`reponses[${i}] : question absente du lot`, 422);
      reponses.push({ id: x.id as string, texte: texte(x.texte, `reponses[${i}].texte`, 500, meta) });
    }
  }
  const analyse: Analyse = {
    id: meta.id, creneau: meta.creneau, recu: now, ...champs, actualite,
    reponses: reponses.map(r => ({ question: meta.questions.find(q => q.id === r.id)!.texte, texte: r.texte })),
  };
  return { analyse, calendrier, reponses };
}

export async function lireAnalyses(kv: KV): Promise<Analyse[]> {
  return Object.values(await kv.hgetall(CLES_FEU.analyses)).flatMap(v => lire<Analyse>(v) ?? []).sort((a, b) => b.recu - a.recu);
}
const ecrireAnalyse = (kv: KV, a: Analyse) => kv.hset(CLES_FEU.analyses, a.id, JSON.stringify(a));

/** Retire de la file les questions auxquelles l'analyse a répondu (celles déjà prises par « QG · missions » restent à elle). */
async function retirerQuestions(kv: KV, ids: string[]) {
  if (!ids.length) return;
  const toutes = await kv.lrange(CLES.missions('feu'), 0, -1);
  const gardees = toutes.filter(v => !ids.includes(lire<Mission>(v)?.id ?? ''));
  if (gardees.length === toutes.length) return;
  await kv.del(CLES.missions('feu'));
  for (const v of [...gardees].reverse()) await kv.lpush(CLES.missions('feu'), v);
}

/**
 * `rapport` : vérifié, rangé, puis envoyé tout de suite si son créneau est là (sinon au passage de l'heure). Le
 * calendrier macro de la semaine est mis à jour (les annonces de la routine remplacent celles du même jour et du même nom).
 */
export async function recevoirAnalyse(kv: KV, corps: unknown, deps: DepsFeu, now: number) {
  const meta = lire<MetaLot>((await kv.hmget(CLES_FEU.lot, ['json'])).json);
  const lot = (corps && typeof corps === 'object' ? (corps as Record<string, unknown>).lot : undefined);
  if (typeof lot !== 'string' || !lot) refuser('« lot » manquant : renvoie l\'identifiant du lot reçu', 400);
  if (!meta || meta.id !== lot) refuser('lot inconnu ou remplacé : relance « a-analyser »', 409);
  if ((await lireAnalyses(kv)).some(a => a.id === lot)) refuser('ce rapport a déjà été reçu', 409);
  if (now - meta!.quand > 90 * MIN) refuser('lot trop vieux (plus de 90 min) : relance « a-analyser »', 409);
  const { analyse, calendrier, reponses } = validerAnalyse(corps, meta!, now);
  if (calendrier.length) {
    const etat = await lireEtatFeu(kv, now);
    const jour = (t: number) => new Date(t).toISOString().slice(0, 10);
    const memeAnnonce = (a: { quand: number; nom: string }, b: { quand: number; nom: string }) => jour(a.quand) === jour(b.quand) && a.nom.split(' ')[0].toLowerCase() === b.nom.split(' ')[0].toLowerCase();
    etat.annonces = [...etat.annonces.filter(a => a.quand >= now - 2 * JOUR && !calendrier.some(c => memeAnnonce(a, c))), ...calendrier].sort((a, b) => a.quand - b.quand).slice(0, 20);
    await ecrireEtatFeu(kv, etat);
  }
  await ecrireAnalyse(kv, analyse);
  await retirerQuestions(kv, reponses.map(r => r.id));
  const anciennes = (await lireAnalyses(kv)).slice(GARDE_ANALYSES);
  for (const a of anciennes) await kv.hdel(CLES_FEU.analyses, a.id);
  const envoyees = await envoyerAnalysesDues(kv, deps, now);
  if (!envoyees) await ecrireEtat(kv, { agent: 'feu', statut: 'termine', tache: `a préparé l'analyse de ${hhmm(analyse.creneau ?? now)}, elle part à son heure`, outil: 'C' }, now, { journal: false });
  return { ok: true, analyse: analyse.id, envoyee: envoyees > 0, creneau: analyse.creneau, calendrier: calendrier.length, reponses: reponses.length };
}

/** Le message Telegram de l'analyse : les rubriques du prompt, les statuts et le plan calculés par le code à l'envoi. */
export function messageAnalyse(a: Analyse, statuts: StatutPaire[], lignesPositions: string[]): string {
  const signaux = statuts.filter(s => s.statut === 'Signal' && s.plan);
  return [
    `${TETE} · analyse de ${hhmm(a.creneau ?? a.recu)}`,
    `Lecture : ${a.lecture}`,
    `Analyse : ${a.analyse}`,
    `Opportunité : ${a.opportunite}`,
    ...statuts.map(s => `• ${nomPaire(s.paire)} (code, prix lu ${prixFr(s.prix)} à ${hhmm(s.lu)} UTC) — ${ligneStatut(s)}`),
    `Action : ${a.action}`,
    ...signaux.flatMap(s => lignesPlan(s.plan!)),
    ...(lignesPositions.length ? ['Positions en cours :', ...lignesPositions] : []),
    `Pourquoi : ${a.pourquoi}`,
    ...a.actualite.map(x => `Actualité : ${x.texte} (${x.source.replace(/^https:\/\/(www\.)?/, '').split('/')[0]}, ${x.date})`),
    ...a.reponses.flatMap(r => [`Ta question « ${r.question} » : ${r.texte}`]),
  ].join('\n');
}

/** Envoie les analyses dont le créneau est arrivé ; périme celles qui ont plus de 3 h de retard. Rend le nombre envoyé. */
export async function envoyerAnalysesDues(kv: KV, deps: DepsFeu, now: number): Promise<number> {
  let n = 0;
  const dues = (await lireAnalyses(kv)).filter(a => !a.envoye && !a.perimee);
  if (!dues.length) return 0;
  const passage = await lirePassageFeu(kv);
  for (const a of dues) {
    const quand = a.creneau ?? a.recu;
    if (now < quand - MARGE_MS) continue;
    if (now - quand > PEREMPTION_MS || !passage || now - passage.quand > 20 * MIN) {
      if (now - quand > PEREMPTION_MS) await ecrireAnalyse(kv, { ...a, perimee: true });
      continue;
    }
    const etat = await lireEtatFeu(kv, now);
    const compte = await lireCompte(kv);
    const prix = Object.fromEntries(passage.statuts.map(s => [s.paire, s.prix]));
    const sit = situation(etat, compte, prix, now);
    const positions = sit.positions.map(p => {
      const s = passage.statuts.find(x => x.paire === p.paire);
      const pnl = s ? (s.prix * p.quantite * 0.999 - p.prixEntree * p.quantite) : null;
      return `• ${nomPaire(p.paire)} : entrée ${prixFr(p.prixEntree)}, ${p.quantite.toLocaleString('fr-FR', { maximumFractionDigits: 8 })}${p.objectif ? `, objectif ${prixFr(p.objectif)}` : ''}${p.stop ? `, stop ${prixFr(p.stop)}` : ''}${pnl !== null ? `, P&L net estimé ${usdt(pnl)} (prix lu à ${hhmm(s!.lu)} UTC)` : ''}`;
    });
    try {
      await envoyerAlerte(kv, deps.envoyer, messageAnalyse(a, passage.statuts, positions), undefined, now);
    } catch { console.error('feu : analyse pas partie (nouvel essai au prochain passage)'); continue; }
    await ecrireAnalyse(kv, { ...a, envoye: now });
    await ecrireEtat(kv, { agent: 'feu', statut: 'termine', tache: `envoie l'analyse de ${hhmm(quand)}`, outil: 'Tg', resultat: passage.statuts.map(s => `${nomPaire(s.paire)} ${s.statut}`).join(' ; ') }, now);
    n++;
  }
  return n;
}
