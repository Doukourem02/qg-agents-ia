import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { lireJson, reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { vueYe } from '@/server/ye/vue';
import { ID_YE } from '@/server/ye/etiquette';
import { deciderYe, repondreQuestion } from '@/server/ye/ecriture';
import { deciderNouvelle } from '@/server/ye/nouvelle';

// La page de Ye. Derrière la protection Vercel du déploiement, comme /api/paul.
export async function GET() {
  await connection();
  try {
    return Response.json(await vueYe(getKV().kv), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}

const ACTIONS = ['valider', 'refuser', 'oui', 'non', 'ajouter', 'plus-tard', 'jamais'] as const;
// la création d'une fiche lit et envoie jusqu'à 5 images
export const maxDuration = 300;

// { valider | refuser: <id de proposition> }, { oui | non: <id de question> } ou { ajouter | plus-tard | jamais: <id de
// nouvelle fiche> } : les boutons du bureau, comme sur
// Telegram. Valider publie sur Sanity (SANITY_ECRITURE_PORTFOLIO, jamais renvoyée ni journalisée).
export async function POST(req: Request) {
  await connection();
  try {
    // laissez-passer des routines ou clé des agents : un agent ne valide jamais ses propres propositions, seule ma page le fait
    if (req.headers.has('x-vercel-protection-bypass') || req.headers.has('authorization')) throw new Refus('réservé à la page du QG', 403);
    const corps = await lireJson(req);
    const donnees = ACTIONS.filter(a => corps[a] !== undefined);
    if (donnees.length !== 1) throw new Refus('une seule action : « valider », « refuser », « oui », « non », « ajouter », « plus-tard » ou « jamais »');
    const action = donnees[0];
    const id = corps[action];
    if (typeof id !== 'string' || !ID_YE.test(id)) throw new Refus('identifiant invalide');
    const { kv } = getKV();
    const message = action === 'oui' || action === 'non'
      ? await repondreQuestion(kv, id, action === 'oui')
      : action === 'ajouter' || action === 'plus-tard' || action === 'jamais'
        ? await deciderNouvelle(kv, id, action, { fetch, jeton: process.env.SANITY_ECRITURE_PORTFOLIO, github: process.env.GITHUB_LECTURE_PERSO })
        : await deciderYe(kv, id, action === 'valider', { fetch, jeton: process.env.SANITY_ECRITURE_PORTFOLIO });
    return Response.json({ message, vue: await vueYe(kv) }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
