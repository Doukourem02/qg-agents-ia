import type { KV } from './memoire';
import { Refus } from './qg';

// « Mes règles » : les règles que le patron écrit dans le Cerveau. Les agents qui écrivent (L, Light, Clara, Mafe)
// les lisent au début de chaque passage (scripts/regles.mjs → GET /api/agents/regles).
// Hash `qg:regles` : id → { texte, quand }. Rien n'est écrit au journal.

export type RegleQG = { id: string; texte: string; quand: number };

export const CLE_REGLES = 'qg:regles';
export const MAX_TEXTE_REGLE = 200;
export const MAX_REGLES_QG = 30;
export const ID_REGLE = /^[a-z0-9]{8,32}$/;

function texteValide(brut: unknown): string {
  const t = typeof brut === 'string' ? brut.trim().replace(/\s+/g, ' ') : '';
  if (!t) throw new Refus('« texte » manquant');
  if (t.length > MAX_TEXTE_REGLE) throw new Refus(`« texte » trop long (${MAX_TEXTE_REGLE} caractères au plus)`);
  return t;
}

function idValide(brut: unknown): string {
  if (typeof brut !== 'string' || !ID_REGLE.test(brut)) throw new Refus('« id » invalide');
  return brut;
}

/** Les règles, de la plus ancienne à la plus récente. */
export async function lireRegles(kv: KV): Promise<RegleQG[]> {
  const h = await kv.hgetall(CLE_REGLES);
  return Object.entries(h).flatMap(([id, v]) => {
    try {
      const r = JSON.parse(v) as { texte?: unknown; quand?: unknown };
      return typeof r.texte === 'string' && typeof r.quand === 'number' ? [{ id, texte: r.texte, quand: r.quand }] : [];
    } catch { return []; }
  }).sort((a, b) => a.quand - b.quand || a.id.localeCompare(b.id));
}

export const textesRegles = async (kv: KV) => (await lireRegles(kv)).map(r => r.texte);

const nouvelId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

export async function ajouterRegleQG(kv: KV, brut: unknown, now = Date.now()): Promise<RegleQG[]> {
  const texte = texteValide(brut);
  const regles = await lireRegles(kv);
  if (regles.some(r => r.texte === texte)) return regles;
  if (regles.length >= MAX_REGLES_QG) throw new Refus(`${MAX_REGLES_QG} règles au plus`, 409);
  // toujours après la dernière, même dans la même milliseconde : l'ordre d'ajout est gardé
  const quand = Math.max(now, (regles.at(-1)?.quand ?? 0) + 1);
  await kv.hset(CLE_REGLES, nouvelId(), JSON.stringify({ texte, quand }));
  return lireRegles(kv);
}

export async function modifierRegleQG(kv: KV, brutId: unknown, brut: unknown): Promise<RegleQG[]> {
  const id = idValide(brutId);
  const texte = texteValide(brut);
  const regle = (await lireRegles(kv)).find(r => r.id === id);
  if (!regle) throw new Refus('règle inconnue', 404);
  await kv.hset(CLE_REGLES, id, JSON.stringify({ texte, quand: regle.quand }));
  return lireRegles(kv);
}

export async function retirerRegleQG(kv: KV, brutId: unknown): Promise<RegleQG[]> {
  const id = idValide(brutId);
  if (!(await lireRegles(kv)).some(r => r.id === id)) throw new Refus('règle inconnue', 404);
  await kv.hdel(CLE_REGLES, id);
  return lireRegles(kv);
}
