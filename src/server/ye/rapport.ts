// Le passage de Ye, seconde moitié : le rapport de la routine (`rapport`). Le serveur vérifie chaque proposition
// (champs autorisés, compétences existantes seulement, preuves d'un lien de démo, aucune clé, aucune consigne, moitié
// d'une description au plus retirée, raisons sourcées), range celles qui passent, note les autres dans le bureau,
// pose les questions de compétences, avance les marque-pages et envoie un message par fiche — en plusieurs morceaux
// plutôt que coupé : tout ce qui sera publié est montré en entier. Rien n'est publié ici (seulement après « Valider »).
import { createHash } from 'node:crypto';
import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import { neutraliserLiens } from '../lea/rapport';
import { contientSecret, MASQUE, masquerPaul } from '../paul/secrets';
import { contientInvisible, estCommande, invisiblesNouveaux, raisonSurUneLigne } from '../paul/rapport';
import { NOMS_CHAMPS } from './etiquette';
import { CHAMPS_TEXTE, normaliserUrl, preparerLot, resumePassage, type DepsYe } from './lot';
import {
  avecVerrou, changerSiAttente, CLES_YE, ecrireNouvelle, ecrireProposition, ecrireQuestion, expiree, JOUR, lireMeta, lireNouvelles, lirePropositions,
  lireQuestions, lireReserve, lireReserveAbsent, noterEchec, noterPassage, poserMarque, viderLot, type ReserveAbsent, type ReserveFiche,
} from './stockage';
import type { Changement, ChampTexte, ChampYe, Competence, NouvelleYe, PropositionYe, QuestionYe, Raison, RefusQGYe } from './types';

export const CHAMPS: readonly ChampYe[] = [...CHAMPS_TEXTE, 'technologies'];
export const STATUTS = ['production', 'development', 'done'] as const;
export const LIEN_BUREAU_YE = 'https://mon-qg.vercel.app/?bureau=ye';
export const MAX_DESCRIPTION = 2000;
export const MAX_KIND = 80;
/** Au-delà de la moitié des mots d'une description existante retirés, la proposition est refusée. */
export const SEUIL_RETRAIT = 0.5;
const MAX_RAISONS = 8;
const MAX_TEXTE_RAISON = 300;
const MAX_TECHNOS = 30;
/** Questions de compétences posées au plus par passage. */
export const MAX_QUESTIONS = 3;
/** Au-delà, un message Telegram part en plusieurs morceaux (Telegram en refuse plus de 4 096 caractères). */
export const MAX_MESSAGE = 3800;
const REFUS_MAX = 50;
const GARDE_MS = 60 * JOUR;

export const idCourt = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10);
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
/** La clé d'une techno : minuscules, lettres et chiffres seulement (« Next.js » → « nextjs »). */
export const cleTechno = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const NOM_TECHNO = /^[\p{L}\p{N}][\p{L}\p{N} .+#-]{0,39}$/u;

class RefusYe extends Error {}
const refuser = (raison: string): never => { throw new RefusYe(raison); };

/** Nom d'un champ affichable sans risque (jamais un texte reçu arbitraire). */
const nomChamp = (k: string) => (/^[A-Za-z]{1,20}$/.test(k) ? k : 'inconnu');
export { NOMS_CHAMPS };

type Sources = Pick<ReserveFiche, 'chemins' | 'shas'>;

function sourceValide(source: unknown, r: Sources): string {
  if (typeof source !== 'string' || !source.trim()) refuser('une raison sans source (sha court ou fichier du lot)');
  const s = (source as string).trim().replace(/^\.\//, '').replace(/\/$/, '');
  if (r.chemins.includes(s)) return s;
  if (/^[0-9a-f]{7,40}$/i.test(s)) {
    if (r.shas.some(sha => sha.startsWith(s.toLowerCase()))) return s.toLowerCase().slice(0, 7);
    refuser('une raison cite un commit absent du lot');
  }
  return refuser('une raison cite un fichier absent du lot');
}

function raisonsValides(brutes: unknown, r: Sources): Raison[] {
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
    return { texte: neutraliserLiens(masquerPaul(t)), source: sourceValide(o!.source, r) };
  });
}

/** Les mots d'un texte et combien d'entre eux disparaissent (plus longue sous-suite commune, mot à mot). */
export function partRetiree(avant: string, apres: string): number {
  const a = avant.split(/\s+/).filter(Boolean), b = apres.split(/\s+/).filter(Boolean);
  if (a.length === 0) return 0;
  if (a.length * b.length > 4_000_000) return 1;
  const w = b.length + 1;
  const t = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  }
  return (a.length - t[0]) / a.length;
}

