import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import type { Bouton } from '../telegram';
import { appliquerBannis, correspondVip, lireVip, poserQuestion1, relancerQuestions1 } from './actions';
import { essai, type BoiteOuverte } from './imap';
import { CLE_CANDIDATS } from './vue';
import { avancerStats, candidatsVip, CLES_CLARA, meilleursExpediteurs, normaliser, type StatExpediteur } from './stats';

/** Les VIP, plus ma propre adresse : jamais proposée ni touchée (je m'envoie des mails à moi-même). */
async function vipEtMoi(kv: KV): Promise<Set<string>> {
  const vip = new Set(await lireVip(kv));
  const moi = process.env.GMAIL_ADRESSE;
  if (moi) vip.add(normaliser(moi).adresse);
  return vip;
}

// Les entrées de Clara : une action = une fonction, testable sans réseau (la boîte est injectée).

export type DepsClara = {
  ouvrir: () => Promise<BoiteOuverte>;
  envoyer?: (texte: string, boutons?: Bouton[]) => Promise<unknown>;
  now?: () => number;
  /** Pause entre deux envois Telegram (par défaut un vrai délai ; les tests passent une fonction immédiate). */
  attendre?: (ms: number) => Promise<void>;
};

/** Telegram limite à environ un message par seconde dans une même conversation. */
const ENTRE_ENVOIS_MS = 1100;
const dormir = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const PAR_JOUR = 5, PAR_APPEL_PROPOSER = 5, PAR_APPEL_MENAGE = 20, A_JUGER = 50;
const MENAGE_TOTAL = 200, MENAGE_APPELS_JOUR = 3;
const CLE_MENAGE = 'clara:grand-menage';
const cleJour = (now: number) => `clara:propose:${new Date(now).toISOString().slice(0, 10)}`;

/** Ouvre la boîte, exécute, ferme toujours. */
async function avecBoite<T>(deps: DepsClara, f: (b: BoiteOuverte) => Promise<T>): Promise<T> {
  const boite = await deps.ouvrir();
  try { return await f(boite); } finally { await boite.fermer().catch(() => undefined); }
}

async function stats(kv: KV, deps: DepsClara, now: number) {
  await etat(kv, 'compte les mails par expéditeur', 'au travail');
  let r: { fini: boolean; lus: number };
  try {
    r = await avecBoite(deps, b => avancerStats(kv, b, now, { recalculQuotidien: true }));
  } catch (e) {
    if (e instanceof Refus && e.code === 409) { await etat(kv, 'statistiques déjà en cours', 'termine'); return { occupe: true }; }
    await etat(kv, 'statistiques interrompues', 'erreur');
    throw e;
  }
  await etat(kv, 'statistiques avancées', 'termine');
  const vip = await vipEtMoi(kv);
  const [gardes, bannis, questions] = await Promise.all([CLES_CLARA.gardes, CLES_CLARA.bannis, CLES_CLARA.questions].map(c => kv.hgetall(c)));
  // l'index des plus gros expéditeurs, jamais toute la table
  const expediteurs = (await meilleursExpediteurs(
    kv, s => !correspondVip(s.adresse, vip) && !(s.id in gardes) && !(s.id in bannis) && !(s.id in questions), A_JUGER,
  ))
    .map(s => ({
      id: s.id, adresse: s.adresse, nom: s.nom, total: s.total, nonLus: s.nonLus, categorie: s.categorie,
      unClic: !!s.desabo?.unClic, exempleObjet: s.exempleObjet,
    }));
  return { ...r, expediteurs };
}

