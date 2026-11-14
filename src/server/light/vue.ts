import type { KV } from '../memoire';
import type { MessageJour } from './api';
import { CLES_LIGHT, jourDe, type Ligne, type Releve } from './releve';
import { serieMajeure, versionMin } from './versions';

// Ce que la page de Light affiche, regroupé par projet, avec les vrais noms (décision du 9 novembre 2026).
// Cette page est privée (protection Vercel) ; le panneau est absent de /demo, la page qui se filme.
// Jamais de dépôt complet, de chemin de fichier ni de clé d'alerte : seulement des noms d'affichage et des phrases.

export type OutilVue = { paquet: string; utilisee: string; derniere?: string; ecart: number; ou?: string };
export type ProjetVue = { nom: string; genres: string[]; alertes: string[]; outils: OutilVue[] };

export type VueLight = {
  jour: string | null;
  aJour: boolean;
  quand?: number;
  resume?: string;
  lectures: { titre: string; url: string; pourquoi: string }[];
  projets: ProjetVue[];
  general: string[];
  message: { etat: 'rien' | 'envoye' | 'vu' | 'relance'; heure?: number };
  historique: { jour: string; alertes: number; vu: boolean }[];
  comptesNonLus: string[];
};

const JOURS_HISTORIQUE = 7;

const NOMS_AFFICHES: Record<string, string> = {
  app_livraison: 'Livreo', projet_terra: 'Terra', mon_portfolio: 'Portfolio',
  'boutique-shop': 'Boutique Shop', duolingo_clone: 'Duolingo (clone)', qg: 'QG',
};

/** « moi/app_livraison » → « Livreo » ; un dépôt inconnu : sans préfixe projet_/app_/mon_, mots capitalisés. */
export function nomAffiche(depot: string): string {
  const court = depot.split('/').pop() ?? depot;
  const connu = NOMS_AFFICHES[court.toLowerCase()];
  if (connu) return connu;
  return court.replace(/^(projet_|app_|mon_)/i, '').split(/[_-]+/).filter(Boolean)
    .map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(' ') || court;
}

const NOMS_OUTILS: Record<string, string> = {
  expo: 'Expo', 'expo-router': 'Expo Router', next: 'Next.js', react: 'React', 'react-native': 'React Native', node: 'Node.js',
  typescript: 'TypeScript', tailwindcss: 'Tailwind CSS', prisma: 'Prisma', zustand: 'Zustand', three: 'Three.js',
};
const outil = (p: string) => NOMS_OUTILS[p] ?? p;
const PRODUIT_DE: Record<string, string> = { node: 'nodejs', next: 'nextjs', 'react-native': 'react-native' };
const SANS_RETARD = new Set(['expo-router']);

const cycleDe = (paquet: string, utilisee: string): string | null => {
  const v = versionMin(utilisee);
  return v ? (paquet === 'node' ? String(v.parties[0]) : serieMajeure(v)) : null;
};
const serieDe = (utilisee: string) => { const v = versionMin(utilisee); return v ? serieMajeure(v) : utilisee; };
const serieDerniere = (d: string) => { const v = versionMin(d); return v ? serieMajeure(v) : d; };

function projetsDe(r: Releve): ProjetVue[] {
  const parDepot = new Map<string, Ligne[]>();
  for (const l of r.lignes) parDepot.set(l.depot, [...(parDepot.get(l.depot) ?? []), l]);
  const finParCle = new Map(r.alertes.filter(a => a.type === 'fin').map(a => [a.cle, a.texteAnonyme]));

  const projets = [...parDepot].map(([depot, lignes]): ProjetVue => {
    const outils: (OutilVue & { _ous: Set<string> })[] = [];
    for (const l of lignes) {
      const ou = l.fichier.includes('/') ? l.fichier.replace(/\/?package\.json$/, '') : '';
      const existant = outils.find(o => o.paquet === l.paquet && o.utilisee === l.utilisee);
      if (existant) { if (ou) existant._ous.add(ou); continue; }
      outils.push({ paquet: l.paquet, utilisee: l.utilisee, ...(l.derniere ? { derniere: l.derniere } : {}), ecart: l.ecart, _ous: new Set(ou ? [ou] : []) });
    }
    const plusieurs = new Set(lignes.map(l => l.fichier)).size > 1;
    const alertes = new Set<string>();
    for (const o of outils) {
      // comme le relevé : pas d'alerte de retard pour expo-router ni pour un outil en 0.x (l'écart reste dans le tableau)
      if (o.ecart < 2 || !o.derniere || SANS_RETARD.has(o.paquet) || o.utilisee.startsWith('0.')) continue;
      const lieu = plusieurs && o._ous.size ? ` dans ${[...o._ous].join(', ')}` : '';
      alertes.add(`${outil(o.paquet)} ${serieDe(o.utilisee)} → ${serieDerniere(o.derniere)} (${o.ecart} versions de retard)${lieu}`);
    }
    for (const l of lignes) {
      const produit = PRODUIT_DE[l.paquet], cycle = produit ? cycleDe(l.paquet, l.utilisee) : null;
      const texte = produit && cycle ? finParCle.get(`fin:${produit}:${cycle}`) : undefined;
      if (texte) alertes.add(texte.replace(/\.$/, ''));
    }
    return {
      nom: nomAffiche(depot),
      genres: [...new Set(lignes.map(l => l.genre))],
      alertes: [...alertes],
      outils: outils.map(({ _ous, ...o }) => ({ ...o, ...(_ous.size ? { ou: [..._ous].join(', ') } : {}) })),
    };
  });
  return projets.sort((a, b) => b.alertes.length - a.alertes.length || a.nom.localeCompare(b.nom, 'fr'));
}

