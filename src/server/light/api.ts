import type { KV } from '../memoire';
import { ecrireEtat, Refus } from '../qg';
import type { Bouton } from '../telegram';
import { deposer } from '../l/boite';
import {
  calculerReleve, CLES_LIGHT, contientNomInterdit, jourDe, releveDuJour, urlDecodee, type DepsReleve, type Releve,
} from './releve';

// Les entrées de Light pour sa routine : une action = une fonction, testable sans réseau (l'envoi est injecté).

export type MessageJour = { jour: string; texte: string; cles: string[]; envoye?: number; vu?: number; relances: number[] };
export type DepsLight = DepsReleve & { envoyer: (texte: string, boutons?: Bouton[]) => Promise<unknown> };

const MAX_RELANCES = 2;
const PIED = 'Le détail est sur la fiche de Light.';
type StatutLight = 'au travail' | 'termine' | 'en pause' | 'erreur';
// `outil` allume l'icône correspondante dans la page (GH = GitHub, Tg = Telegram)
const etat = (kv: KV, tache: string, statut: StatutLight, outil?: 'GH' | 'Tg') => ecrireEtat(kv, { agent: 'light', statut, tache, ...(outil ? { outil } : {}) });
/** Sur un chemin d'erreur : l'état est écrit au mieux, sans masquer l'erreur d'origine. */
const etatSurEchec = (kv: KV, tache: string, statut: StatutLight) => etat(kv, tache, statut).catch(() => undefined);
const boutonVu = (jour: string): Bouton[] => [{ texte: 'Vu', donnee: 'vu-light:' + jour }];

async function lireMessage(kv: KV, jour: string): Promise<MessageJour | null> {
  const brut = (await kv.hgetall(CLES_LIGHT.messages))[jour];
  return brut ? (JSON.parse(brut) as MessageJour) : null;
}
const ecrireMessage = (kv: KV, m: MessageJour) => kv.hset(CLES_LIGHT.messages, m.jour, JSON.stringify(m));

function texteBorne(v: unknown, nom: string, max: number, requis = true): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (requis) throw new Refus(`« ${nom} » manquant`);
    return undefined;
  }
  if (typeof v !== 'string' || (requis && !v.trim())) throw new Refus(`« ${nom} » doit être un texte`);
  if (v.length > max) throw new Refus(`« ${nom} » trop long (${max} caractères au plus)`);
  return v;
}

function lectures(v: unknown): { titre: string; url: string; pourquoi: string }[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 2) throw new Refus('« lectures » : une liste de 2 au plus');
  return v.map((l, i) => {
    const o = (l ?? {}) as Record<string, unknown>;
    const url = texteBorne(o.url, `lectures[${i}].url`, 500)!;
    if (!/^https:\/\//i.test(url)) throw new Refus(`« lectures[${i}].url » doit commencer par https://`);
    return { titre: texteBorne(o.titre, `lectures[${i}].titre`, 160)!, url, pourquoi: texteBorne(o.pourquoi, `lectures[${i}].pourquoi`, 240)! };
  });
}

