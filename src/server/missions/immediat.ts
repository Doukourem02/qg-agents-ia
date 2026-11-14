import type { KV } from '../memoire';
import { ecrireEtat } from '../qg';
import { CLES_LUFFY, verifier, type DepsLuffy, type EtatSite } from '../luffy/vigie';
import { SITES } from '../luffy/sites';
import { faireTour, type DepsZoro } from '../zoro/tour';
import { demanderRapportMac } from '../zoro/mac';
import { nettoyer } from '../zoro/importance';
import { resumeNonLu } from '../zoro/etiquette';
import type { Tour } from '../zoro/types';
import { estIgnore, lireIgnores } from '../silence';
import { mettreEnPause, reprendre } from '../pause-agents';
import { agentDe, annonce, lireActionsImmediates, NOMS_REELS, type ActionImmediate, type Canal } from '@/sim/actions-immediates';

// Les actions immédiates, faites par le code dès que le message du patron les demande clairement (reconnues par
// src/sim/actions-immediates.ts, jamais par le modèle) : Luffy vérifie les sites, Zoro refait le tour de sécurité (le
// même tour que « Vérifier maintenant » de son bureau), un agent est mis en pause ou repris. La réponse part tout de
// suite ; le résultat d'une vérification part ensuite sur Telegram (`plusTard` : `after()` dans les routes).
// Aucun texte de message n'est journalisé ; seulement la nature d'une erreur.

export type DepsImmediat = {
  /** Le résultat d'une vérification, sur Telegram (directement : c'est la réponse à sa demande). */
  envoyer: (texte: string) => Promise<unknown>;
  luffy: () => DepsLuffy;
  zoro: () => DepsZoro;
  /** Le travail après la réponse (`after()` de Next.js) ; les tests l'attendent. */
  plusTard: (travail: () => Promise<void>) => void;
};

const MAX_LIGNES_ZORO = 6;

/** « Luffy a vérifié : 5 sites en ligne, API Livreo en panne (ignorée). » : l'état des sites juste après son passage. */
export async function resultatLuffy(kv: KV, r: Awaited<ReturnType<typeof verifier>>, now: number): Promise<string> {
  if ('ignore' in r && r.ignore) return 'Luffy n’a joint aucun site : c’est sans doute le réseau, pas tes sites. Rien n’est compté ; il revérifie dans 5 min.';
  const [bruts, ignores] = await Promise.all([kv.hgetall(CLES_LUFFY.etat), lireIgnores(kv).catch(() => [])]);
  const enLigne: string[] = [], tombes: string[] = [];
  for (const s of SITES) {
    let e: EtatSite | null = null;
    try { e = bruts[s.id] ? JSON.parse(bruts[s.id]) as EtatSite : null; } catch { e = null; }
    if (!e || e.echecs === 0) { enLigne.push(s.nom); continue; }
    const ignore = estIgnore(ignores, { cle: `site:${s.id}`, genre: 'site', depuis: e.depuis ?? now }) ? ' (ignorée)' : '';
    tombes.push(e.annoncee ? `${s.nom} en panne${ignore}` : `${s.nom} ne répond pas (premier échec : il revérifie dans 5 min)${ignore}`);
  }
  const debut = 'occupe' in r ? 'Luffy vérifiait déjà tes sites à l’instant' : 'Luffy a vérifié';
  if (!tombes.length) return `${debut} : tes ${SITES.length} sites sont en ligne.`;
  return `${debut} : ${enLigne.length} ${enLigne.length > 1 ? 'sites' : 'site'} en ligne, ${tombes.join(', ')}.`;
}

/** « Zoro a refait le tour de sécurité : 2 points importants » et les points, sans ce que le patron a dit d'ignorer. */
export async function resultatZoro(kv: KV, tour: Tour | { occupe: true }): Promise<string> {
  if ('occupe' in tour) return 'Zoro faisait déjà un tour de sécurité : son résultat est dans son bureau d’ici quelques minutes.';
  const ignores = new Set((await lireIgnores(kv).catch(() => [])).map(i => i.cle));
  const aDire = tour.importants.filter(i => !ignores.has(`zoro:${i.cle}`));
  const nIgnores = tour.importants.length - aDire.length;
  const ignoresTexte = nIgnores ? ` (et ${nIgnores} que tu as dit d’ignorer)` : '';
  const nonLu = resumeNonLu(tour);
  if (!aDire.length) return [`Zoro a refait le tour de sécurité : rien d’important${ignoresTexte}.`, ...(nonLu ? [nonLu] : [])].join('\n');
  const lignes = aDire.slice(0, MAX_LIGNES_ZORO).map(i => `• ${nettoyer(i.projet)} : ${nettoyer(i.texte)}`);
  const reste = aDire.length - lignes.length;
  return [
    `Zoro a refait le tour de sécurité : ${aDire.length} ${aDire.length > 1 ? 'points importants' : 'point important'}${ignoresTexte}.`,
    ...lignes, ...(reste > 0 ? [`+ ${reste} dans son bureau`] : []), ...(nonLu ? [nonLu] : []),
  ].join('\n');
}

