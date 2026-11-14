import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { sauterSiEnPause } from '@/server/pause-agents';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerFichier, envoyerImage, envoyerTelegram } from '@/server/telegram';
import { traiterAction, type Deps } from '@/server/l/api';
import { rendreVisuel } from '@/server/l/visuels';

// Les entrées de la routine de L : GET contexte, POST propositions | brouillon | apercu | traite | question | memoire | bilan.
// « apercu » renvoie l'image PNG elle-même. Exige la preuve d'agent.

type Ctx = { params: Promise<{ action: string }> };
const deps: Deps = { envoyer: envoyerTelegram, envoyerImage, envoyerFichier, rendre: rendreVisuel };

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  try {
    verifierAgent(req);
    const { action } = await params;
    // mis en pause par le patron : le passage prévu est sauté, rien n'est fait (src/server/pause-agents.ts)
    const pause = await sauterSiEnPause(getKV().kv, 'L', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterAction(getKV().kv, action, {}, deps);
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
    const pause = await sauterSiEnPause(getKV().kv, 'L', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterAction(getKV().kv, action, await lireJson(req), deps);
    if (action === 'apercu') {
      const { image } = r as { image: Uint8Array<ArrayBuffer> };
      return new Response(image, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
    }
    return Response.json(r);
  } catch (e) {
    return reponseErreur(e);
  }
}
