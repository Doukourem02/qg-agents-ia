import type { KV } from '../memoire';
import { Refus } from '../qg';
import { demanderAccord, lireAccord } from '../accords';
import { CATALOGUE_PROJETS, noterPublie, projetsInterdits, type MemoireL } from './memoire';
import type { Visuel } from './visuels';

// Les propositions de sujets (3 par semaine) et les brouillons de posts, avec leur accord.

export type Sujet = { titre: string; angle: string; accroche: string; pourquoiMoi: string; format: 'texte' | 'carte' | 'schema' | 'capture' | 'carrousel'; source?: string };
export type Proposition = { id: string; semaine: string; sujets: Sujet[]; choix?: number; quand: number };
export type Post = {
  id: string; sujet: string; texte: string; hashtags: string[];
  statut: 'brouillon' | 'en accord' | 'pret' | 'publie' | 'abandonne';
  accordId?: string; quand: number;
  /** La proposition et le numéro du sujet (à partir de 0) dont ce post est tiré, s'il y en a un. */
  propositionId?: string; index?: number;
  /** La description du visuel (validée), envoyé en image avec la demande puis avec le texte prêt. */
  visuel?: Visuel;
  /** La publication sur LinkedIn : l'URN et l'adresse du post une fois parti ; `tentative`, l'heure d'un envoi
   *  en cours ou resté sans réponse (le post est peut-être parti). */
  linkedin?: { urn?: string; url?: string; quand?: number; tentative?: number };
};

export const CLE_PROPOSITIONS = 'l:propositions';
export const CLE_POSTS = 'l:posts';

const nouvelId = () => Math.random().toString(36).slice(2, 8);

