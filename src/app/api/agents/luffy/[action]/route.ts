import { connection } from 'next/server';
import { getKV, type KV } from '@/server/kv';
import { reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerTelegram } from '@/server/telegram';
import { traiterActionLuffy, type DepsLuffy } from '@/server/luffy/vigie';
import { suivreCrise } from '@/server/crise/suivi';
import { envoyerAlerte } from '@/server/silence';
import { suivreKuroroTelegram } from '@/server/kuroro-telegram';
import { sauterSiEnPause } from '@/server/pause-agents';

// L'entrée de Luffy : POST ou GET verifier (appelée toutes les 5 minutes). Exige la preuve d'agent.
// Juste après son passage, le suivi des réunions de crise relit les vraies alertes (src/server/crise/) : pas de
// planification à part. Ses messages et ses erreurs ne changent rien au passage ni aux alertes de Luffy.

// 6 sites en parallèle, 15 s au plus chacun, plus l'envoi Telegram, plus le suivi des réunions de crise.
export const maxDuration = 60;

type Ctx = { params: Promise<{ action: string }> };
// ses alertes passent par la pause générale (gardées pour la fin de la pause, src/server/silence.ts)
const deps = (kv: KV): DepsLuffy => ({ fetch, envoyer: (texte, boutons) => envoyerAlerte(kv, envoyerTelegram, texte, boutons) });

async function passage(kv: KV, action: string) {
  // mis en pause par le patron : la vérification est sautée ; le suivi des réunions et de Telegram continue
  const r = (await sauterSiEnPause(kv, 'luffy', action)) ?? await traiterActionLuffy(kv, action, deps(kv));
  const crise = await suivreCrise(kv, { envoyer: (texte, boutons) => envoyerTelegram(texte, boutons) }).catch(() => {
    console.error('crise : suivi impossible');
    return null;
  });
  // une question posée à Kuroro sur Telegram dont le Mac n'a pas répondu à temps : on le dit, la demande est gardée
  await suivreKuroroTelegram(kv, { envoyer: (texte) => envoyerTelegram(texte) }).catch(() => console.error('kuroro : suivi Telegram impossible'));
  return { ...(r as object), crise };
}

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  try {
    verifierAgent(req);
    const { action } = await params;
    return Response.json(await passage(getKV().kv, action), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    verifierAgent(req);
    const { action } = await params;
    return Response.json(await passage(getKV().kv, action));
  } catch (e) {
    return reponseErreur(e);
  }
}
