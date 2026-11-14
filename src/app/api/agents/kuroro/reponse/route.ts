import { getKV } from '@/server/kv';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { ecrireReponse } from '@/server/kuroro-relais';
import { livrerTelegram } from '@/server/kuroro-telegram';
import { envoyerTelegram } from '@/server/telegram';

// Le Mac renvoie la réponse du modèle local : { id, texte, mission? } ou { id, echec: true }. Validée ici ; une mission
// valide est déposée par le serveur, qui écrit lui-même la confirmation. Exige la preuve des agents.
// Une question posée sur Telegram (src/server/kuroro-telegram.ts) : la réponse, ou « je n'ai pas su », y part aussitôt.
export async function POST(req: Request) {
  try {
    verifierAgent(req);
    const corps = await lireJson(req);
    try {
      return Response.json(await ecrireReponse(getKV().kv, corps));
    } finally {
      if (typeof corps.id === 'string') {
        await livrerTelegram(getKV().kv, corps.id, { envoyer: (texte) => envoyerTelegram(texte) })
          .catch(() => console.error('kuroro : réponse Telegram pas partie'));
      }
    }
  } catch (e) {
    return reponseErreur(e);
  }
}
