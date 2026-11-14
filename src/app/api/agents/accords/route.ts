import { getKV } from '@/server/kv';
import { demanderAccord, lireAccord } from '@/server/accords';
import { envoyerDemande } from '@/server/canal';
import { lireJson, reponseErreur, verifierAgent } from '@/server/auth';
import { Refus } from '@/server/qg';

// Un agent demande mon accord (POST, envoyé sur Telegram ou WhatsApp) puis lit ma décision (GET ?id=…).
// Exige la preuve d'agent.

export async function POST(req: Request) {
  try {
    verifierAgent(req);
    const { kv } = getKV();
    const { accord, nouveau } = await demanderAccord(kv, await lireJson(req));
    if (nouveau) await envoyerDemande(accord);
    return Response.json({ accord, nouveau }, { status: nouveau ? 201 : 200 });
  } catch (e) {
    return reponseErreur(e);
  }
}

export async function GET(req: Request) {
  try {
    verifierAgent(req);
    const id = new URL(req.url).searchParams.get('id');
    if (!id) throw new Refus('« id » manquant');
    const accord = await lireAccord(getKV().kv, id);
    if (!accord) throw new Refus('demande inconnue', 404);
    return Response.json({ accord }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