/**
 * Le filtre de Ye (une fiche de portfolio est de la prose à la troisième personne : « L'app envoie une notification »,
 * « Never miss an order » passent) : refusées les phrases adressées à un agent (« tu dois », « ignore tes consignes »,
 * « en tant qu'IA »…), les impératifs en tête de ligne (« Supprime… », « Delete… ») et les commandes.
 */
const A_UN_AGENT = /\b(?:ignore[rsz]?|ignorer|disregard|tu dois|vous devez|il faut que tu|n['’]oublie pas|you must|you should|do not|don['’]t)\b|\ben tant qu['’]\s*(?:ia|assistant|agent)\b|\bas an (?:ai|assistant)\b|\b(?:tes|vos|your|previous|system) (?:consignes|instructions|prompt)\b/iu;
const IMPERATIF_EN_TETE = /^[\s•\-*>]*(?:efface|supprime|pousse|déploie|modifie|remplace|installe|désactive|exécute|lance|ignore|publie|réécris|clique|visite|delete|remove|push|deploy|install|execute|run|click|visit|rewrite|publish)(?!\p{L})/iu;
export const consigneYe = (l: string): boolean => A_UN_AGENT.test(l) || IMPERATIF_EN_TETE.test(l) || estCommande(l);
/** Les lignes qui imiteraient le message Telegram (où finit le texte publié) : refusées. */
const ETIQUETTE = /^\s*(?:(?:Avant|Après|Pourquoi|Le détail)\s*:|—.*—\s*$)|🎨|│/u;

/** Un texte qui sera publié : rien d'invisible, aucune clé, aucun masque, rien qui imite le message, aucune consigne, aucun code, aucune autre adresse que le lien de démo prouvé. */
export function texteSur(t: string, nom: string, liveUrl: string, avant: string): void {
  if (invisiblesNouveaux(avant, t)) refuser(`${nom} : contient un caractère invisible`);
  if (contientSecret(t)) refuser(`${nom} : contient une clé`);
  if (new RegExp(MASQUE.source).test(t)) refuser(`${nom} : contient un masque de clé`);
  const lignes = t.split('\n');
  if (lignes.some(l => ETIQUETTE.test(l))) refuser(`${nom} : une ligne imite le message Telegram`);
  if (lignes.some(consigneYe)) refuser(`${nom} : contient une consigne ou une commande, il doit rester descriptif`);
  if (/```|<\s*script|<\/?[a-z][^>]*>/i.test(t) || /^\s*\$\s/m.test(t)) refuser(`${nom} : contient du code`);
  // une adresse déjà dans le texte actuel du patron peut rester ; une nouvelle doit être le lien de démo prouvé
  const ADRESSE = /https?:\/\/[^\s<>"'`)\]]+/g;
  const deja = new Set([...avant.matchAll(ADRESSE)].map(m => normaliserUrl(m[0])));
  if (nom !== 'liveUrl' && [...t.matchAll(ADRESSE)].some(m => { const u = normaliserUrl(m[0]); return u !== normaliserUrl(liveUrl) && !deja.has(u); })) refuser(`${nom} : contient une adresse autre que le lien de démo prouvé`);
}

/**
 * Une proposition pour une fiche contre ce que le serveur a gardé. Rend la proposition prête à ranger, ou lève RefusYe
 * avec une phrase fixe (jamais un morceau du texte reçu).
 */
