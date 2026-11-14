// Le journal rangé pour l'écran (onglet Tâches et « Son journal » de chaque bureau) : par jour, puis par agent,
// les entrées semblables qui se suivent fusionnées (« traite la boîte ×5 »). Fonctions pures, partagées par la page.
// Heure d'Abidjan = UTC.

export type Faite = { quand: number; agent: string; texte: string; resultat?: string; erreur?: true };
/** Une ligne affichée : une entrée, ou plusieurs entrées semblables fusionnées (`n` > 1). */
export type LigneJournal = { agent: string; texte: string; n: number; quand: number; depuis: number; resultat?: string; erreur?: true };
export type GroupeAgent = { agent: string; lignes: LigneJournal[] };
export type GroupeJour = { jour: string; titre: string; agents: GroupeAgent[] };

const JOUR = 24 * 3600_000;
export const jourDe = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
const dateCourte = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** « Aujourd’hui », « Hier » ou « lun. 9 nov. ». */
export function titreJour(jour: string, aujourdhui: string): string {
  if (jour === aujourdhui) return 'Aujourd’hui';
  if (jour === jourDe(Date.parse(`${aujourdhui}T00:00:00Z`) - JOUR)) return 'Hier';
  return dateCourte(Date.parse(`${jour}T00:00:00Z`));
}

/** « aujourd’hui à 14:00 », « demain à 06:00 », « hier à 09:12 », « jeu. 12 nov. à 06:00 ». */
export function quandCourt(ms: number, now: number): string {
  const j = jourDe(ms), auj = jourDe(now);
  const mot = j === auj ? 'aujourd’hui' : j === jourDe(now + JOUR) ? 'demain' : j === jourDe(now - JOUR) ? 'hier' : dateCourte(ms);
  return `${mot} à ${heure(ms)}`;
}

/** La clé de fusion : le début du texte, avant « : » (« rédige : un post » → « rédige »). */
const cle = (texte: string) => texte.split(' : ')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Le texte d'une ligne fusionnée : le texte commun, sinon son début. */
const texteCommun = (textes: string[]) => (textes.every(t => t === textes[0]) ? textes[0] : textes[0].split(' : ')[0]);

const NOMBRE = /^(\d[\d\s  ]*)\s+(.+)$/;
const sansPluriel = (t: string) => t.split(' ').map(m => m.replace(/s$/, '')).join(' ');
/** Les résultats fusionnés : « 3 mails à la corbeille » + « 1 mail à la corbeille » → « 4 mails à la corbeille ». */
function resultatCommun(resultats: (string | undefined)[]): string | undefined {
  const presents = resultats.filter((r): r is string => !!r);
  if (!presents.length) return undefined;
  if (presents.length === 1) return presents[0];
  const lus = presents.map(r => r.match(NOMBRE));
  if (lus.every(Boolean) && lus.every(m => sansPluriel(m![2]) === sansPluriel(lus[0]![2]))) {
    const total = lus.reduce((s, m) => s + Number(m![1].replace(/\D/g, '')), 0);
    const pluriel = lus.find(m => Number(m![1].replace(/\D/g, '')) > 1)?.[2];
    const suite = total > 1 ? pluriel ?? lus[0]![2].split(' ').map((m, i) => (i === 0 ? `${m}s` : m)).join(' ') : sansPluriel(lus[0]![2]);
    return `${total.toLocaleString('fr-FR')} ${suite}`;
  }
  return presents[0]; // le plus récent
}

/** Fusionne les entrées semblables qui se suivent (même agent, même début de texte) ; l'ordre est conservé. */
export function fusionner(faites: Faite[]): LigneJournal[] {
  const paquets: Faite[][] = [];
  for (const f of faites) {
    const dernier = paquets[paquets.length - 1];
    if (dernier && dernier[0].agent === f.agent && !!dernier[0].erreur === !!f.erreur && cle(dernier[0].texte) === cle(f.texte)) dernier.push(f);
    else paquets.push([f]);
  }
  return paquets.map(p => {
    const resultat = resultatCommun(p.map(f => f.resultat));
    return {
      agent: p[0].agent, texte: texteCommun(p.map(f => f.texte)), n: p.length,
      quand: Math.max(...p.map(f => f.quand)), depuis: Math.min(...p.map(f => f.quand)),
      ...(resultat ? { resultat } : {}), ...(p[0].erreur ? { erreur: true as const } : {}),
    };
  });
}

/** La ligne affichée, résultat d'abord : « 172 mails à la corbeille », « 3 envois · 486 mails à la corbeille », « traite la boîte ×5 ». */
export function resume(l: LigneJournal): string {
  if (l.resultat) return l.n > 1 ? `${l.n} envois · ${l.resultat}` : l.resultat;
  return l.n > 1 ? `${l.texte} ×${l.n}` : l.texte;
}

/**
 * Le journal par jour (le plus récent d'abord), puis par agent (le plus récemment actif d'abord),
 * avec les entrées semblables fusionnées. `max` : nombre de lignes au plus, tous jours confondus.
 */
export function regrouper(faites: Faite[], aujourdhui: string, max = Infinity): GroupeJour[] {
  const tri = [...faites].sort((a, b) => b.quand - a.quand);
  const jours: GroupeJour[] = [];
  let reste = max;
  for (const f of tri) {
    const jour = jourDe(f.quand);
    if (!jours.length || jours[jours.length - 1].jour !== jour) jours.push({ jour, titre: titreJour(jour, aujourdhui), agents: [] });
  }
  const out: GroupeJour[] = [];
  for (const g of jours) {
    if (reste <= 0) break;
    const du = tri.filter(f => jourDe(f.quand) === g.jour);
    const ordre = [...new Set(du.map(f => f.agent))];
    const agents: GroupeAgent[] = [];
    for (const agent of ordre) {
      if (reste <= 0) break;
      const lignes = fusionner(du.filter(f => f.agent === agent)).slice(0, reste);
      reste -= lignes.length;
      agents.push({ agent, lignes });
    }
    out.push({ ...g, agents });
  }
  return out;
}

