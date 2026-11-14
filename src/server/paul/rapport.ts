// Le passage de Paul, seconde moitié : le rapport de la routine (`rapport`). Le serveur vérifie chaque proposition
// (fichier autorisé, taille, aucune clé, règle des 40 %, sources du lot, sha lu), range celles qui passent, note les
// autres dans le bureau (« proposition refusée par le QG »), avance les marque-pages et envoie un message Telegram par
// projet qui a quelque chose à proposer. Rien n'est écrit sur GitHub ici : seulement après « Valider » (ecriture.ts).
import { createHash } from 'node:crypto';
import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import { neutraliserLiens } from '../lea/rapport';
import { contientSecret, masquerPaul as masquerTexte } from './secrets';
import { nomCourt } from '../lea/etiquette';
import { blocPropre, extraireBloc, reconstruire, TRACE_MARQUEUR } from './bloc';
import { difference, retireTrop } from './diff';
import { preparerLot, type DepsPaul } from './lot';
import {
  avecVerrou, changerSiAttente, CLES_PAUL, ecrireProposition, expiree, JOUR, lireMeta, lirePropositions, lireReserveProjet,
  noterEchec, noterPassage, phraseEchec, poserMarque, resumePassage, viderLot, type ReserveProjet,
} from './stockage';

export { resumePassage };
import type { FichierDoc, Proposition, Raison, RefusQG } from './types';

export const FICHIERS: readonly FichierDoc[] = ['README.md', 'CLAUDE.md'];
export const LIEN_BUREAU_PAUL = 'https://mon-qg.vercel.app/?bureau=paul';
export const MAX_FICHIER = 100 * 1024;
const MAX_RAISONS = 8;
const MAX_TEXTE_RAISON = 300;
const MAX_LIGNE_TELEGRAM = 180;
/** Raisons montrées sur Telegram par proposition (les autres : dans le bureau) — le bloc, lui, est toujours montré entier. */
const MAX_RAISONS_TELEGRAM = 3;
/** Un bloc « Où on s'est arrêté » reste court, et assez court pour être montré entier sur Telegram (4 096 caractères). */
const MAX_LIGNES_BLOC = 20;
const MAX_LIGNE_BLOC = 160;
const MAX_OCTETS_BLOC = 2048;
/** Au-delà, une ligne n'est pas lisible en entier par la routine : elle doit rester telle quelle. */
const LIGNE_ILLISIBLE = 1800;
/**
 * Le bloc ne contient que de la description (dates, fait, en cours, suite) : CLAUDE.md est lu par Claude Code comme
 * des consignes. Une ligne qui importe un fichier (« @… »), une consigne adressée à un agent, ou une commande à lancer
 * est refusée.
 */
const CONSIGNE = /\b(?:ignore[rsz]?|ignorer|tu dois|vous devez|il faut que tu|n'oublie|always|never|must|you should|do not|don't|run)\b/i;
/**
 * Les ordres en français à un agent : impératif (« efface », « supprime-le »…), jamais le participe ou l'infinitif
 * d'un texte descriptif (« supprimé », « lancer »). Bornes Unicode : « supprimé » ne commence pas par « supprime ».
 */
