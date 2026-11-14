// L'organigramme de l'onglet Équipe, en données pures (testées dans organigramme.test.ts) :
// Kuroro (le CEO, le boss, chef de la Direction) → les chefs de pôle → leurs équipes.

/** Agent réel (il écrit vraiment dans le QG), prévu, ou « plus tard ». */
export type Marque = 'reel' | 'prevu' | 'plusTard';
export type Membre = { id: string; marque: Marque; n1: boolean };
export type Branche = { pole: string; chef: Membre; equipe: Membre[] };

type AgentMin = { id: string; pole: string; plusTard: boolean };
type PoleMin = { id: string; chef: string };

/** L, le n°1 du QG : en tête de la Communication. */
export const N1 = 'L';
/** Le pôle le plus important après le CEO : au centre de l'organigramme. */
export const POLE_CENTRE = 'communication';

const RANG: Record<Marque, number> = { reel: 0, prevu: 1, plusTard: 2 };

export function marque(a: { id: string; plusTard: boolean }, reels: readonly string[]): Marque {
  if (reels.includes(a.id)) return 'reel';
  return a.plusTard ? 'plusTard' : 'prevu';
}

/** Les pôles sous le CEO, dans l'ordre de agents.json, la Communication remise au centre. */
export function ordrePoles<P extends PoleMin>(poles: readonly P[]): P[] {
  const autres = poles.filter(p => p.id !== 'direction' && p.id !== POLE_CENTRE);
  const centre = poles.find(p => p.id === POLE_CENTRE);
  if (!centre) return autres;
  const out = [...autres];
  out.splice(Math.floor(autres.length / 2), 0, centre);
  return out;
}

/** Une équipe : le n°1 d'abord, puis les agents réels, les prévus, ceux de « plus tard » (ordre de agents.json sinon). */
export function ordreEquipe(membres: readonly Membre[]): Membre[] {
  return membres
    .map((m, i) => ({ m, i }))
    .sort((a, b) => Number(b.m.n1) - Number(a.m.n1) || RANG[a.m.marque] - RANG[b.m.marque] || a.i - b.i)
    .map(x => x.m);
}

export function organigramme(agents: readonly AgentMin[], poles: readonly PoleMin[], reels: readonly string[]) {
  const membre = (a: AgentMin): Membre => ({ id: a.id, marque: marque(a, reels), n1: a.id === N1 });
  const parId = (id: string) => agents.find(a => a.id === id);
  const direction = poles.find(p => p.id === 'direction');
  const ceoAgent = direction && parId(direction.chef);
  const branches: Branche[] = ordrePoles(poles).flatMap(p => {
    const chef = parId(p.chef);
    if (!chef) return [];
    const equipe = ordreEquipe(agents.filter(a => a.pole === p.id && a.id !== p.chef).map(membre));
    return [{ pole: p.id, chef: membre(chef), equipe }];
  });
  // les agents de la Direction qui ne dirigent aucun pôle (Feu, le copilote de trading) : rattachés au CEO lui-même
  const chefs = new Set(poles.map(p => p.chef));
  const aupres = ordreEquipe(agents.filter(a => a.pole === 'direction' && !chefs.has(a.id)).map(membre));
  return { ceo: ceoAgent ? membre(ceoAgent) : null, aupres, branches };
}

/** Le rôle court d'une carte : « CMO, chef direct de L » → « CMO » ; « Testeur (plus tard) » → « Testeur ». */
export function roleCourt(role: string): string {
  return role.replace(/\s*\(plus tard\)\s*/i, '').split(',')[0].trim();
}

/** Une longue équipe se range sur deux colonnes (au-delà de `max` membres). */
export function enColonnes<T>(liste: readonly T[], max = 4): T[][] {
  if (liste.length <= max) return [[...liste]];
  const n = Math.ceil(liste.length / 2);
  return [liste.slice(0, n), liste.slice(n)];
}