async function envoyerSur(deps: DepsImmediat, texte: string, quoi: string) {
  try { await deps.envoyer(texte); } catch { console.error(`${quoi} : résultat Telegram pas parti`); }
}

/**
 * Exécute les actions reconnues et renvoie la réponse à donner tout de suite (écrite par le code), ou null quand il
 * n'y a rien à faire ici : la reprise d'un agent qui n'est pas en pause (l'appelant reprend son chemin normal).
 */
export async function executerActions(kv: KV, actions: ActionImmediate[], canal: Canal, deps: DepsImmediat, now = Date.now()): Promise<{ texte: string; agents: string[] } | null> {
  const textes: string[] = [], agents: string[] = [];
  for (const a of actions) {
    switch (a.type) {
      case 'luffy-verifier':
        deps.plusTard(async () => {
          try {
            const r = await verifier(kv, deps.luffy(), Date.now());
            const texte = await resultatLuffy(kv, r, Date.now());
            if (!('occupe' in r)) await ecrireEtat(kv, { agent: 'luffy', statut: 'termine', tache: 'a vérifié les sites à ta demande', resultat: texte.slice(0, 200), outil: 'Tg' }, Date.now());
            await envoyerSur(deps, texte, 'luffy');
          } catch (e) {
            console.error('luffy : vérification à la demande impossible', (e as Error)?.name);
            await envoyerSur(deps, 'Luffy n’a pas pu vérifier tes sites cette fois : il repasse dans 5 min.', 'luffy');
          }
        });
        break;
      case 'zoro-verifier':
        deps.plusTard(async () => {
          try {
            const tour = await faireTour(kv, deps.zoro(), Date.now(), 'verifier');
            await demanderRapportMac(kv).catch(() => undefined);
            await envoyerSur(deps, await resultatZoro(kv, tour), 'zoro');
          } catch (e) {
            console.error('zoro : tour à la demande impossible', (e as Error)?.name);
            await envoyerSur(deps, 'Zoro n’a pas pu finir le tour de sécurité cette fois : réessaie plus tard, ou regarde son bureau.', 'zoro');
          }
        });
        break;
      case 'pause-agent':
        if (a.jusqua !== null && a.jusqua <= now) { textes.push('Je n’ai pas compris jusqu’à quand : écris par exemple « mets Ye en pause cette semaine » ou « jusqu’à jeudi ».'); continue; }
        await mettreEnPause(kv, a.agent, a.jusqua, now);
        break;
      case 'reprendre-agent':
        if (!(await reprendre(kv, a.agent, now))) {
          if (actions.length === 1) return null;
          textes.push(`${NOMS_REELS[a.agent] ?? a.agent} n’était pas en pause.`);
          continue;
        }
        break;
    }
    textes.push(annonce(a, canal, now));
    agents.push(agentDe(a));
  }
  return { texte: textes.join(' '), agents };
}

/** La reprise d'un agent qui n'est pas en pause, dite honnêtement. */
export const pasEnPause = (agent: string) => `${NOMS_REELS[agent] ?? agent} n’est pas en pause : rien à reprendre.`;

/**
 * La barre de mission (et /api/missions) : le dernier message du patron, s'il demande une action immédiate, est fait
 * ici, avant tout modèle. null : pas d'action (le chemin habituel reprend). Jamais en /demo.
 */
export async function immediatDepuisPage(kv: KV, texte: string, deps: DepsImmediat, now = Date.now()): Promise<{ texte: string; mission: { agent: string; nom: string } } | null> {
  const actions = lireActionsImmediates(texte, now);
  if (!actions.length) return null;
  const r = await executerActions(kv, actions, 'page', deps, now);
  const agent = r?.agents[0] ?? agentDe(actions[0]);
  return { texte: r ? r.texte : pasEnPause(agent), mission: { agent, nom: NOMS_REELS[agent] ?? agent } };
}
