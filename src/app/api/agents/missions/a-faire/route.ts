import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerTelegram } from '@/server/telegram';
import { aFaire } from '@/server/missions/file';
import { bureauDe } from '@/server/missions/bureaux';

// La routine « QG · missions » (agents/Missions/CONSIGNES.md) prend ici les missions à faire : GET, preuve d'agent.
// { missions: [...] } ; aucune : { missions: [], rien } et la routine s'arrête tout de suite.
export async function GET(req: Request) {
  await connection();
  try {
    verifierAgent(req);
    const { kv } = getKV();
    const r = await aFaire(kv, { envoyer: (texte) => envoyerTelegram(texte), bureau: (agent) => bureauDe(kv, agent) });
    return Response.json(r, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
