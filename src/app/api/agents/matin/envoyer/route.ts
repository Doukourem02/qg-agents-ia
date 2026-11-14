import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerTelegram } from '@/server/telegram';
import { envoyerCompteRendu, type DepsMatin } from '@/server/matin/envoi';

// Le compte rendu du matin de Kuroro (QStash, chaque jour 08:15 UTC) : POST ou GET, exige la preuve d'agent.
// Au plus un message par jour : rejouer la route le même jour ne renvoie rien. Telegram en échec → 503, QStash réessaie.

export const maxDuration = 60;

const deps = (): DepsMatin => ({ envoyer: (texte) => envoyerTelegram(texte) });

async function envoyer(req: Request) {
  await connection();
  try {
    verifierAgent(req);
    const r = await envoyerCompteRendu(getKV().kv, deps());
    return Response.json(r, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

export const GET = envoyer;
export const POST = envoyer;
