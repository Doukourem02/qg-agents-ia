import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { sauterSiEnPause } from '@/server/pause-agents';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerTelegram } from '@/server/telegram';
import { traiterActionYe } from '@/server/ye/rapport';
import type { DepsYe } from '@/server/ye/lot';

// Les entrées de la routine de Ye : GET a-comparer, POST rapport. Exige la preuve d'agent.
// Lecture seulement (GitHub, et Sanity pour voir les brouillons) : rien n'est publié d'ici, seulement après mon « Valider ».

// La préparation du lot a sa propre échéance (240 s) : la fonction peut durer jusqu'à 300 s sur Vercel.
export const maxDuration = 300;

type Ctx = { params: Promise<{ action: string }> };
const deps = (): DepsYe => ({ fetch, envoyer: envoyerTelegram, jeton: process.env.GITHUB_LECTURE_PERSO, sanity: process.env.SANITY_ECRITURE_PORTFOLIO });

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  try {
    verifierAgent(req);
    const { action } = await params;
    // mis en pause par le patron : le passage prévu est sauté, rien n'est fait (src/server/pause-agents.ts)
    const pause = await sauterSiEnPause(getKV().kv, 'ye', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionYe(getKV().kv, action, undefined, deps());
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
    const pause = await sauterSiEnPause(getKV().kv, 'ye', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionYe(getKV().kv, action, await lireJson(req), deps());
    return Response.json(r);
  } catch (e) {
    return reponseErreur(e);
  }
}
