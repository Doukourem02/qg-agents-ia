import 'server-only';
import { statutLinkedIn } from '../linkedin/connexion';
import { envoyerTelegram } from '../telegram';
import { getKV } from '../kv';
import { envoyerAlerte } from '../silence';
import type { DepsZoro } from './tour';

// Les vraies dépendances du tour (réseau, Telegram, clé GitHub, connexion LinkedIn), partagées par les routes.

export const depsZoro = (): DepsZoro => ({
  fetch,
  // passe par la pause générale (gardé pour la fin de la pause, src/server/silence.ts)
  envoyer: (texte) => envoyerAlerte(getKV().kv, envoyerTelegram, texte),
  jeton: process.env.GITHUB_LECTURE_PERSO || undefined, // absente → partie GitHub « non lue », jamais un plantage
  // Jamais connecté → null (« non connecté », page seulement) ; connexion expirée → son échéance passée (« expirée »).
  linkedin: async (kv) => {
    const s = await statutLinkedIn(kv);
    return s.expire === undefined ? null : { expire: s.expire };
  },
});