export function validerProposition(x: Record<string, unknown>, r: ReserveFiche, competences: Competence[], lot: string, now: number): PropositionYe {
  const champs = obj(x.champs);
  if (!champs || Object.keys(champs).length === 0) refuser('aucun champ proposé');
  for (const k of Object.keys(champs!)) if (!CHAMPS.includes(k as ChampYe)) refuser(`champ non autorisé : ${nomChamp(k)} (seulement ${CHAMPS.join(', ')})`);
  const set: Record<string, unknown> = {};
  const changements: Changement[] = [];
  const valeurs: Record<ChampTexte, string> = { ...r.actuel };
  for (const champ of CHAMPS_TEXTE) {
    if (!(champ in champs!)) continue;
    const v = champs![champ];
    if (typeof v !== 'string' || !v.trim()) refuser(`${champ} : un texte non vide est attendu`);
    if (r.masques.includes(champ)) refuser(`${champ} : la fiche y contient une clé masquée, Ye ne peut pas le réécrire sans risque`);
    let apres = (v as string).replace(/\r\n/g, '\n').trim();
    if (champ === 'kind' || champ === 'kindEn') {
      if (apres.length > MAX_KIND || apres.includes('\n')) refuser(`${champ} : une ligne de ${MAX_KIND} caractères au plus`);
    } else if (champ === 'description' || champ === 'descriptionEn') {
      if (apres.length > MAX_DESCRIPTION) refuser(`${champ} : ${MAX_DESCRIPTION} caractères au plus`);
      if (r.actuel[champ] && partRetiree(r.actuel[champ], apres) > SEUIL_RETRAIT) refuser(`${champ} : retire plus de la moitié de la description actuelle`);
    } else if (champ === 'status') {
      if (!(STATUTS as readonly string[]).includes(apres)) refuser('status : production, development ou done');
    } else if (champ === 'liveUrl') {
      apres = normaliserUrl(apres);
      if (!/^https:\/\/[^\s]+$/.test(apres)) refuser('liveUrl : une adresse https est attendue');
      if (!r.urls.includes(apres)) refuser('liveUrl : cette adresse n\'est pas dans le dépôt (homepage, CNAME, ou README chez un hébergeur ou sur ce domaine)');
    }
    if (apres === r.actuel[champ]) continue;
    valeurs[champ] = apres;
    set[champ] = apres;
    changements.push({ champ, avant: r.actuel[champ], apres });
  }
  for (const c of changements) texteSur(c.apres, c.champ, valeurs.liveUrl, c.avant);
  // Le portfolio affiche « En production » pour le statut production, ou pour un statut vide avec un lien de démo :
  // dès que la proposition touche l'un des deux, ce lien doit être prouvé par le dépôt.
  const enProduction = valeurs.status === 'production' || (!valeurs.status && !!valeurs.liveUrl);
  if (('status' in set || 'liveUrl' in set) && enProduction && !(valeurs.liveUrl && r.urls.includes(normaliserUrl(valeurs.liveUrl)))) {
    refuser('status : « En production » sans lien de démo prouvé dans le dépôt');
  }
  if ('technologies' in champs!) {
    const t = champs!.technologies;
    if (!Array.isArray(t) || t.length === 0 || t.length > MAX_TECHNOS) refuser(`technologies : une liste de 1 à ${MAX_TECHNOS} compétences`);
    const choisies: Competence[] = [];
    for (const x of t as unknown[]) {
      const c = typeof x === 'string' ? competences.find(s => s.id === x || cleTechno(s.name) === cleTechno(x)) : undefined;
      if (!c) refuser(`technologies : ${typeof x === 'string' && NOM_TECHNO.test(x) ? `« ${x} »` : 'une technologie'} n'est pas dans tes compétences`);
      if (!choisies.some(s => s.id === c!.id)) choisies.push(c!);
    }
    const noms = new Map(competences.map(s => [s.id, s.name]));
    const avant = r.actuel.technologies.map(ref => noms.get(ref._ref) ?? '(compétence inconnue)');
    const memes = choisies.length === r.actuel.technologies.length && choisies.every((c, i) => c.id === r.actuel.technologies[i]._ref);
    if (!memes) {
      // les références gardées gardent leur clé (le Studio les suit) ; les nouvelles en reçoivent une
      set.technologies = choisies.map(c => ({ _type: 'reference', _ref: c.id, _key: r.actuel.technologies.find(ref => ref._ref === c.id)?._key || idCourt(lot, r.ficheId, c.id) }));
      changements.push({ champ: 'technologies', avant: avant.join(', '), apres: choisies.map(c => c.name).join(', ') });
    }
  }
  if (changements.length === 0) refuser('rien ne change');
  const raisons = raisonsValides(x.raisons, r);
  return {
    id: idCourt(lot, r.ficheId), lot, ficheId: r.ficheId, rev: r.rev, titre: r.titre, depot: r.depot,
    set, changements, raisons, quand: now, statut: 'attente',
  };
}

/** Les technos connues sous un autre nom de paquet (préfixe « …/ » : tout le scope). */
const ALIAS: Record<string, string[]> = {
  payload: ['payload', '@payloadcms/'], sanity: ['sanity', '@sanity/', 'next-sanity'], supabase: ['@supabase/'],
  firebase: ['firebase', '@firebase/'], prisma: ['prisma', '@prisma/'], stripe: ['stripe', '@stripe/'], nextjs: ['next'],
  reactnative: ['react-native'], threejs: ['three'], trpc: ['@trpc/'], drizzle: ['drizzle-orm'], mongodb: ['mongodb', 'mongoose'],
  tanstackquery: ['@tanstack/react-query'], clerk: ['@clerk/'], expo: ['expo'], framermotion: ['framer-motion', 'motion'],
};

