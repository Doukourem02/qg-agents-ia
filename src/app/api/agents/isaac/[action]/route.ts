import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { sauterSiEnPause } from '@/server/pause-agents';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerTelegram } from '@/server/telegram';
import { traiterActionIsaac, type DepsIsaac } from '@/server/isaac/api';

// Les entrées d'Isaac (relais du Mac) : GET a-faire, POST rapport | proposer | fait | faits | mission. Exige la preuve d'agent.

type Ctx = { params: Promise<{ action: string }> };
const deps = (): DepsIsaac => ({
  envoyer: (texte, boutons) => envoyerTelegram(texte, boutons),
});

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  try {
    verifierAgent(req);
    const { action } = await params;
    // mis en pause par le patron : le passage prévu est sauté, rien n'est fait (src/server/pause-agents.ts)
    const pause = await sauterSiEnPause(getKV().kv, 'isaac', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionIsaac(getKV().kv, action, {}, deps());
    return Response.json(r, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    verifierAgent(req);
    const { action } = await params;
    // mis en pause par le patron : le passage prévu est sauté, rien n'est fait (src/server/pause-agents.ts)
    const pause = await sauterSiEnPause(getKV().kv, 'isaac', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionIsaac(getKV().kv, action, await lireJson(req), deps());
    return Response.json(r);
  } catch (e) {
    return reponseErreur(e);
  }
}
