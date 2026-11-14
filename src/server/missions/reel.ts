import 'server-only';
import { after } from 'next/server';
import { getKV } from '../kv';
import { envoyerTelegram } from '../telegram';
import { envoyerAlerte } from '../silence';
import { depsZoro } from '../zoro/reel';
import type { DepsImmediat } from './immediat';

// Les vraies dépendances des actions immédiates, partagées par le webhook Telegram, la barre de mission et /api/missions :
// le résultat part sur Telegram après la réponse (`after`, dans la durée de la route : 300 s).
export const depsImmediat = (): DepsImmediat => ({
  envoyer: (texte) => envoyerTelegram(texte),
  // les alertes de Luffy passent par la pause générale, comme à son passage de 5 min
  luffy: () => ({ fetch, envoyer: (texte, boutons) => envoyerAlerte(getKV().kv, envoyerTelegram, texte, boutons) }),
  zoro: depsZoro,
  plusTard: (travail) => after(travail),
});
