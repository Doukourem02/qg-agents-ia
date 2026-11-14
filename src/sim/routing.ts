import data from '@/data/agents.json';

export type Agent = (typeof data.agents)[number];
export type Pole = (typeof data.poles)[number];

export const AGENTS: Agent[] = data.agents;
export const POLES: Pole[] = data.poles;
export const agentById = (id: string) => AGENTS.find(a => a.id === id);
export const poleById = (id: string) => POLES.find(p => p.id === id);

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const echapper = (m: string) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Le mot-clé commence un mot (« place » n'est pas dans « remplace », « vide » pas dans « évidemment »).
 * Un mot de 5 lettres ou moins doit être entier (pluriel permis) : « mac » n'est pas dans « macro », « place » pas dans « placer ».
 * Une racine marquée « * » garde ses suites (« reli* » → « relis », « publi* » → « publie »), comme un mot long (« déploiement »).
 */
export function motCle(m: string) {
  const racine = m.endsWith('*');
  const mot = sansAccents(racine ? m.slice(0, -1) : m);
  const entier = !racine && mot.length <= 5;
  return new RegExp(`(?<![a-z0-9])${echapper(mot)}${entier ? 's?(?![a-z0-9])' : ''}`);
}

/**
 * Aiguillage du CEO par mots-clés (comme dans le guide) : le premier agent dont un mot-clé
 * apparaît dans la phrase reçoit la mission. Aucun mot-clé → Kuroro s'en occupe lui-même.
 */
export function routeMission(texte: string): { agent: Agent; pole: Pole } {
  const t = sansAccents(texte);
  for (const a of AGENTS) {
    if (a.motsCles.some(m => motCle(m).test(t))) return { agent: a, pole: poleById(a.pole)! };
  }
  const ceo = agentById('kuroro')!;
  return { agent: ceo, pole: poleById(ceo.pole)! };
}