const ORDRE_FR = /(?<!\p{L})(?:efface|supprime|pousse|déploie|modifie|remplace|installe|désactive|envoie|exécute|lance)(?:-(?:le|la|les|moi|nous|lui))?(?!\p{L})/iu;
const COMMANDE = /`\s*(?:npm|npx|pnpm|yarn|bun|node|git|gh|curl|wget|rm|sudo|bash|sh|zsh|python3?|pip|make|cd|docker|vercel|chmod|kill)\b/i;
/** Une ligne qui donne un ordre à un agent ou une commande à lancer (aussi pour les fiches de Ye). */
export const consigneOuCommande = (l: string): boolean => CONSIGNE.test(l) || ORDRE_FR.test(l) || COMMANDE.test(l);
/** Une commande à lancer entre guillemets inverses (`npm …`, `git …`, `curl …`). */
export const estCommande = (l: string): boolean => COMMANDE.test(l);
/** Un caractère invisible (contrôle, format, balises Unicode) : jamais dans un texte écrit, on ne le verrait pas. */
// Contrôles et formats (zéro largeur, sens d'écriture…), séparateurs de ligne et de paragraphe Unicode (ils
// couperaient une ligne sans « \n » et échapperaient au marquage « │ »), balises Unicode, et faux blancs (U+3164,
// U+115F, U+1160, U+FFA0, U+2800).
export const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u{E0000}-\u{E007F}\u3164\u115F\u1160\uFFA0\u2800]/gu;

/** Les caractères invisibles d'un texte, comptés par point de code (hors « \n », « \t », « \r\n » et un BOM en tête). */
function invisibles(t: string): Map<string, number> {
  const n = new Map<string, number>();
  for (const m of t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/[\n\t]/g, '').matchAll(INVISIBLE)) n.set(m[0], (n.get(m[0]) ?? 0) + 1);
  return n;
}

/**
 * Vrai si `apres` contient un caractère invisible que `avant` (le texte actuel du patron) n'avait pas, ou plus de
 * fois : ceux qu'il avait déjà (BOM, trait d'union conditionnel, émoji 👨‍💻) ne bloquent pas une réécriture.
 */
export function invisiblesNouveaux(avant: string, apres: string): boolean {
  const deja = invisibles(avant);
  return [...invisibles(apres)].some(([c, n]) => n > (deja.get(c) ?? 0));
}
export const contientInvisible = (t: string): boolean => invisiblesNouveaux('', t);
/** Une raison tient sur une ligne, sans caractère invisible (elle est montrée telle quelle sur Telegram). */
export const raisonSurUneLigne = (t: string): boolean => !/[\r\n]/.test(t) && invisibles(t).size === 0;
/** Les lignes qui imiteraient le message Telegram de Paul (où finit le bloc montré) : refusées dans un bloc. */
const ETIQUETTE_PAUL = /^\s*(?:Le bloc|Le détail|README\.md|CLAUDE\.md)\b[^\n]*:|📚|│/u;
const REFUS_MAX = 50;
/** Les propositions traitées sont oubliées après 60 jours. */
const GARDE_MS = 60 * JOUR;

/** L'identifiant d'une proposition : court (Telegram limite les boutons à 64 octets), stable pour un lot. */
export const idProposition = (lot: string, depot: string, fichier: string) =>
  createHash('sha1').update(`${lot}|${depot}|${fichier}`).digest('hex').slice(0, 10);

const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const octets = (t: string) => Buffer.byteLength(t, 'utf8');

/** Un refus du QG : une phrase fixe, jamais un morceau du texte reçu (il pourrait contenir une clé). */
class RefusProposition extends Error {}
const refuser = (raison: string): never => { throw new RefusProposition(raison); };

/** Une source citée : un fichier réel du lot, ou un sha court (7 caractères au moins) d'un commit du lot. */
function sourceValide(source: unknown, r: ReserveProjet): string {
  if (typeof source !== 'string' || !source.trim()) refuser('une raison sans source (sha court ou fichier du lot)');
  const s = (source as string).trim().replace(/^\.\//, '').replace(/\/$/, '');
  if (r.chemins.includes(s)) return s;
  if (/^[0-9a-f]{7,40}$/i.test(s)) {
    if (r.shas.some(sha => sha.startsWith(s.toLowerCase()))) return s.toLowerCase().slice(0, 7);
    refuser('une raison cite un commit absent du lot');
  }
  return refuser('une raison cite un fichier absent du lot');
}

function raisonsValides(brutes: unknown, r: ReserveProjet): Raison[] {
  if (!Array.isArray(brutes) || brutes.length === 0) refuser('aucune raison donnée');
  const liste = brutes as unknown[];
  if (liste.length > MAX_RAISONS) refuser(`plus de ${MAX_RAISONS} raisons`);
  return liste.map(x => {
    const o = obj(x);
    if (!o || typeof o.texte !== 'string' || !o.texte.trim()) refuser('une raison sans texte');
    const t = (o!.texte as string).trim();
    if (t.length > MAX_TEXTE_RAISON) refuser(`une raison de plus de ${MAX_TEXTE_RAISON} caractères`);
    if (!raisonSurUneLigne(t)) refuser('une raison tient sur une seule ligne, sans caractère invisible');
    if (contientSecret(t)) refuser('une raison contient une clé');
    return { texte: neutraliserLiens(masquerTexte(t)), source: sourceValide(o!.source, r) };
  });
}

/**
 * Une proposition contre ce que le serveur a gardé du projet. Rend la proposition prête à ranger, ou lève
 * RefusProposition avec une phrase fixe. Le CLAUDE.md est reconstruit par le serveur à partir du bloc seul.
 */
export function validerProposition(x: unknown, r: ReserveProjet, lot: string, now: number): Proposition {
  const o = obj(x);
  if (!o) refuser('proposition illisible');
  const p = o!;
  if (!FICHIERS.includes(p.fichier as FichierDoc)) refuser('fichier non autorisé (seulement README.md ou CLAUDE.md à la racine)');
  const fichier = p.fichier as FichierDoc;
  const doc = fichier === 'README.md' ? r.readme : r.claude;
  const attendue = doc.present ? doc.sha : null;
  if ((p.base ?? null) !== attendue) refuser('« base » n\'est pas le sha du fichier lu dans le lot');
  if (attendue === null) {
    // un fichier nouveau : seulement si l'on sait qu'aucune variante (« readme.md », « Claude.md ») n'existe déjà
    if (!r.arbreLu) refuser(`${fichier} : arborescence illisible, pas de nouveau fichier sans risque de doublon`);
    if (r.racine.some(n => n.toLowerCase() === fichier.toLowerCase())) refuser(`${fichier} : un fichier du même nom (casse différente) existe déjà`);
  }
  const avant = doc.present ? doc.contenu : '';
  let apres: string;
  const champ: { contenu?: string; bloc?: string } = {};
  if (fichier === 'README.md') {
    if (p.bloc !== undefined) refuser('README.md : le fichier complet va dans « contenu », pas de « bloc »');
    if (typeof p.contenu !== 'string' || !p.contenu.trim()) refuser('README.md : « contenu » vide');
    if (doc.present && doc.enPartie) refuser('README.md lu en partie : pas de réécriture complète');
    if (doc.present && doc.masque) refuser('le README contient une clé masquée : Paul ne peut pas le réécrire sans risque');
    apres = p.contenu as string;
    const gardees = new Set(apres.replace(/\r\n/g, '\n').split('\n'));
    if (avant.replace(/\r\n/g, '\n').split('\n').some(l => l.length > LIGNE_ILLISIBLE && !gardees.has(l))) refuser('README.md : une ligne trop longue pour être lue en entier a changé');
    champ.contenu = apres;
  } else {
    if (p.contenu !== undefined) refuser('CLAUDE.md : seulement le bloc « Où on s\'est arrêté » (champ « bloc »)');
    if (typeof p.bloc !== 'string' || !p.bloc.trim()) refuser('CLAUDE.md : « bloc » vide');
    const bloc = p.bloc as string;
    if (doc.present && doc.enPartie) refuser('CLAUDE.md lu en partie : le bloc ne peut pas être placé sans risque');
    if (TRACE_MARQUEUR.test(bloc)) refuser('CLAUDE.md : le bloc contient un marqueur de Paul');
    const propre = blocPropre(bloc);
    const lignes = propre.split('\n');
    if (lignes.length > MAX_LIGNES_BLOC) refuser(`CLAUDE.md : le bloc dépasse ${MAX_LIGNES_BLOC} lignes`);
    if (lignes.some(l => l.length > MAX_LIGNE_BLOC)) refuser(`CLAUDE.md : une ligne du bloc dépasse ${MAX_LIGNE_BLOC} caractères`);
    if (octets(propre) > MAX_OCTETS_BLOC) refuser('CLAUDE.md : le bloc dépasse 2 Ko');
    if (lignes.some(l => l.trim().startsWith('@'))) refuser('CLAUDE.md : le bloc importe un fichier (ligne « @… »)');
    if (lignes.some(consigneOuCommande)) refuser('CLAUDE.md : le bloc contient une consigne ou une commande, il doit rester descriptif');
    if (lignes.some(l => ETIQUETTE_PAUL.test(l))) refuser('CLAUDE.md : une ligne du bloc imite le message Telegram');
    if (extraireBloc(avant) === 'abime') refuser('CLAUDE.md : les marqueurs de Paul y sont abîmés');
    apres = reconstruire(avant, bloc);
    champ.bloc = bloc;
  }
  const texte = champ.contenu ?? champ.bloc!;
  if (octets(texte) > MAX_FICHIER) refuser('plus de 100 Ko');
  if (invisiblesNouveaux(champ.contenu !== undefined ? avant : (typeof extraireBloc(avant) === 'string' ? extraireBloc(avant) as string : ''), texte)) refuser('contient un caractère invisible');
  if (contientSecret(texte)) refuser('contient une clé');
  const raisons = raisonsValides(p.raisons, r);
  // le bloc de CLAUDE.md : toutes ses lignes, entières, dans la page
  const d = difference(avant, apres, { entier: fichier === 'CLAUDE.md' });
  if (d.ajoutees === 0 && d.retirees === 0) refuser('rien ne change');
  if (fichier === 'README.md' && retireTrop(d)) refuser('retire plus de 40 % des lignes du README actuel');
  return {
    id: idProposition(lot, r.depot, fichier), lot, depot: r.depot, branche: r.branche, fichier, base: attendue, ...champ, raisons,
    diff: d.lignes, ajoutees: d.ajoutees, retirees: d.retirees, quand: now, statut: 'attente',
  };
}

// --- Telegram ---------------------------------------------------------------------------------------

const ligne = (t: string) => { const l = t.replace(/\s+/g, ' ').trim(); return l.length > MAX_LIGNE_TELEGRAM ? l.slice(0, MAX_LIGNE_TELEGRAM - 1) + '…' : l; };

/** Le message d'un projet : par fichier, ce qui change et les raisons ; une rangée Valider / Refuser par fichier. */
export function messageProjet(depot: string, props: Proposition[]): { texte: string; boutons: { texte: string; donnee: string }[][] } {
  const lignes = [`📚 Paul · ${nomCourt(depot)}`];
  for (const p of props) {
    const quoi = p.fichier === 'CLAUDE.md' ? 'CLAUDE.md (« Où on s\'est arrêté »)' : p.base === null ? 'README.md (nouveau)' : 'README.md';
    const autres = p.raisons.length - MAX_RAISONS_TELEGRAM;
    lignes.push('', `${quoi} : +${p.ajoutees} −${p.retirees} lignes`, ...p.raisons.slice(0, MAX_RAISONS_TELEGRAM).map(r => ligne(`• ${r.texte} (${r.source})`)));
    if (autres > 0) lignes.push(`• + ${autres} ${autres > 1 ? 'autres raisons' : 'autre raison'} dans le bureau`);
    // le bloc est montré entier, au caractère près, tel qu'il sera écrit : on ne valide jamais sans l'avoir vu
    // chaque ligne du bloc commence par « │ » : on voit où finit exactement ce qui sera écrit
    if (p.bloc !== undefined) lignes.push('', 'Le bloc :', ...blocPropre(p.bloc).split('\n').map(l => `│ ${l}`));
  }
  lignes.push('', `Le détail : ${LIEN_BUREAU_PAUL}`);
  return {
    texte: lignes.join('\n'),
    boutons: props.map(p => [{ texte: `Valider · ${p.fichier}`, donnee: `pau:v:${p.id}` }, { texte: 'Refuser', donnee: `pau:r:${p.id}` }]),
  };
}

// --- Le rapport ---------------------------------------------------------------------------------------

/** Les propositions en attente trop vieilles passent « expirée » ; les traitées de plus de 60 jours sont oubliées. */
async function ranger(kv: KV, now: number): Promise<void> {
  for (const p of await lirePropositions(kv)) {
    if (expiree(p, now)) await changerSiAttente(kv, p.id, 'expiree', now);
    else if (p.statut !== 'attente' && now - (p.decide ?? p.quand) > GARDE_MS) await kv.hdel(CLES_PAUL.propositions, p.id);
  }
}

/**
 * `rapport` : `{ lot, projets: [{ depot, rien?: true, propositions?: [...] }] }`. Forme fausse → 400 ; lot déjà rendu
 * ou remplacé → 409 ; dépôt absent du lot ou donné deux fois → 422 (rien n'est écrit). Sinon chaque proposition est
 * jugée seule (voir validerProposition).
 */
export async function ecrireRapport(kv: KV, corps: unknown, deps: DepsPaul, now: number): Promise<{ ok: true; propositions: number; refusees: number; messages: number }> {
  const o = obj(corps);
  if (!o) throw new Refus('rapport : un objet JSON est attendu', 400);
  if (typeof o.lot !== 'string' || !o.lot) throw new Refus('« lot » manquant : renvoie l\'identifiant du lot reçu', 400);
  if (!Array.isArray(o.projets)) throw new Refus('« projets » : une liste est attendue ([{ depot, rien } ou { depot, propositions }])', 400);
  const projetsBruts = o.projets as unknown[];
  return avecVerrou(kv, async () => {
    const { meta, fait } = await lireMeta(kv);
    if (fait === o.lot) throw new Refus('ce rapport a déjà été reçu', 409);
    if (!meta || meta.id !== o.lot) throw new Refus('lot inconnu ou remplacé : relance « a-documenter »', 409);
    const lot = meta.id;

    const traites: { r: ReserveProjet; bruts: unknown[] }[] = [];
    for (const [i, x] of projetsBruts.entries()) {
      const p = obj(x);
      if (!p || typeof p.depot !== 'string' || !meta.depots.includes(p.depot)) throw new Refus(`projets[${i}] : dépôt absent du lot`, 422);
      if (traites.some(t => t.r.depot === p.depot)) throw new Refus(`projets[${i}] : dépôt donné deux fois`, 422);
      if (p.propositions !== undefined && !Array.isArray(p.propositions)) throw new Refus(`projets[${i}].propositions : une liste est attendue`, 400);
      const r = await lireReserveProjet(kv, p.depot);
      if (!r) throw new Refus(`projets[${i}] : projet du lot introuvable, relance « a-documenter »`, 409);
      traites.push({ r, bruts: p.rien === true ? [] : ((p.propositions as unknown[] | undefined) ?? []) });
    }

    const refus: RefusQG[] = [];
    const parProjet: { depot: string; props: Proposition[] }[] = [];
    for (const { r, bruts } of traites) {
      const props: Proposition[] = [];
      for (const b of bruts) {
        const fichier = typeof obj(b)?.fichier === 'string' && FICHIERS.includes(obj(b)!.fichier as FichierDoc) ? obj(b)!.fichier as string : 'autre fichier';
        try {
          const prop = validerProposition(b, r, lot, now);
          if (props.some(q => q.fichier === prop.fichier)) refuser('deux propositions pour le même fichier');
          props.push(prop);
        } catch (e) {
          if (!(e instanceof RefusProposition)) throw e;
          refus.push({ quand: now, depot: r.depot, fichier, raison: e.message });
        }
      }
      if (props.length) parProjet.push({ depot: r.depot, props });
    }

    // Rangées avant l'envoi : un clic ne tombe jamais sur une proposition inconnue. Les précédentes en attente du même
    // projet et du même fichier sont remplacées.
    const existantes = await lirePropositions(kv);
    for (const { props } of parProjet) for (const p of props) {
      for (const a of existantes) if (a.statut === 'attente' && a.depot === p.depot && a.fichier === p.fichier && a.id !== p.id) {
        await changerSiAttente(kv, a.id, 'remplacee', now);
      }
      await ecrireProposition(kv, p);
    }
    for (const x of refus) await kv.lpush(CLES_PAUL.refus, JSON.stringify(x));
    if (refus.length) await kv.ltrim(CLES_PAUL.refus, 0, REFUS_MAX - 1);
    for (const { r } of traites) await poserMarque(kv, r.depot, r.tete);
    await kv.hset(CLES_PAUL.lot, 'fait', lot);
    await viderLot(kv);
    await ranger(kv, now);

    // Un message par projet qui a quelque chose à proposer ; aucun sinon.
    let messages = 0;
    for (const { depot, props } of parProjet) {
      const m = messageProjet(depot, props);
      try {
        await deps.envoyer(m.texte, m.boutons);
        messages++;
      } catch {
        console.error('paul : envoi Telegram échoué (les propositions restent dans le bureau)');
      }
    }
    const nonTraites = [...meta.illisibles, ...meta.depots.filter(d => !traites.some(t => t.r.depot === d)).map(nomCourt)];
    const nb = parProjet.reduce((n, p) => n + p.props.length, 0);
    if (traites.length === 0) {
      // la routine n'a relu aucun projet : un passage raté, pas « en partie »
      await noterEchec(kv, { quand: now, illisibles: nonTraites });
      await ecrireEtat(kv, { agent: 'paul', statut: 'erreur', tache: phraseEchec(nonTraites), outil: 'GH' }, now);
    } else {
      await noterPassage(kv, { quand: now, relus: traites.length, propositions: nb, refusees: refus.length, illisibles: nonTraites });
      await ecrireEtat(kv, { agent: 'paul', statut: 'termine', tache: resumePassage(traites.length, nb, refus.length, nonTraites), outil: 'GH' }, now);
    }
    return { ok: true as const, propositions: nb, refusees: refus.length, messages };
  });
}

/** Les actions de la route d'agent. `corps` : le JSON reçu en POST (undefined en GET). */
export async function traiterActionPaul(kv: KV, action: string, corps: unknown, deps: DepsPaul, now: number = Date.now()): Promise<unknown> {
  switch (action) {
    case 'a-documenter':
      if (corps !== undefined) throw new Refus('« a-documenter » se demande en GET', 405);
      return preparerLot(kv, deps, now);
    case 'rapport':
      if (corps === undefined) throw new Refus('le rapport s\'envoie en POST', 405);
      return ecrireRapport(kv, corps, deps, now);
    default:
      throw new Refus('action inconnue', 404);
  }
}

