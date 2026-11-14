import { getKV } from '@/server/kv';
import { prendreMissions } from '@/server/qg';
import { reponseErreur, verifierAgent } from '@/server/auth';

// Un agent récupère ici ses missions en attente : GET /api/agents/missions?agent=L. Exige la clé QG_CLE_AGENTS.
export async function GET(req: Request) {
  try {
    verifierAgent(req);
    const agent = new URL(req.url).searchParams.get('agent');
    return Response.json({ missions: await prendreMissions(getKV().kv, agent) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
