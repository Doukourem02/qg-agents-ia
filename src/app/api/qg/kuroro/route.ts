import { connection } from 'next/server';
import { getKV } from '@/server/kv';
import { lireJson, reponseErreur } from '@/server/auth';
import { Refus } from '@/server/qg';
import { clientKuroro, converser, lireConversation } from '@/server/kuroro';
import { immediatDepuisPage } from '@/server/missions/immediat';
import { depsImmediat } from '@/server/missions/reel';
import { estQuestionFeu, repondreQuestion } from '@/server/feu/questions';

// Kuroro converse avec Claude dans la barre de mission. Réservé à la page du QG, derrière la protection Vercel.
// { messages: [{ role: 'moi' | 'kuroro', texte }] } → { texte, mission? } ou { repli: true } (la page reprend ses règles).
// Une action immédiate (« vérifie mes sites », « mets Ye en pause ») est reconnue par le code et faite ici, avant tout
// modèle ; le résultat d'une vérification part sur Telegram après la réponse (jusqu'à 4 min pour Zoro).
export const maxDuration = 300;

export async function POST(req: Request) {
  await connection();
  try {
    // le laissez-passer des routines et la clé des agents : seule la page parle à Kuroro
    if (req.headers.has('x-vercel-protection-bypass') || req.headers.has('authorization')) throw new Refus('réservé à la page du QG', 403);
    const corps = await lireJson(req);
    const { kv } = getKV();
    if (corps.demo !== true) {
      const dernier = lireConversation(corps).at(-1)!.texte;
      const action = await immediatDepuisPage(kv, dernier, depsImmediat());
      if (action) return Response.json(action, { headers: { 'cache-control': 'no-store' } });
      // une question pour Feu : la réponse du code (solde, statut, annonce, niveaux), sinon une mission pour Feu
      if (estQuestionFeu(dernier)) return Response.json(await repondreQuestion(kv, dernier, Date.now()), { headers: { 'cache-control': 'no-store' } });
    }
    const reponse = await converser(corps, { client: clientKuroro(), kv });
    return Response.json(reponse, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return reponseErreur(e);
  }
}
