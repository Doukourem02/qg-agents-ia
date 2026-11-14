import type { KV } from '../memoire';
import { statutLinkedIn } from '../linkedin/connexion';
import { dernierBilan, type Bilan } from './bilan';
import { CLE_POSTS, CLE_PROPOSITIONS, sujetsRediges, type Post, type Proposition } from './posts';
import { statsATraiter } from './stats';

// Ce que la page affiche pour L : un seul document, sans jamais de jeton.

export type VueL = {
  linkedin: { connecte: boolean; nom?: string; expire?: number };
  proposition: { id: string; semaine: string; sujets: { titre: string; angle: string; format: string }[]; choix?: number; rediges: number[] } | null;
  posts: { id: string; sujet: string; texte: string; hashtags: string[]; statut: Post['statut']; quand: number; url?: string; aVisuel: boolean }[];
  bilan: Bilan | null;
  statsEnAttente: number;
};

const MAX_POSTS = 12;

export async function vueL(kv: KV, now = Date.now()): Promise<VueL> {
  const propositions = Object.values(await kv.hgetall(CLE_PROPOSITIONS)).map(v => JSON.parse(v) as Proposition);
  const courante = propositions.sort((a, b) => b.quand - a.quand)[0] ?? null;
  const posts = Object.values(await kv.hgetall(CLE_POSTS)).map(v => JSON.parse(v) as Post);
  const st = await statutLinkedIn(kv, now).catch(() => ({ connecte: false } as { connecte: boolean; nom?: string; expire?: number }));
  return {
    linkedin: { connecte: st.connecte, ...(st.nom ? { nom: st.nom } : {}), ...(st.expire ? { expire: st.expire } : {}) },
    proposition: courante && {
      id: courante.id, semaine: courante.semaine,
      sujets: courante.sujets.map(s => ({ titre: s.titre, angle: s.angle, format: s.format })),
      ...(courante.choix !== undefined ? { choix: courante.choix } : {}),
      rediges: await sujetsRediges(kv, courante, posts),
    },
    posts: posts.filter(p => p.statut !== 'abandonne').sort((a, b) => b.quand - a.quand).slice(0, MAX_POSTS).map(p => ({
      id: p.id, sujet: p.sujet, texte: p.texte, hashtags: p.hashtags, statut: p.statut, quand: p.quand,
      ...(p.linkedin?.url ? { url: p.linkedin.url } : {}), aVisuel: p.visuel !== undefined,
    })),
    bilan: await dernierBilan(kv),
    statsEnAttente: (await statsATraiter(kv)).length,
  };
}
