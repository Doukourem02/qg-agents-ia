import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { lireJson, reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { vuePaul } from '@/server/paul/vue';
import { ID_PROPOSITION } from '@/server/paul/etiquette';
import { deciderPaul } from '@/server/paul/ecriture';

// La page de Paul. Derrière la protection Vercel du déploiement, comme /api/lea et /api/zoro.
export async function GET() {
  await connection();
  try {
    return Response.json(await vuePaul(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

// { valider: <id> } ou { refuser: <id> } : les boutons du bureau, comme ceux de Telegram. Valider écrit sur GitHub
// (GITHUB_ECRITURE_PERSO, jamais renvoyée ni journalisée).
export async function POST(req: Request) {
  await connection();
  try {
    // laissez-passer des routines ou clé des agents : un agent ne valide jamais ses propres propositions, seule ma page le fait
    if (req.headers.has('x-vercel-protection-bypass') || req.headers.has('authorization')) throw new Refus('réservé à la page du QG', 403);
    const corps = await lireJson(req);
    const valider = typeof corps.valider === 'string';
    const id = valider ? corps.valider : corps.refuser;
    if ((corps.valider !== undefined) === (corps.refuser !== undefined)) throw new Refus('« valider » ou « refuser » : un seul des deux');
    if (typeof id !== 'string' || !ID_PROPOSITION.test(id)) throw new Refus('identifiant de proposition invalide');
    const { kv } = getKV();
    const message = await deciderPaul(kv, id, valider, { fetch, jeton: process.env.GITHUB_ECRITURE_PERSO });
    return Response.json({ message, vue: await vuePaul(kv) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
