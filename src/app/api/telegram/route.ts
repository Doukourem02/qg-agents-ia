import { getKV } from '@/server/kv';
import { CLES_ACCORDS } from '@/server/accords';
import { accuserClic, envoyerFichier, envoyerImage, envoyerTelegram, lireMiseAJour, retirerBoutons, secretValide, telechargerFichier } from '@/server/telegram';
import { creerPost, televerser } from '@/server/linkedin/api';
import { lireConnexion } from '@/server/linkedin/connexion';
import { publierPost } from '@/server/l/publication';
import { rendreVisuel } from '@/server/l/visuels';
import { traiterTelegram, type DepsTelegram } from '@/server/l/webhook';
import { Refus } from '@/server/qg';
import { ErreurGmail, ouvrirBoite } from '@/server/clara/imap';
import { clientKuroro } from '@/server/kuroro';
import { depsImmediat } from '@/server/missions/reel';

// Les boutons de Clara peuvent mettre beaucoup de mails à la corbeille : elle s'arrête d'elle-même avant 240 s.
export const maxDuration = 300;

const deps: DepsTelegram = {
  envoyer: envoyerTelegram,
  // Kuroro sur Telegram : Claude si la clé existe, sinon le Mac par le relais (src/server/kuroro-telegram.ts)
  client: clientKuroro(), envoyerImage, envoyerFichier, rendre: rendreVisuel, telecharger: telechargerFichier,
  ouvrirGmail: async () => {
    const adresse = process.env.GMAIL_ADRESSE;
    const motDePasse = process.env.GMAIL_MOT_DE_PASSE_APPLI;
    if (!adresse || !motDePasse) throw new Refus('Gmail non configuré', 503);
    try {
      return await ouvrirBoite({ adresse, motDePasse });
    } catch (e) {
      if (e instanceof ErreurGmail) throw e;
      throw new ErreurGmail('Gmail injoignable');
    }
  },
  // la clé d'écriture de Paul n'est lue qu'au clic, jamais journalisée
  ecriturePaul: () => ({ fetch, jeton: process.env.GITHUB_ECRITURE_PERSO }),
  // la clé d'écriture Sanity de Ye aussi
  publicationYe: () => ({ fetch, jeton: process.env.SANITY_ECRITURE_PORTFOLIO }),
  // et, pour « Ajouter » une fiche, la clé de lecture GitHub (les images du dépôt)
  creationYe: () => ({ fetch, jeton: process.env.SANITY_ECRITURE_PORTFOLIO, github: process.env.GITHUB_LECTURE_PERSO }),
  // « vérifie mes sites », « refais le tour de sécurité », « mets Ye en pause » : faits par le code (le résultat après la réponse)
  immediat: depsImmediat(),
  publier: (kv, id, forcer) => publierPost(kv, id, {
    connexion: () => lireConnexion(kv, process.env.LINKEDIN_CLIENT_SECRET),
    rendre: rendreVisuel, televerser, creerPost,
  }, forcer),
};

/**
 * Les messages qui portent une rangée par proposition (Isaac, Paul, Ye) ou par problème (« Ignorer », « Reprendre ») :
 * un clic ne retire pas les autres rangées ;
 * un second clic sur la même répond « déjà noté ».
 */
const GARDER_RANGEES = ['isc:', 'pau:', 'ye:', 'ign:', 'rep:', 'fei:'];

// Le webhook Telegram : mes réponses aux demandes d'accord, mes choix de sujets, ce que je dépose dans la boîte de L,
// « ignore » et la pause des alertes, et ma conversation avec Kuroro. N'écoute que TELEGRAM_CHAT_ID ; aucun texte de
// message n'est journalisé (seulement la nature d'une erreur).
// La logique est dans `traiterTelegram` (testée sans réseau) ; ici, seulement la porte et l'anti-doublon.

export async function POST(req: Request) {
  if (!secretValide(req.headers.get('x-telegram-bot-api-secret-token'))) return new Response('interdit', { status: 401 });
  const u = lireMiseAJour(await req.json().catch(() => null));
  const moi = process.env.TELEGRAM_CHAT_ID;
  if (!u || !moi || u.de !== moi) return new Response('ok'); // le bot n'écoute que moi
  const { kv } = getKV();
  if (!(await kv.setnx(CLES_ACCORDS.message(u.id), '1', 7 * 24 * 3600))) return new Response('ok'); // déjà traité

  // le clic est accusé avant le travail : une longue mise à la corbeille ne laisse pas le bouton tourner
  if (u.type === 'bouton') await accuserClic(u.id.slice(1));
  try {
    const info = await traiterTelegram(kv, u, deps);
    if (u.type === 'bouton' && !GARDER_RANGEES.some(p => u.donnee.startsWith(p))) await retirerBoutons(u.chat, u.message);
    if (info) await envoyerTelegram(info);
  } catch (e) { console.error('telegram : traitement impossible', e instanceof Refus ? e.message : (e as Error)?.name); }
  return new Response('ok');
}