/** Prouvée par le package.json : un nom de dépendance exact (hors scope), ou un alias connu ; jamais un morceau de nom. */
export function prouveeParDependance(cle: string, dependances: string[]): boolean {
  const alias = ALIAS[cle];
  return dependances.some(d => {
    const n = d.toLowerCase();
    if (alias) return alias.some(a => (a.endsWith('/') ? n.startsWith(a) : n === a));
    return !n.startsWith('@') && cleTechno(n) === cle;
  });
}

/** Une question de compétence : la techno doit être vue dans le lot (dépendance ou message de commit cité). */
export function validerQuestion(x: unknown, r: Pick<ReserveFiche, 'titre' | 'dependances' | 'commits'>, competences: Competence[], dejaRepondues: Set<string>, lot: string, now: number): QuestionYe {
  const o = obj(x);
  if (!o || typeof o.techno !== 'string' || !NOM_TECHNO.test(o.techno.trim())) refuser('question : nom de techno illisible');
  // vérifié avant trim() : trim() retire aussi les séparateurs Unicode en bord de texte
  if (contientInvisible(o!.techno as string)) refuser('question : nom de techno refusé');
  const techno = (o!.techno as string).trim();
  if (contientSecret(techno) || consigneYe(techno) || contientInvisible(techno)) refuser('question : nom de techno refusé');
  const cle = cleTechno(techno);
  if (cle.length < 2) refuser('question : nom de techno trop court');
  if (competences.some(s => cleTechno(s.name) === cle)) refuser('question : déjà dans tes compétences');
  if (dejaRepondues.has(cle)) refuser('question : déjà posée');
  const source = typeof o!.source === 'string' ? o!.source.trim() : '';
  let vue = false;
  if (source === 'package.json') vue = prouveeParDependance(cle, r.dependances);
  else if (/^[0-9a-f]{7,40}$/i.test(source)) vue = r.commits.some(c => c.sha.startsWith(source.toLowerCase()) && c.message.split(/[^\p{L}\p{N}.+#-]+/u).some(m => cleTechno(m) === cle));
  if (!vue) refuser('question : la techno n\'est pas vue dans le lot (package.json ou message d\'un commit)');
  return { id: idCourt(lot, 'question', cle), techno, cle, titre: r.titre, source: source === 'package.json' ? source : source.toLowerCase().slice(0, 7), quand: now, statut: 'attente' };
}

// --- Nouvelle fiche (projet absent du portfolio) -------------------------------------------------------

export const MAX_TITRE = 80;
export const MAX_IMAGES_FICHE = 5;

/** L'identifiant du document à créer : « project-<titre en minuscules, sans accents> » (comme les fiches existantes). */
export const idDeFiche = (titre: string) =>
  `project-${titre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'projet'}`;

/**
 * Une nouvelle fiche pour un projet absent, contre ce que le serveur a gardé : mêmes règles qu'une mise à jour (textes
 * descriptifs, aucune clé, aucune consigne, compétences existantes seulement, lien de démo prouvé, raisons sourcées),
 * plus un titre d'une ligne et des images choisies parmi celles du dépôt. Lève RefusYe sinon.
 */
export function validerNouvelle(x: Record<string, unknown>, r: ReserveAbsent, competences: Competence[], lot: string, now: number): NouvelleYe {
  const champs = obj(x.champs);
  if (!champs) refuser('nouvelle fiche : « champs » manquant');
  const autorises = ['title', ...CHAMPS];
  for (const k of Object.keys(champs!)) if (!autorises.includes(k)) refuser(`nouvelle fiche : champ non autorisé : ${nomChamp(k)} (seulement ${autorises.join(', ')})`);
  const ligne = (nom: string, max: number, requis: boolean): string => {
    const v = champs![nom];
    if (v === undefined && !requis) return '';
    if (typeof v !== 'string' || !v.trim()) refuser(`${nom} : un texte non vide est attendu`);
    const t = (v as string).replace(/\r\n/g, '\n').trim();
    if (t.length > max) refuser(`${nom} : ${max} caractères au plus`);
    if (max <= MAX_TITRE && t.includes('\n')) refuser(`${nom} : une seule ligne`);
    return t;
  };
  const title = ligne('title', MAX_TITRE, true);
  const kind = ligne('kind', MAX_KIND, true);
  const kindEn = ligne('kindEn', MAX_KIND, true);
  const description = ligne('description', MAX_DESCRIPTION, true);
  const descriptionEn = ligne('descriptionEn', MAX_DESCRIPTION, true);
  const status = ligne('status', 20, true);
  if (!(STATUTS as readonly string[]).includes(status)) refuser('status : production, development ou done');
  let liveUrl = ligne('liveUrl', 300, false);
  if (liveUrl) {
    liveUrl = normaliserUrl(liveUrl);
    if (!/^https:\/\/[^\s]+$/.test(liveUrl)) refuser('liveUrl : une adresse https est attendue');
    if (!r.urls.includes(liveUrl)) refuser('liveUrl : cette adresse n\'est pas dans le dépôt (homepage, CNAME, ou README chez un hébergeur ou sur ce domaine)');
  }
  if (status === 'production' && !liveUrl) refuser('status : « En production » sans lien de démo prouvé dans le dépôt');
  for (const [nom, t] of [['title', title], ['kind', kind], ['kindEn', kindEn], ['description', description], ['descriptionEn', descriptionEn]] as const) {
    texteSur(t, nom, liveUrl, '');
  }
  const t = champs!.technologies;
  if (!Array.isArray(t) || t.length === 0 || t.length > MAX_TECHNOS) refuser(`technologies : une liste de 1 à ${MAX_TECHNOS} compétences`);
  const technologies: Competence[] = [];
  for (const v of t as unknown[]) {
    const c = typeof v === 'string' ? competences.find(s => s.id === v || cleTechno(s.name) === cleTechno(v)) : undefined;
    if (!c) refuser(`technologies : ${typeof v === 'string' && NOM_TECHNO.test(v) ? `« ${v} »` : 'une technologie'} n'est pas dans tes compétences`);
    if (!technologies.some(s => s.id === c!.id)) technologies.push(c!);
  }
  const imgs = x.images === undefined ? [] : x.images;
  if (!Array.isArray(imgs) || imgs.length > MAX_IMAGES_FICHE) refuser(`images : une liste de ${MAX_IMAGES_FICHE} images au plus`);
  const images: string[] = [];
  for (const i of imgs as unknown[]) {
    if (typeof i !== 'string' || !r.images.includes(i.replace(/^\.\//, ''))) refuser('images : une image absente de la liste du dépôt');
    const c = (i as string).replace(/^\.\//, '');
    if (!images.includes(c)) images.push(c);
  }
  const raisons = raisonsValides(x.raisons, r);
  return {
    id: idCourt(lot, 'nouvelle', r.depot.toLowerCase()), lot, depot: r.depot, tete: r.tete, docId: idDeFiche(title),
    champs: { title, kind, kindEn, status, description, descriptionEn, liveUrl, technologies }, images, raisons, quand: now, statut: 'attente',
  };
}

/** Le message « Patron, ce projet n'est pas dans ton portfolio » : toute la fiche en entier, puis Ajouter / Pas maintenant / Jamais. */
export function messagesNouvelle(n: NouvelleYe): { textes: string[]; boutons: { texte: string; donnee: string }[][] } {
  const marque = (t: string) => (t ? t.split('\n').map(l => `│ ${l}`) : ['(vide)']);
  const c = n.champs;
  const lignes = [`Patron, « ${c.title} » n'est pas dans ton portfolio. Je l'ajoute ?`, `(dépôt ${n.depot})`];
  const champ = (nom: string, v: string) => lignes.push('', `— ${nom} —`, ...marque(v));
  champ('Titre', c.title);
  champ(NOMS_CHAMPS.kind, `${c.kind} · ${c.kindEn}`);
  champ(NOMS_CHAMPS.status, c.status);
  if (c.liveUrl) champ(NOMS_CHAMPS.liveUrl, c.liveUrl);
  champ(NOMS_CHAMPS.technologies, c.technologies.map(t => t.name).join(', '));
  champ(NOMS_CHAMPS.description, c.description);
  champ(NOMS_CHAMPS.descriptionEn, c.descriptionEn);
  lignes.push('', n.images.length
    ? `Images (${n.images.length}, la première sur la carte) : ${n.images.join(', ')}`
    : 'Aucune image : la fiche sera créée en brouillon, invisible sur le site, le temps que tu ajoutes une image dans le Studio.');
  lignes.push('', 'Pourquoi :', ...n.raisons.map(r => `• ${r.texte} (${r.source})`), '', `Le détail : ${LIEN_BUREAU_YE}`);
  const titre = '🎨 Ye · projet absent du portfolio';
  const corps = enMessages(lignes, MAX_MESSAGE - titre.length - 20);
  const textes = corps.map((x, i) => (corps.length > 1 ? `${titre} (${i + 1}/${corps.length})` : titre) + '\n' + x);
  return {
    textes,
    boutons: [[{ texte: 'Ajouter', donnee: `ye:a:${n.id}` }, { texte: 'Pas maintenant', donnee: `ye:p:${n.id}` }, { texte: 'Jamais', donnee: `ye:j:${n.id}` }]],
  };
}

// --- Telegram ---------------------------------------------------------------------------------------

/**
 * Découpe des lignes en messages de 3 800 caractères au plus, sans rien couper ni perdre : une ligne trop longue
 * (jamais le cas d'une fiche, 2 000 caractères au plus) est partagée en morceaux.
 */
export function enMessages(lignes: string[], max = MAX_MESSAGE): string[] {
  const morceaux = lignes.flatMap(l => (l.length <= max ? [l] : Array.from({ length: Math.ceil(l.length / max) }, (_, i) => l.slice(i * max, (i + 1) * max))));
  const out: string[][] = [[]];
  let taille = 0;
  for (const l of morceaux) {
    if (out[out.length - 1].length && taille + l.length + 1 > max) { out.push([]); taille = 0; }
    out[out.length - 1].push(l);
    taille += l.length + 1;
  }
  return out.map(p => p.join('\n'));
}

/** Les messages d'une fiche : chaque champ avant/après en entier, les raisons ; les boutons sur le dernier. */
export function messagesFiche(p: PropositionYe): { textes: string[]; boutons: { texte: string; donnee: string }[][] } {
  const lignes: string[] = [];
  // chaque ligne publiée commence par « │ » : on voit où finit exactement le texte qui sera publié
  const marque = (t: string) => (t ? t.split('\n').map(l => `│ ${l}`) : ['(vide)']);
  for (const c of p.changements) lignes.push('', `— ${NOMS_CHAMPS[c.champ]} —`, 'Avant :', ...marque(c.avant), 'Après :', ...marque(c.apres));
  lignes.push('', 'Pourquoi :', ...p.raisons.map(r => `• ${r.texte} (${r.source})`), '', `Le détail : ${LIEN_BUREAU_YE}`);
  const titre = `🎨 Ye · fiche « ${p.titre} »`;
  const corps = enMessages(lignes, MAX_MESSAGE - titre.length - 20);
  const textes = corps.map((c, i) => (corps.length > 1 ? `${titre} (${i + 1}/${corps.length})` : titre) + '\n' + c);
  return { textes, boutons: [[{ texte: 'Valider', donnee: `ye:v:${p.id}` }, { texte: 'Refuser', donnee: `ye:r:${p.id}` }]] };
}

export function messageQuestion(q: QuestionYe): { texte: string; boutons: { texte: string; donnee: string }[][] } {
  return {
    texte: `🎨 Ye · une question\n\nLa fiche « ${q.titre} » utilise ${q.techno} (vu dans ${q.source}), absente de tes compétences. Tu la maîtrises ?`,
    boutons: [[{ texte: 'Oui, je l\'ajoute', donnee: `ye:o:${q.id}` }, { texte: 'Non', donnee: `ye:n:${q.id}` }]],
  };
}

// --- Le rapport ---------------------------------------------------------------------------------------

async function ranger(kv: KV, now: number): Promise<void> {
  for (const p of await lirePropositions(kv)) {
    if (expiree(p, now)) await changerSiAttente(kv, p.id, 'expiree', now);
    else if (p.statut !== 'attente' && now - (p.decide ?? p.quand) > GARDE_MS) await kv.hdel(CLES_YE.propositions, p.id);
  }
  for (const n of await lireNouvelles(kv)) {
    if (expiree(n, now)) await ecrireNouvelle(kv, { ...n, statut: 'expiree' });
    else if (n.statut !== 'attente' && now - (n.decide ?? n.quand) > GARDE_MS) await kv.hdel(CLES_YE.nouvelles, n.id);
  }
  for (const q of await lireQuestions(kv)) {
    if (expiree(q, now)) await ecrireQuestion(kv, { ...q, statut: 'expiree' });
    else if (q.statut !== 'attente' && now - (q.decide ?? q.quand) > GARDE_MS) await kv.hdel(CLES_YE.questions, q.id);
  }
}

/**
 * `rapport` : `{ lot, fiches: [{ fiche, rien: true } | { fiche, champs, raisons }], questions?: [{ fiche, techno, source }],
 * nouvelles?: [{ depot, rien: true } | { depot, champs, images, raisons }] }`.
 * Forme fausse → 400 ; lot déjà rendu ou remplacé → 409 ; fiche absente du lot ou donnée deux fois → 422. Sinon chaque
 * proposition et chaque question est jugée seule.
 */
export async function ecrireRapport(kv: KV, corps: unknown, deps: DepsYe, now: number): Promise<{ ok: true; propositions: number; questions: number; nouvelles: number; refusees: number; messages: number }> {
  const o = obj(corps);
  if (!o) throw new Refus('rapport : un objet JSON est attendu', 400);
  if (typeof o.lot !== 'string' || !o.lot) throw new Refus('« lot » manquant : renvoie l\'identifiant du lot reçu', 400);
  if (!Array.isArray(o.fiches)) throw new Refus('« fiches » : une liste est attendue ([{ fiche, rien } ou { fiche, champs, raisons }])', 400);
  if (o.questions !== undefined && !Array.isArray(o.questions)) throw new Refus('« questions » : une liste est attendue', 400);
  if (o.nouvelles !== undefined && !Array.isArray(o.nouvelles)) throw new Refus('« nouvelles » : une liste est attendue ([{ depot, rien } ou { depot, champs, images, raisons }])', 400);
  const bruts = o.fiches as unknown[];
  const questionsBrutes = (o.questions as unknown[] | undefined) ?? [];
  const nouvellesBrutes = (o.nouvelles as unknown[] | undefined) ?? [];
  return avecVerrou(kv, async () => {
    const { meta, fait } = await lireMeta(kv);
    if (fait === o.lot) throw new Refus('ce rapport a déjà été reçu', 409);
    if (!meta || meta.id !== o.lot) throw new Refus('lot inconnu ou remplacé : relance « a-comparer »', 409);
    const lot = meta.id;
    const traitees: { r: ReserveFiche; x: Record<string, unknown> }[] = [];
    for (const [i, x] of bruts.entries()) {
      const p = obj(x);
      if (!p || typeof p.fiche !== 'string' || !meta.fiches.includes(p.fiche)) throw new Refus(`fiches[${i}] : fiche absente du lot`, 422);
      if (traitees.some(t => t.r.ficheId === p.fiche)) throw new Refus(`fiches[${i}] : fiche donnée deux fois`, 422);
      const r = await lireReserve(kv, p.fiche);
      if (!r) throw new Refus(`fiches[${i}] : fiche du lot introuvable, relance « a-comparer »`, 409);
      traitees.push({ r, x: p });
    }
    const absents: { r: ReserveAbsent; x: Record<string, unknown> }[] = [];
    for (const [i, x] of nouvellesBrutes.entries()) {
      const p = obj(x);
      const depot = p && typeof p.depot === 'string' ? (meta.absents ?? []).find(d => d.toLowerCase() === (p.depot as string).toLowerCase()) : undefined;
      if (!p || !depot) throw new Refus(`nouvelles[${i}] : projet absent du lot`, 422);
      if (absents.some(a => a.r.depot === depot)) throw new Refus(`nouvelles[${i}] : projet donné deux fois`, 422);
      const r = await lireReserveAbsent(kv, depot);
      if (!r) throw new Refus(`nouvelles[${i}] : projet du lot introuvable, relance « a-comparer »`, 409);
      absents.push({ r, x: p });
    }

    const refus: RefusQGYe[] = [];
    const props: PropositionYe[] = [];
    for (const { r, x } of traitees) {
      if (x.rien === true) continue;
      try { props.push(validerProposition(x, r, meta.competences, lot, now)); } catch (e) {
        if (!(e instanceof RefusYe)) throw e;
        refus.push({ quand: now, titre: r.titre, raison: e.message });
      }
    }
    const nouvelles: NouvelleYe[] = [];
    for (const { r, x } of absents) {
      if (x.rien === true) continue;
      try { nouvelles.push(validerNouvelle(x, r, meta.competences, lot, now)); } catch (e) {
        if (!(e instanceof RefusYe)) throw e;
        refus.push({ quand: now, titre: `projet ${r.depot.split('/')[1] ?? r.depot}`, raison: e.message });
      }
    }
    const reponses = new Set(Object.keys(await kv.hgetall(CLES_YE.reponses)));
    for (const q of await lireQuestions(kv)) if (q.statut === 'attente' && !expiree(q, now)) reponses.add(q.cle);
    const questions: QuestionYe[] = [];
    for (const x of questionsBrutes) {
      const f = obj(x);
      // une question porte sur une fiche du rapport (« fiche ») ou sur un projet absent (« depot »)
      const fiche = f && typeof f.fiche === 'string' ? traitees.find(k => k.r.ficheId === f.fiche)?.r : undefined;
      const absent = !fiche && f && typeof f.depot === 'string' ? absents.find(k => k.r.depot.toLowerCase() === (f.depot as string).toLowerCase())?.r : undefined;
      const source = fiche ?? (absent ? { titre: absent.depot.split('/')[1] ?? absent.depot, dependances: absent.dependances, commits: absent.commits } : undefined);
      if (!source) { refus.push({ quand: now, titre: 'question', raison: 'question : fiche absente du rapport' }); continue; }
      try {
        if (questions.length >= MAX_QUESTIONS) refuser(`question : ${MAX_QUESTIONS} au plus par passage`);
        const q = validerQuestion(x, source, meta.competences, reponses, lot, now);
        reponses.add(q.cle);
        questions.push(q);
      } catch (e) {
        if (!(e instanceof RefusYe)) throw e;
        refus.push({ quand: now, titre: source.titre, raison: e.message });
      }
    }

    // Rangées avant l'envoi ; les précédentes en attente de la même fiche sont remplacées (sous leur verrou).
    const existantes = await lirePropositions(kv);
    for (const p of props) {
      for (const a of existantes) if (a.statut === 'attente' && a.ficheId === p.ficheId && a.id !== p.id) await changerSiAttente(kv, a.id, 'remplacee', now);
      await ecrireProposition(kv, p);
    }
    for (const q of questions) await ecrireQuestion(kv, q);
    for (const n of nouvelles) await ecrireNouvelle(kv, n);
    for (const x of refus) await kv.lpush(CLES_YE.refus, JSON.stringify(x));
    if (refus.length) await kv.ltrim(CLES_YE.refus, 0, REFUS_MAX - 1);
    for (const { r } of traitees) await poserMarque(kv, r.depot, r.tete);
    await kv.hset(CLES_YE.lot, 'fait', lot);
    await viderLot(kv);
    await ranger(kv, now);

    // Un message (ou plusieurs morceaux) par fiche à mettre à jour, un par question ; aucun sinon.
    let messages = 0;
    for (const p of props) {
      const m = messagesFiche(p);
      try {
        for (const [i, t] of m.textes.entries()) await deps.envoyer(t, i === m.textes.length - 1 ? m.boutons : undefined);
        messages++;
      } catch { console.error('ye : envoi Telegram échoué (la proposition reste dans le bureau)'); }
    }
    for (const n of nouvelles) {
      const m = messagesNouvelle(n);
      try {
        for (const [i, t] of m.textes.entries()) await deps.envoyer(t, i === m.textes.length - 1 ? m.boutons : undefined);
        messages++;
      } catch { console.error('ye : envoi Telegram échoué (la nouvelle fiche reste dans le bureau)'); }
    }
    for (const q of questions) {
      const m = messageQuestion(q);
      try { await deps.envoyer(m.texte, m.boutons); messages++; } catch { console.error('ye : envoi Telegram échoué (la question reste dans le bureau)'); }
    }
    const nonLus = [...meta.illisibles, ...meta.fiches.filter(id => !traitees.some(t => t.r.ficheId === id)).map(() => 'une fiche du lot')];
    if (traitees.length === 0 && absents.length === 0) {
      await noterEchec(kv, { quand: now, raison: 'la routine n\'a relu aucune fiche' });
      await ecrireEtat(kv, { agent: 'ye', statut: 'erreur', tache: 'n\'a relu aucune fiche du lot', outil: 'Sa' }, now);
    } else {
      await noterPassage(kv, { quand: now, relus: traitees.length, propositions: props.length, questions: questions.length, refusees: refus.length, illisibles: nonLus, sansLien: meta.sansLien, nouvelles: nouvelles.length });
      await ecrireEtat(kv, { agent: 'ye', statut: 'termine', tache: resumePassage(props.length, questions.length, refus.length, nonLus, nouvelles.length), outil: 'Sa' }, now);
    }
    return { ok: true as const, propositions: props.length, questions: questions.length, nouvelles: nouvelles.length, refusees: refus.length, messages };
  });
}

export async function traiterActionYe(kv: KV, action: string, corps: unknown, deps: DepsYe, now: number = Date.now()): Promise<unknown> {
  switch (action) {
    case 'a-comparer':
      if (corps !== undefined) throw new Refus('« a-comparer » se demande en GET', 405);
      return preparerLot(kv, deps, now);
    case 'rapport':
      if (corps === undefined) throw new Refus('le rapport s\'envoie en POST', 405);
      return ecrireRapport(kv, corps, deps, now);
    default:
      throw new Refus('action inconnue', 404);
  }
}
