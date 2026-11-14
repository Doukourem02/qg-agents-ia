import type { KV } from '../memoire';

// La boîte de L : liens, commentaires, notes et fichiers que je dépose via Telegram, traités chaque heure.

export type ElementBoite = {
  id: string; type: 'lien' | 'commentaire' | 'note' | 'fichier'; contenu: string; quand: number;
  traite?: { quand: number; resume: string };
};

export const CLE_BOITE = 'l:boite';

/** Dépose un élément ; false si cet id a déjà été vu (Telegram peut renvoyer une mise à jour). */
export async function deposer(kv: KV, e: Omit<ElementBoite, 'quand'>, now = Date.now()): Promise<boolean> {
  if (!(await kv.setnx(`l:recu:${e.id}`, '1', 30 * 24 * 3600))) return false;
  const el: ElementBoite = { ...e, quand: now };
  await kv.hset(CLE_BOITE, e.id, JSON.stringify(el));
  return true;
}

async function tous(kv: KV): Promise<ElementBoite[]> {
  return Object.values(await kv.hgetall(CLE_BOITE)).map(v => JSON.parse(v) as ElementBoite);
}

/** Les éléments pas encore traités, du plus ancien au plus récent. */
export async function aTraiter(kv: KV, max = 20): Promise<ElementBoite[]> {
  return (await tous(kv)).filter(e => !e.traite).sort((a, b) => a.quand - b.quand).slice(0, max);
}

export async function marquerTraite(kv: KV, id: string, resume: string, now = Date.now()): Promise<void> {
  const e = (await tous(kv)).find(x => x.id === id);
  if (!e) return;
  e.traite = { quand: now, resume };
  await kv.hset(CLE_BOITE, id, JSON.stringify(e));
}