async function proposer(kv: KV, corps: Record<string, unknown>, deps: DepsClara, now: number) {
  if (corps.grandMenageFini === true) {
    await kv.hset(CLE_MENAGE, 'fini', String(now));
    return { grandMenageFini: true };
  }
  const menage = corps.grandMenage === true;
  if (!Array.isArray(corps.ids) || corps.ids.some(i => typeof i !== 'string')) throw new Refus('« ids » doit être une liste d\'identifiants');
  const ids = [...new Set(corps.ids as string[])];
  if (!ids.length) throw new Refus('« ids » vide');
  if (ids.length > (menage ? PAR_APPEL_MENAGE : PAR_APPEL_PROPOSER)) throw new Refus(`au plus ${menage ? PAR_APPEL_MENAGE : PAR_APPEL_PROPOSER} expéditeurs par appel`);
  if (!deps.envoyer) throw new Refus('Telegram non configuré', 503);
  const jourN = new Date(now).toISOString().slice(0, 10);
  const compte = menage ? await kv.hgetall(CLE_MENAGE) : {};
  if (menage) {
    if ('fini' in compte) throw new Refus('le grand ménage est déjà fait', 409);
    if ((Number(compte.total) || 0) + ids.length > MENAGE_TOTAL) throw new Refus(`au plus ${MENAGE_TOTAL} propositions au total pour le grand ménage`, 429);
    if ((Number(compte['appels:' + jourN]) || 0) >= MENAGE_APPELS_JOUR) throw new Refus(`au plus ${MENAGE_APPELS_JOUR} appels de grand ménage par jour`, 429);
  }

  const vip = await vipEtMoi(kv);
  const cle = cleJour(now);
  const [gardes, bannis, questions, deja, fiches] = await Promise.all([
    kv.hgetall(CLES_CLARA.gardes), kv.hgetall(CLES_CLARA.bannis), kv.hgetall(CLES_CLARA.questions), kv.hgetall(cle), kv.hmget(CLES_CLARA.stats, ids)]);
  const stats: StatExpediteur[] = [];
  for (const id of ids) {
    let s: StatExpediteur | null = null;
    try { s = id in fiches ? (JSON.parse(fiches[id]) as StatExpediteur) : null; } catch { s = null; }
    if (!s || id in gardes || id in bannis || correspondVip(s.adresse, vip)) throw new Refus(`expéditeur refusé (VIP, gardé, banni ou inconnu) : ${id}`, 422);
    if (id in questions || id in deja) throw new Refus(`expéditeur déjà proposé : ${id}`, 422);
    stats.push(s);
  }
  if (!menage) {
    if (Object.keys(deja).length + ids.length > PAR_JOUR) throw new Refus(`au plus ${PAR_JOUR} expéditeurs proposés par jour`, 429);
  }
  await etat(kv, 'prépare des questions', 'au travail');
  if (menage) {
    await kv.hset(CLE_MENAGE, 'total', String((Number(compte.total) || 0) + ids.length));
    await kv.hset(CLE_MENAGE, 'appels:' + jourN, String((Number(compte['appels:' + jourN]) || 0) + 1));
  }
  const attendre = deps.attendre ?? dormir;
  let envoyes = 0;
  try {
    for (const s of stats) {
      if (envoyes > 0) await attendre(ENTRE_ENVOIS_MS);
      if (!menage) await kv.hset(cle, s.id, String(now));
      await poserQuestion1(kv, deps.envoyer, s, now);
      envoyes++;
    }
  } catch (e) {
    // le quota des non-envoyés est rendu (poserQuestion1 a déjà retiré la question ratée)
    const restants = stats.slice(envoyes);
    if (!menage) for (const s of restants) await kv.hdel(cle, s.id).catch(() => undefined);
    else await kv.hincrby(CLE_MENAGE, 'total', -restants.length).catch(() => undefined);
    // Telegram demande de ralentir : arrêt propre, la routine reprendra plus tard
    if (e instanceof Refus && e.code === 429) {
      await etat(kv, 'Telegram demande de ralentir', 'termine');
      return { proposes: envoyes, limite: true, restants: restants.map(s => s.id) };
    }
    await etat(kv, 'questions interrompues', 'erreur');
    throw e;
  }
  await etat(kv, 'questions posées', 'termine');
  return { proposes: envoyes };
}


/** Écrit au mieux : l'état ne masque jamais une erreur. */
const etat = (kv: KV, tache: string, statut: 'au travail' | 'termine' | 'erreur') =>
  ecrireEtat(kv, { agent: 'clara', statut, tache, outil: 'Gm' }).catch(() => undefined);

export async function traiterActionClara(
  kv: KV, action: string, corps: Record<string, unknown>, deps: DepsClara,
): Promise<unknown> {
  const now = (deps.now ?? Date.now)();
  switch (action) {
    case 'essai': {
      await etat(kv, 'vérifie la connexion à Gmail', 'au travail');
      const boite = await deps.ouvrir().catch(async e => { await etat(kv, 'connexion à Gmail impossible', 'erreur'); throw e; });
      try {
        const r = await essai(boite);
        await etat(kv, 'connexion à Gmail vérifiée', 'termine');
        return r;
      } finally {
        await boite.fermer();
      }
    }
    case 'stats':
      return stats(kv, deps, now);
    case 'proposer':
      return proposer(kv, corps, deps, now);
    case 'relancer':
      // renvoie seulement les questions 1 restées sans réponse ; ne touche pas à la boîte
      if (!deps.envoyer) throw new Refus('envoi Telegram non branché', 503);
      return { relancees: await relancerQuestions1(kv, deps.envoyer) };
    case 'bannis':
      // appliquerBannis écrit son propre état ; ici seulement la connexion
      return avecBoite(deps, b => appliquerBannis(kv, b, now)).catch(async e => { await etat(kv, 'bannissements interrompus', 'erreur'); throw e; });
    case 'vip-candidats': {
      await etat(kv, 'cherche les contacts à protéger', 'au travail');
      try {
        const candidats = await avecBoite(deps, b => candidatsVip(b));
        // la page lit ce cache, jamais la boîte
        await kv.hset(CLE_CANDIDATS, 'liste', JSON.stringify(candidats));
        await etat(kv, 'contacts à protéger trouvés', 'termine');
        return { candidats };
      } catch (e) {
        await etat(kv, 'recherche des contacts interrompue', 'erreur');
        throw e;
      }
    }
    default:
      throw new Refus('action inconnue', 404);
  }
}
