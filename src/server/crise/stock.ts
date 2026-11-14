import type { KV } from '../memoire';
import type { Reunion } from '@/data/crise';

// Où les réunions de crise sont rangées dans Upstash (lu par la page, écrit par le suivi seulement).

export const CLES_CRISE = {
  /** Table id → réunion (JSON), en cours ou finie : l'historique du Calendrier. */
  reunions: 'crise:reunions',
  verrou: 'crise:verrou',
  annonce: (id: string, quoi: string) => `crise:annonce:${id}:${quoi}`,
} as const;

function lire<T>(brut: string | undefined): T | undefined {
  if (!brut) return undefined;
  try { return JSON.parse(brut) as T; } catch { return undefined; }
}

/** Toutes les réunions gardées, la plus récente d'abord. */
export async function lireReunions(kv: KV): Promise<Reunion[]> {
  return Object.values(await kv.hgetall(CLES_CRISE.reunions)).flatMap(v => lire<Reunion>(v) ?? []).sort((a, b) => b.debut - a.debut);
}
export const ecrire = (kv: KV, r: Reunion) => kv.hset(CLES_CRISE.reunions, r.id, JSON.stringify(r));

