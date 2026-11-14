import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { sauterSiEnPause } from '@/server/pause-agents';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerTelegram } from '@/server/telegram';
import { traiterActionLea, type DepsLea } from '@/server/lea/relecture';
import { envoyerAlerte } from '@/server/silence';

// Les entrées de la routine de Léa : GET a-relire, POST rapport. Exige la preuve d'agent.

// La préparation du lot a sa propre échéance (240 s) : la fonction peut durer jusqu'à 300 s sur Vercel.
export const maxDuration = 300;

type Ctx = { params: Promise<{ action: string }> };
// ses alertes passent par la pause générale (gardées pour la fin de la pause, src/server/silence.ts)
const deps = (): DepsLea => ({ fetch, envoyer: (texte) => envoyerAlerte(getKV().kv, envoyerTelegram, texte), jeton: process.env.GITHUB_LECTURE_PERSO });

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  try {
    verifierAgent(req);
    const { action } = await params;
    // mis en pause par le patron : le passage prévu est sauté, rien n'est fait (src/server/pause-agents.ts)
    const pause = await sauterSiEnPause(getKV().kv, 'lea', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionLea(getKV().kv, action, undefined, deps());
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
    const pause = await sauterSiEnPause(getKV().kv, 'lea', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionLea(getKV().kv, action, await lireJson(req), deps());
    return Response.json(r);
  } catch (e) {
    return reponseErreur(e);
  }
}
