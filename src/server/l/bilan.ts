import type { KV } from '../memoire';
import { Refus } from '../qg';
import { semaineIso } from './posts';

// Le bilan de la semaine que L tire d'un export de statistiques : rangé tel quel, le plus récent s'affiche.

export type Bilan = {
  id: string; statsId: string; semaine: string; quand: number; resume: string;
  chiffres: { nom: string; valeur: string; evolution?: string }[];
  marche: string[]; lecteurs: string[]; ajustements: string[];
};

export const CLE_BILANS = 'l:bilans';

const nouvelId = () => Math.random().toString(36).slice(2, 8);

function listeCourte(v: unknown, nom: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) throw new Refus(`« ${nom} » doit être une liste de textes`);
  if (v.length > 5) throw new Refus(`« ${nom} » : 5 éléments au plus`);
  if (v.some(x => x.length > 200)) throw new Refus(`« ${nom} » : 200 caractères au plus par élément`);
  return v;
}

/** Valide le corps d'un bilan (400 si une limite est dépassée). */
export function validerBilan(v: unknown): Omit<Bilan, 'id' | 'quand' | 'semaine'> {
  const b = (v ?? {}) as Record<string, unknown>;
  if (typeof b.statsId !== 'string' || !b.statsId.trim()) throw new Refus('« statsId » manquant');
  if (typeof b.resume !== 'string' || !b.resume.trim()) throw new Refus('« resume » manquant');
  if (b.resume.length > 600) throw new Refus('« resume » trop long (600 caractères au plus)');
  const brut = b.chiffres ?? [];
  if (!Array.isArray(brut)) throw new Refus('« chiffres » doit être une liste');
  if (brut.length > 6) throw new Refus('« chiffres » : 6 éléments au plus');
  const chiffres = brut.map((c, i) => {
    const x = (c ?? {}) as Record<string, unknown>;
    if (typeof x.nom !== 'string' || !x.nom.trim() || typeof x.valeur !== 'string' || !x.valeur.trim())
      throw new Refus(`« chiffres » ${i + 1} : « nom » et « valeur » attendus`);
    if (x.evolution !== undefined && typeof x.evolution !== 'string') throw new Refus(`« chiffres » ${i + 1} : « evolution » doit être un texte`);
    if (x.nom.length > 100 || x.valeur.length > 100 || (x.evolution?.length ?? 0) > 100)
      throw new Refus(`« chiffres » ${i + 1} : 100 caractères au plus par champ`);
    return { nom: x.nom, valeur: x.valeur, ...(x.evolution ? { evolution: x.evolution } : {}) };
  });
  return {
    statsId: b.statsId, resume: b.resume, chiffres,
    marche: listeCourte(b.marche, 'marche'), lecteurs: listeCourte(b.lecteurs, 'lecteurs'), ajustements: listeCourte(b.ajustements, 'ajustements'),
  };
}

export async function enregistrerBilan(kv: KV, b: Omit<Bilan, 'id' | 'quand' | 'semaine'>, now = Date.now()): Promise<Bilan> {
  const bilan: Bilan = { ...b, id: nouvelId(), semaine: semaineIso(now), quand: now };
  await kv.hset(CLE_BILANS, bilan.id, JSON.stringify(bilan));
  return bilan;
}

export async function dernierBilan(kv: KV): Promise<Bilan | null> {
  const tous = Object.values(await kv.hgetall(CLE_BILANS)).map(v => JSON.parse(v) as Bilan);
  return tous.sort((a, b) => b.quand - a.quand)[0] ?? null;
}
