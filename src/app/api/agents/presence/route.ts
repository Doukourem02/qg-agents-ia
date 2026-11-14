import { getKV } from '@/server/kv';
import { ecrirePresence } from '@/server/presence';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';

// Claude Code (Stalker) signale ici qu'il travaille avec moi sur le Mac, ou qu'il a fini. Exige la preuve des agents.
export async function POST(req: Request) {
  try {
    verifierAgent(req);
    const { kv } = getKV();
    return Response.json(await ecrirePresence(kv, await lireJson(req)));
  } catch (e) {
    return reponseErreur(e);
  }
}