async function rapport(kv: KV, corps: Record<string, unknown>, deps: DepsLight, now: number) {
  const resume = texteBorne(corps.resume, 'resume', 600)!;
  const choix = lectures(corps.lectures);
  const idee = texteBorne(corps.idee, 'idee', 500, false);
  const telegram = texteBorne(corps.telegram, 'telegram', 3000, false);
  const jour = jourDe(now);

  const releve = await releveDuJour(kv, jour);
  if (!releve) throw new Refus('pas de relevé aujourd\'hui : appelle « releve » d\'abord', 409);
  const candidates = new Set(releve.lectures.map(l => l.url));
  if (choix.some(c => !candidates.has(c.url))) throw new Refus('lecture hors du relevé : choisis parmi les « lectures » du relevé', 422);
  const zones: [string, string][] = [
    ['resume', resume], ['lectures', choix.flatMap(c => [c.titre, c.pourquoi, urlDecodee(c.url)]).join('\n')],
  ];
  for (const [zone, texte] of zones) {
    const interdit = contientNomInterdit(texte, releve.nomsInterdits);
    if (interdit) throw new Refus(`nom de projet interdit : « ${interdit} » dans ${zone}`, 422);
  }

  const complet: Releve = { ...releve, resume, choix };
  await kv.hset(CLES_LIGHT.releves, jour, JSON.stringify(complet));
  if (idee) await deposer(kv, { id: 'light-' + jour, type: 'note', contenu: 'Idée de Light : ' + idee }, now);

  const alertes = releve.alertes.length;
  let envoye = false;
  const deja = await lireMessage(kv, jour);
  if (alertes && !deja?.envoye) {
    // Verrou court : deux rejeux simultanés ne peuvent pas envoyer deux fois.
    if (await kv.setnx(`light:envoi:${jour}`, '1', 120)) {
      const texte = (telegram ?? releve.alertes.map(a => a.texte).join('\n')) + '\n\n' + PIED;
      try {
        await deps.envoyer(texte, boutonVu(jour));
      } catch (e) {
        await kv.del(`light:envoi:${jour}`);
        throw new Refus(`Telegram n'a pas reçu le message (${e instanceof Error ? e.message : 'erreur'}) : rien n'est consommé`, 502);
      }
      // Les clés ne sont consommées qu'après l'envoi réussi.
      await ecrireMessage(kv, { jour, texte, cles: releve.alertes.map(a => a.cle), envoye: now, relances: [] });
      for (const a of releve.alertes) await kv.hset(CLES_LIGHT.alertes, a.cle, String(now));
      envoye = true;
    }
  }
  await etat(kv, envoye ? 'envoie le relevé sur Telegram' : 'termine le rapport du matin', 'termine', envoye ? 'Tg' : undefined);
  return { envoye, alertes };
}

async function relance(kv: KV, deps: DepsLight, now: number) {
  const jour = jourDe(now);
  const verrou = `light:relance:${jour}`;
  if (!(await kv.setnx(verrou, '1', 60))) return { relance: false, raison: 'un rappel est déjà en cours' };
  try {
    const m = await lireMessage(kv, jour);
    if (!m?.envoye) return { relance: false, raison: 'aucun message envoyé aujourd\'hui' };
    if (m.vu) return { relance: false, raison: 'déjà vu' };
    if (m.relances.length >= MAX_RELANCES) return { relance: false, raison: 'deux rappels déjà envoyés' };
    const texte = 'Rappel : ' + m.texte;
    try {
      await deps.envoyer(texte, boutonVu(jour));
    } catch (e) {
      throw new Refus(`Telegram n'a pas reçu le rappel (${e instanceof Error ? e.message : 'erreur'})`, 502);
    }
    // Relu juste avant d'écrire : un « Vu » touché pendant l'envoi est gardé.
    const actuel = (await lireMessage(kv, jour)) ?? m;
    await ecrireMessage(kv, { ...actuel, relances: [...(actuel.relances ?? []), now] });
    return { relance: true, texte };
  } finally {
    await kv.del(verrou);
  }
}

export async function marquerVu(kv: KV, jour: string, now: number = Date.now()): Promise<string> {
  const m = await lireMessage(kv, jour);
  if (!m) return 'Ce relevé n\'existe plus.';
  if (!m.vu) await ecrireMessage(kv, { ...m, vu: now });
  return 'Noté, plus de rappel aujourd\'hui.';
}

export async function traiterActionLight(
  kv: KV, action: string, corps: Record<string, unknown>, deps: DepsLight, now: number = Date.now(),
): Promise<unknown> {
  switch (action) {
    case 'releve':
      await etat(kv, 'relevé du matin', 'au travail', 'GH');
      try {
        return await calculerReleve(kv, deps, now);
      } catch (e) {
        await etatSurEchec(kv, 'relevé du matin interrompu', 'erreur');
        throw e;
      }
    case 'rapport':
      try {
        return await rapport(kv, corps, deps, now);
      } catch (e) {
        // Refus 4xx : le relevé est là, le résumé est à reprendre. 502 ou panne : erreur.
        const pause = e instanceof Refus && e.code >= 400 && e.code < 500;
        await etatSurEchec(kv, pause ? 'relevé fait, résumé à reprendre' : 'rapport du matin non envoyé', pause ? 'en pause' : 'erreur');
        throw e;
      }
    case 'relance':
      return relance(kv, deps, now);
    default:
      throw new Refus('action inconnue', 404);
  }
}
