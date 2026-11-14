import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { reponseErreur, verifierAgent } from '@/server/auth';
import { prochaineDemande } from '@/server/kuroro-relais';
import { redonnerGarde } from '@/server/kuroro-telegram';

// Le Mac (mac/kuroro.mjs) prend la plus ancienne demande de la page, avec le prompt et les faits du QG, et apprend si la
// page l'a réveillé. ?vu=1 (réveillé, nouvelle tranche de 10 s) et ?allume=1 (toutes les 5 min) : il signale qu'il est là.
// Quand il signale qu'il est là, une question de Telegram gardée pendant son absence lui est remise. Exige la preuve des agents.
export async function GET(req: Request) {
  await connection();
  try {
    verifierAgent(req);
    const q = new URL(req.url).searchParams;
    const vu = q.get('vu') === '1', allume = q.get('allume') === '1';
    const r = await prochaineDemande(getKV().kv, Date.now(), { vu, allume });
    // le Mac revient : la question gardée de Telegram lui est remise (il la prend au passage suivant)
    if (vu || allume) await redonnerGarde(getKV().kv).catch(() => console.error('kuroro : question gardée pas remise'));
    return Response.json(r, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
