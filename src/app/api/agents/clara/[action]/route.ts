import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { sauterSiEnPause } from '@/server/pause-agents';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { envoyerTelegram } from '@/server/telegram';
import { Refus } from '@/server/qg';
import { traiterActionClara, type DepsClara } from '@/server/clara/api';
import { ErreurGmail, ouvrirBoite } from '@/server/clara/imap';

// Les entrées de Clara : GET essai | stats | vip-candidats, POST proposer | bannis. Exige la preuve d'agent. Runtime Node.js par défaut (sockets TCP).
export const maxDuration = 300;

type Ctx = { params: Promise<{ action: string }> };
const deps = (): DepsClara => ({
  envoyer: envoyerTelegram,
  ouvrir: async () => {
    const adresse = process.env.GMAIL_ADRESSE;
    const motDePasse = process.env.GMAIL_MOT_DE_PASSE_APPLI;
    if (!adresse || !motDePasse) throw new Refus('Gmail non configuré', 503);
    try {
      return await ouvrirBoite({ adresse, motDePasse });
    } catch (e) {
      if (e instanceof ErreurGmail) throw new Refus(e.message, 502);
      throw e;
    }
  },
});

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  try {
    verifierAgent(req);
    const { action } = await params;
    // mis en pause par le patron : le passage prévu est sauté, rien n'est fait (src/server/pause-agents.ts)
    const pause = await sauterSiEnPause(getKV().kv, 'clara', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionClara(getKV().kv, action, {}, deps());
    return Response.json(r, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  await connection();
  try {
    verifierAgent(req);
    const { action } = await params;
    // mis en pause par le patron : le passage prévu est sauté, rien n'est fait (src/server/pause-agents.ts)
    const pause = await sauterSiEnPause(getKV().kv, 'clara', action);
    if (pause) return Response.json(pause, { headers: { 'cache-control': 'no-store' } });
    const r = await traiterActionClara(getKV().kv, action, await lireJson(req), deps());
    return Response.json(r, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
