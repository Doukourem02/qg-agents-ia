import { getKV } from '@/server/kv';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerTelegram } from '@/server/telegram';
import { rendreRapport } from '@/server/missions/file';

// La routine « QG · missions » rend ici le résultat d'une mission : POST { id, statut, texte, raison? }, preuve d'agent.
// Vérifié par le serveur (champs autorisés, aucun secret, aucune injonction) ; le résultat part sur Telegram.
export async function POST(req: Request) {
  try {
    verifierAgent(req);
    const r = await rendreRapport(getKV().kv, await lireJson(req), { envoyer: (texte) => envoyerTelegram(texte) });
    return Response.json(r);
  } catch (e) {
    return reponseErreur(e);
  }
}
