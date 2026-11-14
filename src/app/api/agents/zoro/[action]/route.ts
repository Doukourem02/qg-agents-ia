import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { sauterSiEnPause } from '@/server/pause-agents';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { depsZoro } from '@/server/zoro/reel';
import { traiterActionZoro } from '@/server/zoro/tour';

// L'entrée de Zoro (exige la preuve d'agent) : tour (QStash le mardi 09:00 UTC), verifier, mac (POST du relais), a-envoyer (GET).

// Échéance commune du tour : 240 s, plus l'envoi Telegram.
export const maxDuration = 300;

type Ctx = { params: Promise<{ action: string }> };

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  try {
    verifierAgent(req);
    const { action } = await params;
    // mis en pause par le patron : le passage prévu est sauté, rien n'est fait (src/server/pause-agents.ts)
    const pause = await sauterSiEnPause(getKV().kv, 'zoro', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionZoro(getKV().kv, action, undefined, depsZoro());
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
    const pause = await sauterSiEnPause(getKV().kv, 'zoro', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    // Seul le rapport du Mac a un corps ; QStash peut appeler `tour` en POST sans corps.
    const corps = action === 'mac' ? await lireJson(req) : undefined;
    const r = await traiterActionZoro(getKV().kv, action, corps, depsZoro());
    return Response.json(r);
  } catch (e) {
    return reponseErreur(e);
  }
}
