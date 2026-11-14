import { connection } from 'next/server';
import { getKV, type KV } from '@/server/kv';
import { sauterSiEnPause } from '@/server/pause-agents';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerTelegram } from '@/server/telegram';
import { traiterActionFeu } from '@/server/feu/actions';
import type { DepsFeu } from '@/server/feu/passage';

// Les entrées de Feu (exigent la preuve d'agent) : `marche` (QStash toutes les 15 min, GET ou POST sans corps), `compte`
// (POST du relais du Mac : montants et ordres lus en lecture seule, jamais la clé), `a-analyser` (GET) et `rapport` (POST)
// de la routine « Feu · marché ».
// Feu ne passe jamais un ordre : le marché est lu sur le miroir public de Binance, sans clé.

// 6 lectures de bougies en parallèle (12 s au plus chacune), plus l'envoi Telegram.
export const maxDuration = 60;

type Ctx = { params: Promise<{ action: string }> };
// l'envoi brut : le passage le fait passer par la pause générale (envoyerAlerte, src/server/silence.ts)
const deps = (): DepsFeu => ({ fetch, envoyer: envoyerTelegram });
/** Les entrées qui reçoivent un corps JSON (QStash peut appeler `marche` en POST sans corps). */
const AVEC_CORPS = new Set(['compte', 'rapport']);

async function traiter(kv: KV, action: string, corps: unknown) {
  // mis en pause par le patron : le passage prévu est sauté, rien n'est fait (src/server/pause-agents.ts)
  return (await sauterSiEnPause(kv, 'feu', action)) ?? traiterActionFeu(kv, action, corps, deps());
}

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  try {
    verifierAgent(req);
    const { action } = await params;
    return Response.json(await traiter(getKV().kv, action, undefined), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    verifierAgent(req);
    const { action } = await params;
    const corps = AVEC_CORPS.has(action) ? await lireJson(req) : undefined;
    return Response.json(await traiter(getKV().kv, action, corps));
  } catch (e) {
    return reponseErreur(e);
  }
}

