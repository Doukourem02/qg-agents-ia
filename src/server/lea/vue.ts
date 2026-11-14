import type { KV } from '../memoire';
import { duree } from '../luffy/vigie';
import { dernierPassage, lireConstats, lireRelectures, lireTentative } from './relecture';
import { absente, phraseCerveau, type VueLea } from './etiquette';

export type { VueLea } from './etiquette';
export { absente, gravesOuverts, noteTentative, ABSENTE_APRES } from './etiquette';

// Ce que la page affiche pour Léa : le dernier passage complet, son dernier essai, les constats gardés et les relectures récentes.
// Page privée (vrais noms de projets) ; les constats ne contiennent jamais un secret, seulement son genre.

export async function vueLea(kv: KV, now: number = Date.now()): Promise<VueLea> {
  const [passage, constats, relectures, tentative] = await Promise.all([dernierPassage(kv), lireConstats(kv), lireRelectures(kv), lireTentative(kv)]);
  return { passage, absente: absente(passage, now), constats, relectures, tentative };
}

/** La phrase de Léa dans le Cerveau, calculée sur ce qu'elle a vraiment relu. */
export function phraseLea(v: VueLea | null, now: number = Date.now()): string {
  if (!v) return 'Pas encore de relecture.';
  return phraseCerveau(v, v.absente && v.passage !== null ? duree(now - v.passage) : '', now);
}
