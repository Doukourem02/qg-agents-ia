import { getKV } from '@/server/kv';
import { deposerMission } from '@/server/qg';
import { lireJson, reponseErreur } from '@/server/auth';
import { immediatDepuisPage } from '@/server/missions/immediat';
import { depsImmediat } from '@/server/missions/reel';
import { agentDe, lireActionsImmediates } from '@/sim/actions-immediates';

// La barre de mission (et la fiche d'un agent) déposent ici une mission ; Kuroro la confie au bon agent.
// Une action immédiate (« vérifie mes sites », « reprends Paul ») est faite tout de suite au lieu d'être déposée, si
// elle est pour l'agent choisi (ou sans agent choisi). Le résultat d'une vérification part sur Telegram.
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { kv, source } = getKV();
    const corps = await lireJson(req);
    if (typeof corps.texte === 'string') {
      const actions = lireActionsImmediates(corps.texte, Date.now());
      if (actions.length && (!corps.agent || actions.every(a => agentDe(a) === corps.agent))) {
        const action = await immediatDepuisPage(kv, corps.texte, depsImmediat());
        if (action) return Response.json({ source, action }, { status: 201 });
      }
    }
    const mission = await deposerMission(kv, corps);
    return Response.json({ source, mission }, { status: 201 });
  } catch (e) {
    return reponseErreur(e);
  }
}