/** Semaine ISO 8601, ex. « 2026-W46 ». */
export function semaineIso(ms: number): string {
  const d = new Date(Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate()));
  const jour = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jour);
  const debut = Date.UTC(d.getUTCFullYear(), 0, 1);
  const n = Math.ceil(((d.getTime() - debut) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(n).padStart(2, '0')}`;
}

async function lireProposition(kv: KV, id: string): Promise<Proposition | null> {
  const tout = await kv.hgetall(CLE_PROPOSITIONS);
  const v = Object.hasOwn(tout, id) ? tout[id] : undefined; // « constructor » ou « __proto__ » ne sont pas des ids
  return v ? JSON.parse(v) : null;
}

export async function enregistrerPropositions(kv: KV, sujets: Sujet[], now = Date.now()): Promise<Proposition> {
  if (!Array.isArray(sujets) || sujets.length !== 3) throw new Refus('il faut exactement 3 sujets');
  const p: Proposition = { id: nouvelId(), semaine: semaineIso(now), sujets, quand: now };
  await kv.hset(CLE_PROPOSITIONS, p.id, JSON.stringify(p));
  return p;
}

export async function choisirSujet(kv: KV, propositionId: string, index: 0 | 1 | 2): Promise<Proposition> {
  const p = await lireProposition(kv, propositionId);
  if (!p) throw new Refus('proposition inconnue', 404);
  if (![0, 1, 2].includes(index)) throw new Refus('choix invalide');
  if (p.choix !== undefined) return p;
  p.choix = index;
  await kv.hset(CLE_PROPOSITIONS, p.id, JSON.stringify(p));
  return p;
}

export async function lirePost(kv: KV, id: string): Promise<Post | null> {
  const tout = await kv.hgetall(CLE_POSTS);
  const v = Object.hasOwn(tout, id) ? tout[id] : undefined; // « constructor » ou « __proto__ » ne sont pas des ids
  return v ? JSON.parse(v) : null;
}
export const ecrirePost = (kv: KV, p: Post) => kv.hset(CLE_POSTS, p.id, JSON.stringify(p));

/** Les refus d'un brouillon (422), sans rien écrire : à passer avant tout envoi. */
export function verifierBrouillon(b: { sujet: string; texte: string; hashtags: string[] }, memoire: MemoireL): void {
  const interdits = projetsInterdits(memoire, `${b.sujet} ${b.texte} ${b.hashtags.join(' ')}`, CATALOGUE_PROJETS);
  if (interdits.length) throw new Refus(`projet non autorisé dans le post : ${interdits.join(', ')}`, 422);
  if (b.hashtags.length < 3 || b.hashtags.length > 5) throw new Refus('il faut entre 3 et 5 hashtags', 422);
  if (b.texte.length > 3000) throw new Refus('texte trop long (3 000 caractères au plus)', 422);
}

export async function deposerBrouillon(
  kv: KV, b: { sujet: string; texte: string; hashtags: string[]; propositionId?: string; index?: number; visuel?: Visuel },
  memoire: MemoireL, now = Date.now(),
): Promise<{ post: Post; accordId: string }> {
  verifierBrouillon(b, memoire);
  const id = nouvelId();
  const resume = b.texte.length > 450 ? b.texte.slice(0, 450) + '…' : b.texte;
  const { accord } = await demanderAccord(kv, { agent: 'L', action: 'publier un post LinkedIn', resume, cle: 'post:' + id }, now);
  const post: Post = {
    id, sujet: b.sujet, texte: b.texte, hashtags: b.hashtags, statut: 'en accord', accordId: accord.id, quand: now,
    ...(b.propositionId !== undefined ? { propositionId: b.propositionId } : {}),
    ...(b.index !== undefined ? { index: b.index } : {}),
    ...(b.visuel ? { visuel: b.visuel } : {}),
  };
  await ecrirePost(kv, post);
  return { post, accordId: accord.id };
}

export async function apresDecision(kv: KV, accordId: string): Promise<{ post: Post; aEnvoyer: 'pret' | 'abandon' | 'revision' | null }> {
  const accord = await lireAccord(kv, accordId);
  if (!accord) throw new Refus('accord inconnu', 404);
  const postId = accord.cle?.startsWith('post:') ? accord.cle.slice(5) : undefined;
  const post = postId ? await lirePost(kv, postId) : null;
  if (!post) throw new Refus('post introuvable pour cet accord', 404);
  if (post.statut !== 'en accord' || accord.statut === 'en attente') return { post, aEnvoyer: null };
  if (accord.statut === 'accepte') { post.statut = 'pret'; await ecrirePost(kv, post); return { post, aEnvoyer: 'pret' }; }
  if (accord.statut === 'refuse') { post.statut = 'abandonne'; await ecrirePost(kv, post); return { post, aEnvoyer: 'abandon' }; }
  post.statut = 'brouillon';
  await ecrirePost(kv, post);
  return { post, aEnvoyer: 'revision' };
}

export async function marquerPublie(kv: KV, postId: string, now = Date.now()): Promise<Post> {
  const post = await lirePost(kv, postId);
  if (!post) throw new Refus('post inconnu', 404);
  if (post.statut === 'publie') return post;
  if (post.statut !== 'pret') throw new Refus(`ce post n'est pas prêt à publier (${post.statut})`, 409);
  post.statut = 'publie';
  await ecrirePost(kv, post);
  await noterPublie(kv, { id: post.id, sujet: post.sujet, quand: now });
  return post;
}

export const textePret = (p: Post): string =>
  `▼ LE POST, tel qu'il paraîtra sur LinkedIn ▼\n\n${p.texte}\n\n${p.hashtags.join(' ')}\n\n▲ fin du post ▲\n\n`
  + "Touche « Publier sur LinkedIn » quand tu veux qu'il parte (idéal : vers 8 h 30). Si tu l'as publié toi-même, touche « Déjà publié ».";

/** Les numéros des sujets déjà rédigés de la proposition. Un sujet compte si son post vit encore, ou s'il a été
 *  refusé par ❌ (on ne le repropose pas) ; un post abandonné par une révision ou un envoi raté ne compte pas. */
export async function sujetsRediges(kv: KV, proposition: Proposition | null, posts: Post[]): Promise<number[]> {
  const rediges: number[] = [];
  for (const p of posts) {
    if (!proposition || p.propositionId !== proposition.id || p.index === undefined) continue;
    const refuse = p.statut === 'abandonne' && p.accordId ? (await lireAccord(kv, p.accordId))?.statut === 'refuse' : false;
    if ((p.statut !== 'abandonne' || refuse) && !rediges.includes(p.index)) rediges.push(p.index);
  }
  return rediges.sort((a, b) => a - b);
}