/** L'état réel d'un agent, tel que lu par /api/qg/vues (voir `EtatAgent` dans src/server/vues.ts). */
type Etat = { statut: 'au travail' | 'au repos' | 'bloque'; tache?: string; prochainPassage: { quand: number } | null; surDemande?: true; rythme?: string; pause?: string };
export const NOM_STATUT = { 'au travail': 'au travail', 'au repos': 'au repos', bloque: 'bloqué' } as const;

/** Le prochain passage en mots : « jeu. 12 nov. à 06:00 », ou « quand tu touches un bouton » pour Clara. */
export function prochainEnMots(e: Etat, now: number): string | null {
  if (e.surDemande) return 'quand tu touches un bouton';
  if (e.rythme) return e.rythme;
  return e.prochainPassage ? quandCourt(e.prochainPassage.quand, now) : null;
}

/** « En ce moment » sur la fiche d'un agent réel. */
export function enCeMoment(e: Etat, now: number): string {
  if (e.statut === 'au travail') return e.tache ? `au travail : ${e.tache}` : 'au travail';
  if (e.statut === 'bloque') return 'bloqué · le dernier passage prévu n’a pas eu lieu';
  if (e.pause) return e.pause;
  if (e.surDemande) return 'au repos · agit quand tu touches un bouton';
  const p = prochainEnMots(e, now);
  return p ? `au repos · prochain passage ${p}` : 'au repos';
}

// ── Onglet Tâches : une ligne de résumé par agent et par jour, le détail au clic

/**
 * Les étapes techniques (comptes, vérifications, débuts restés sans fin) : seulement dans le détail.
 * Début du texte, sans accents ni majuscules.
 */
const SECONDAIRES = [
  'statistiques avancees', 'statistiques deja en cours', 'compte les mails', 'prepare des questions', 'questions posees',
  'releve rafraichi depuis le mac', 'verifie la connexion a gmail', 'connexion a gmail verifiee',
  'cherche les contacts a proteger', 'contacts a proteger trouves', 'met sa memoire a jour',
  'applique les bannissements', 'met des mails a la corbeille', 'telegram demande de ralentir',
];
const sansAccents = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/** Une étape technique, sans résultat ni erreur : cachée derrière le compte du résumé. */
export const estSecondaire = (l: Pick<LigneJournal, 'texte' | 'resultat' | 'erreur'>) =>
  !l.resultat && !l.erreur && SECONDAIRES.some(s => sansAccents(l.texte).startsWith(s));

/**
 * Le détail d'un agent pour un jour : les lignes fusionnées, et chaque étape technique du même genre réunie
 * en une seule ligne (×n), où qu'elle tombe dans la journée. Le plus récent d'abord.
 */
export function detailAgent(lignes: LigneJournal[]): LigneJournal[] {
  const out: LigneJournal[] = [];
  const parGenre = new Map<string, LigneJournal>();
  for (const l of lignes) {
    if (!estSecondaire(l)) { out.push(l); continue; }
    const g = parGenre.get(cle(l.texte));
    if (!g) { const copie = { ...l }; parGenre.set(cle(l.texte), copie); out.push(copie); continue; }
    g.texte = texteCommun([g.texte, l.texte]);
    g.n += l.n; g.quand = Math.max(g.quand, l.quand); g.depuis = Math.min(g.depuis, l.depuis);
  }
  return out.sort((a, b) => b.quand - a.quand);
}

/** Le résumé d'un agent pour un jour : résultats (additionnés quand ils se comptent pareil), erreurs, actions, puis le reste. */
export type ResumeAgent = { resultats: string[]; erreurs: string[]; actions: string[]; autres: number };

const ACTIONS_MAX = 2;

export function resumeAgent(lignes: LigneJournal[]): ResumeAgent {
  // les résultats du même genre (« 3 mails à la corbeille », « 172 mails à la corbeille ») sont additionnés
  const genres = new Map<string, string[]>();
  for (const l of lignes) {
    if (!l.resultat || l.erreur) continue;
    const m = l.resultat.match(NOMBRE);
    const k = m ? `#${sansPluriel(m[2])}` : l.resultat;
    genres.set(k, [...(genres.get(k) ?? []), l.resultat]);
  }
  const resultats = [...genres.values()].map(r => resultatCommun(r)!);
  const erreurs = detailAgent(lignes.filter(l => l.erreur)).map(resume);
  const vues = new Set<string>();
  const actions: string[] = [];
  let autres = 0;
  for (const l of detailAgent(lignes.filter(l => !l.erreur && !l.resultat))) {
    const k = cle(l.texte);
    if (estSecondaire(l) || vues.has(k) || actions.length >= ACTIONS_MAX) { autres += l.n; continue; }
    vues.add(k);
    actions.push(resume(l));
  }
  // rien d'autre à dire : la plus récente des étapes techniques mène le résumé
  if (!resultats.length && !erreurs.length && !actions.length && autres) {
    const premiere = detailAgent(lignes)[0];
    actions.push(resume(premiere));
    autres -= premiere.n;
  }
  return { resultats, erreurs, actions, autres };
}

/** « 4 autres étapes », « 1 autre étape ». */
export const autresEtapes = (n: number) => `${n} ${n > 1 ? 'autres étapes' : 'autre étape'}`;
