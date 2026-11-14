import 'server-only';
import type { KV } from '../memoire';
import { vueL } from '../l/vue';
import { vueLight } from '../light/vue';
import { vueClara } from '../clara/vue';
import { vueMafe } from '../mafe/vue';
import { vueLea } from '../lea/vue';
import { vuePaul } from '../paul/vue';
import { vueYe } from '../ye/vue';
import { vueFeu } from '../feu/vue';

// Le contexte d'une mission : ce que la page montre du bureau de l'agent (les mêmes vues, lecture seule, sans jeton ni
// mot de passe). La routine « QG · missions » s'en sert au lieu de relancer un passage de l'agent (qui compterait dans
// son calendrier).
export async function bureauDe(kv: KV, agent: string): Promise<unknown> {
  switch (agent) {
    case 'L': return vueL(kv);
    case 'light': return vueLight(kv);
    case 'clara': return vueClara(kv);
    case 'mafe': return vueMafe(kv);
    case 'lea': return vueLea(kv);
    case 'paul': return vuePaul(kv);
    case 'ye': return vueYe(kv);
    case 'feu': return vueFeu(kv);
    default: return null;
  }
}
