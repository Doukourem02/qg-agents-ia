import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { sauterSiEnPause } from '@/server/pause-agents';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerTelegram } from '@/server/telegram';
import { traiterActionLight, type DepsLight } from '@/server/light/api';

// Les entrées de la routine de Light : GET releve, POST rapport | relance. Exige la preuve d'agent.

// Le relevé a sa propre échéance (200 s) : la fonction peut durer jusqu'à 300 s sur Vercel.
export const maxDuration = 300;

type Ctx = { params: Promise<{ action: string }> };
const deps = (): DepsLight => ({
  fetch,
  envoyer: envoyerTelegram,
  jetons: { perso: process.env.GITHUB_LECTURE_PERSO, pro: process.env.GITHUB_LECTURE_PRO },
});

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  try {
    verifierAgent(req);
    const { action } = await params;
    // mis en pause par le patron : le passage prévu est sauté, rien n'est fait (src/server/pause-agents.ts)
    const pause = await sauterSiEnPause(getKV().kv, 'light', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionLight(getKV().kv, action, {}, deps());
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
    const pause = await sauterSiEnPause(getKV().kv, 'light', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionLight(getKV().kv, action, await lireJson(req), deps());
    return Response.json(r);
  } catch (e) {
    return reponseErreur(e);
  }
}