function generalDe(r: Releve): string[] {
  const phrases = r.alertes.filter(a => a.type === 'majeure').map(a => {
    const [, paquet, serie] = a.cle.split(':');
    return paquet && serie ? `${outil(paquet)} ${serie} est sorti` : a.texteAnonyme.replace(/\.$/, '');
  });
  return [...new Set(phrases)];
}

/** Remplace chaque étiquette « projet A » par le nom d'affichage du dépôt correspondant. */
function sansEtiquettes(r: Releve): (t: string) => string {
  const noms = new Map<string, string>();
  for (const l of r.lignes) noms.set(l.etiquette, nomAffiche(l.depot));
  // « le projet A » → « Livreo », « du projet A » → « de Livreo », « au projet A » → « à Livreo », « projet A » → « Livreo »
  const article: Record<string, string> = { le: '', du: 'de ', au: 'à ' };
  return t => [...noms].reduce((acc, [e, n]) => {
    const lettre = e.replace(/^projet\s+/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return acc.replace(new RegExp(`(?:\\b(le|du|au)\\s+)?projet\\s+${lettre}(?![A-Za-z0-9])`, 'gi'), (_m, art?: string) => {
      const pre = art ? article[art.toLowerCase()] : '';
      const debut = art && art[0] === art[0].toUpperCase();
      return debut && pre ? pre[0].toUpperCase() + pre.slice(1) + n : pre + n;
    });
  }, t);
}

function lire<T>(brut: unknown): T {
  return (typeof brut === 'string' ? JSON.parse(brut) : brut) as T;
}

function etatMessage(m: MessageJour | undefined): VueLight['message'] {
  if (m?.vu) return { etat: 'vu', heure: m.vu };
  if (m?.relances?.length) return { etat: 'relance', heure: m.relances[m.relances.length - 1] };
  if (m?.envoye) return { etat: 'envoye', heure: m.envoye };
  return { etat: 'rien' };
}

export async function vueLight(kv: KV, now: number = Date.now()): Promise<VueLight> {
  const brutes = await kv.hgetall(CLES_LIGHT.releves);
  const jours = Object.keys(brutes).sort().reverse();
  const messages = await kv.hgetall(CLES_LIGHT.messages);
  const message = (jour: string) => (messages[jour] ? lire<MessageJour>(messages[jour]) : undefined);

  const historique = jours.slice(0, JOURS_HISTORIQUE).map(jour => {
    const r = lire<Releve>(brutes[jour]);
    const m = message(jour);
    return { jour, alertes: m?.envoye ? m.cles.length : r.alertes.length, vu: Boolean(m?.vu) };
  });

  if (!jours.length) {
    return { jour: null, aJour: false, lectures: [], projets: [], general: [], message: { etat: 'rien' }, historique, comptesNonLus: [] };
  }

  const jour = jours[0];
  const r = lire<Releve>(brutes[jour]);
  const nommer = sansEtiquettes(r);

  return {
    jour,
    aJour: jour === jourDe(now),
    quand: r.quand,
    ...(r.resume ? { resume: nommer(r.resume) } : {}),
    // une lecture dont l'adresse ne commence pas par https n'est jamais montrée
    lectures: (r.choix ?? []).flatMap(c =>
      typeof c.url === 'string' && c.url.startsWith('https://') && c.titre && c.pourquoi
        ? [{ titre: nommer(c.titre), url: c.url, pourquoi: nommer(c.pourquoi) }] : []),
    projets: projetsDe(r),
    general: generalDe(r),
    message: etatMessage(message(jour)),
    historique,
    comptesNonLus: [...r.comptesNonLus],
  };
}
