// Les entrées de Feu (route d'agent, preuve exigée) : `marche` (QStash toutes les 15 min, GET ou POST sans corps),
// `compte` (POST du relais du Mac : le compte lu en lecture seule, jamais la clé), `a-analyser` (GET) et `rapport` (POST)
// pour la routine « Feu · marché ».
import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import { envoyerAlerte } from '../silence';
import { validerCompte } from './compte';
import { ecrireCompte, lireCompte } from './etat';
import { passageFeu, type DepsFeu } from './passage';
import { TETE } from './messages';
import { envoyerAnalysesDues, preparerLot, recevoirAnalyse } from './analyse';

/** Ce que Feu dit quand la clé peut écrire : il refuse de s'en servir (une fois, quand ça arrive). */
export const MESSAGE_DROITS = `${TETE} · ta clé Binance a des droits en trop (trading, retraits ou autres) : je refuse de m'en servir et je n'ai rien lu. `
  + 'Supprime-la sur Binance et recrée-la avec « Lecture » seulement (Enable Reading), puis range-la de nouveau dans le Trousseau.';

/** `compte` : le compte reçu du Mac est vérifié puis rangé. Une clé avec des droits en trop est dite au patron. */
export async function recevoirCompte(kv: KV, corps: unknown, deps: Pick<DepsFeu, 'envoyer'>, now: number) {
  const c = validerCompte(corps, now);
  const avant = await lireCompte(kv);
  // une lecture ratée ne remplace pas le dernier compte lu (la page dit « solde vu à HH:MM ») ; elle est seulement notée
  if (c.cle === 'erreur' && avant?.cle === 'ok') {
    await ecrireEtat(kv, { agent: 'feu', statut: 'erreur', tache: `n'a pas pu lire ton compte : ${c.raison ?? 'erreur'}`.slice(0, 140), outil: 'Bi' }, now, { journal: false });
    return { ok: true, garde: 'dernier compte lu' };
  }
  await ecrireCompte(kv, c);
  if (c.cle === 'droits' && avant?.cle !== 'droits') {
    await envoyerAlerte(kv, deps.envoyer, MESSAGE_DROITS, undefined, now).catch(() => console.error('feu : message des droits pas parti'));
    await ecrireEtat(kv, { agent: 'feu', statut: 'erreur', tache: 'refuse ta clé Binance : elle a des droits d\'écriture', outil: 'Bi' }, now);
  } else if (c.cle === 'ok') {
    await ecrireEtat(kv, { agent: 'feu', statut: 'termine', tache: 'lit ton solde en lecture seule', outil: 'Bi' }, now, { journal: avant?.cle !== 'ok' });
  }
  return { ok: true, cle: c.cle };
}

export async function traiterActionFeu(kv: KV, action: string, corps: unknown, deps: DepsFeu, now: number = Date.now()): Promise<unknown> {
  switch (action) {
    case 'marche': {
      const r = await passageFeu(kv, deps, now);
      // l'analyse de la routine part à son heure (08:00, 12:00, 16:00, 20:00), avec les statuts de ce passage
      const analyses = await envoyerAnalysesDues(kv, deps, now).catch(() => { console.error('feu : envoi de l\'analyse impossible'); return 0; });
      return { ...(r as object), analyses };
    }
    case 'a-analyser':
      if (corps !== undefined) throw new Refus('« a-analyser » se demande en GET', 405);
      return preparerLot(kv, deps, now);
    case 'rapport':
      if (corps === undefined) throw new Refus('le rapport s\'envoie en POST', 405);
      return recevoirAnalyse(kv, corps, deps, now);
    case 'compte':
      if (corps === undefined) throw new Refus('le compte s\'envoie en POST', 405);
      return recevoirCompte(kv, corps, deps, now);
    default:
      throw new Refus('action inconnue', 404);
  }
}
