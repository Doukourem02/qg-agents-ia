import { getKV } from '@/server/kv';
import { ecrireEtat } from '@/server/qg';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';

// Un agent (routine, relais Mac, app) écrit ici son état. Exige la clé QG_CLE_AGENTS.
export async function POST(req: Request) {
  try {
    verifierAgent(req);
    const { kv } = getKV();
    const r = await ecrireEtat(kv, await lireJson(req));
    return Response.json(r, { status: r.doublon ? 200 : 201 });
  } catch (e) {
    return reponseErreur(e);
  }
}
