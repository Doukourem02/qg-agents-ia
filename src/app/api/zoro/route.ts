import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { vueZoro } from '@/server/zoro/vue';
import { faireTour } from '@/server/zoro/tour';
import { demanderRapportMac } from '@/server/zoro/mac';
import { depsZoro } from '@/server/zoro/reel';

// La page de Zoro. Derrière la protection Vercel du déploiement, comme /api/clara.

// « Vérifier maintenant » fait un tour entier (échéance commune de 240 s) : même durée que la route d'agent.
export const maxDuration = 300;

export async function GET() {
  await connection();
  try {
    return Response.json(await vueZoro(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

// Le bouton « Vérifier maintenant » : un tour `verifier` (ni Telegram, ni mémoire, ni historique), puis une demande
// d'un rapport frais au relais du Mac. Un tour déjà en cours → { occupe: true } avec la vue actuelle.
export async function POST(req: Request) {
  await connection();
  try {
    // le laissez-passer des routines : une routine ne lance jamais la vérification à la demande, seule ma page le fait
    if (req.headers.has('x-vercel-protection-bypass')) throw new Refus('réservé à la page du QG', 403);
    const { kv } = getKV();
    const tour = await faireTour(kv, depsZoro(), Date.now(), 'verifier');
    await demanderRapportMac(kv);
    const vue = await vueZoro(kv);
    return Response.json('occupe' in tour ? { ...vue, occupe: true } : vue, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
