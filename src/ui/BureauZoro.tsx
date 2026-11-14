'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { VueZoro } from '@/server/zoro/vue';
import { estMotNonLu, etiquetteTour, NON_LU } from '@/server/zoro/etiquette';
import type { Cle, DossierMac, Gravite, Projet, Tour } from '@/server/zoro/types';
import { Puce } from './Panels';
import { BureauAgent, Section } from './BureauAgent';
import { derniereSeule } from './derniere-seule';

// Le bureau de Zoro (modèle commun : BureauAgent.tsx). « Son travail » : le dernier tour en quatre cartes (failles, tests
// automatiques, clés, ton Mac). Page privée (vrais noms de dépôts), absent de /demo. Jamais un nom de fichier ni un chemin.
// Une partie qui n'a pas pu être lue est dite « non lue » ou « illisible », jamais comptée comme saine.
// Il lit /api/zoro à l'ouverture puis toutes les 60 secondes ; « Vérifier maintenant » fait un POST.

const JOUR = 86_400_000;
const ROUGE = '#d23b3b';
const TON = { rouge: ['#fdecec', '#d23b3b'], orange: ['#fff6e5', '#a06b00'], vert: ['#e8f6ee', '#2f9c5a'] } as const;
const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const jourCourt = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const jourLong = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' });
const jourHeure = (ms: number, now: number) => (Math.floor(ms / JOUR) === Math.floor(now / JOUR) ? heure(ms) : `${jourCourt(ms)}, ${heure(ms)}`);
const pluriel = (n: number, mot: string, p = `${mot}s`) => `${n} ${n > 1 ? p : mot}`;

/** Depuis combien de temps, en mots simples. */
function depuis(ms: number, now: number): string {
  const j = Math.floor((now - ms) / JOUR);
  if (j < 1) return 'moins d’un jour';
  return pluriel(j, 'jour');
}

function useVueZoro() {
  const [vue, setVue] = useState<VueZoro | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [derniere] = useState(() => derniereSeule());
  useEffect(() => {
    let arret = false;
    const lire = async () => {
      const encore = derniere.prendre();
      try {
        const r = await fetch('/api/zoro', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const v = await r.json() as VueZoro;
        if (arret || !encore()) return;
        setVue(v);
        setHorsLigne(false);
      } catch {
        if (!arret && encore()) setHorsLigne(true);
      }
    };
    void lire();
    const t = setInterval(() => { void lire(); }, 60_000);
    return () => { arret = true; clearInterval(t); };
  }, []);
  return { vue, setVue, horsLigne, setHorsLigne, derniere };
}

const Gris = ({ children }: { children: ReactNode }) => <p className="text-[8px] leading-snug text-[#6b6880]">{children}</p>;
const Ligne = ({ nom, children, alerte }: { nom: string; children: ReactNode; alerte?: boolean }) => (
  <div className="flex items-baseline gap-[6px] rounded-[6px] bg-[#faf9fc] px-[8px] py-[4px] text-[9px]">
    <span className="font-bold">{nom}</span>
    <span className={`ml-auto text-right text-[8px] ${alerte ? 'font-semibold text-[#d23b3b]' : 'text-[#6b6880]'}`}>{children}</span>
  </div>
);

// Ce qui n'a pas été lu : un nom de dépôt, ou un des mots posés par le serveur pour une partie entière.
function motNonLu(m: string): string {
  if (m === NON_LU.github) return 'GitHub n’a pas pu être lu : la liste des projets est non lue.';
  if (m === NON_LU.sansCle) return 'La clé GitHub est absente : les projets sont non lus.';
  if (m === NON_LU.cleGithub) return 'La date de la clé GitHub est non lue.';
  return `${m} : non lu`;
}

const ORDRE: Gravite[] = ['critique', 'haute', 'moyenne', 'basse'];
const NOM_GRAVITE: Record<Gravite, [string, string]> = { critique: ['critique', 'critiques'], haute: ['haute', 'hautes'], moyenne: ['moyenne', 'moyennes'], basse: ['basse', 'basses'] };

function CarteFailles({ t }: { t: Tour }) {
  return (
    <Section titre="Failles">
      <div className="space-y-[3px]">
        {t.projets.map(p => <FaillesProjet key={p.depot} p={p} />)}
        {t.nonLus.map(m => <Ligne key={m} nom={estMotNonLu(m) ? 'GitHub' : m} alerte>non lu</Ligne>)}
        {!t.projets.length && !t.nonLus.length && <Gris>Aucun projet actif.</Gris>}
      </div>
      {t.nonLus.length > 0 && <div className="mt-[3px] space-y-[1px]">{t.nonLus.map(m => <Gris key={m}>{motNonLu(m)}</Gris>)}</div>}
    </Section>
  );
}

export function FaillesProjet({ p }: { p: Projet }) {
  if (p.failles === null) return <Ligne nom={p.depot} alerte>failles illisibles</Ligne>;
  if (p.sansDependances) return <Ligne nom={p.depot}>aucune dépendance trouvée</Ligne>;
  if (!p.failles.length) return <Ligne nom={p.depot}>aucune faille connue</Ligne>;
  const compte = ORDRE.flatMap(g => { const n = p.failles!.filter(f => f.gravite === g).length; return n ? [`${n} ${NOM_GRAVITE[g][n > 1 ? 1 : 0]}`] : []; });
  const grave = p.failles.some(f => f.directeProd && (f.gravite === 'critique' || f.gravite === 'haute'));
  return (
    <details className="rounded-[6px] bg-[#faf9fc] px-[8px] py-[4px] text-[9px]">
      <summary className="flex cursor-pointer items-baseline gap-[6px]">
        <span className="font-bold">{p.depot}</span>
        <span className={`ml-auto text-right text-[8px] ${grave ? 'font-semibold text-[#d23b3b]' : 'text-[#6b6880]'}`}>{compte.join(', ')}</span>
      </summary>
      <div className="mt-[3px] space-y-[1px] text-[8px] leading-snug">
        {[...p.failles].sort((a, b) => ORDRE.indexOf(a.gravite) - ORDRE.indexOf(b.gravite)).map(f => (
          <div key={`${f.id}-${f.paquet}`} className="flex gap-[6px]">
            <span className="font-semibold">{f.paquet} {f.version}</span>
            <span className="text-[#6b6880]">{f.gravite}{f.directeProd ? '' : ' · seulement pour travailler'}</span>
            <span className="ml-auto text-[#6b6880]">{f.corrigeeEn ? `corrigée en ${f.corrigeeEn}` : 'correctif non trouvé'}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

// Le nombre d'échecs sur les derniers passages terminés (30 au plus), vert ou rouge.
const surPassages = (echecs: number, passages: number) => `${pluriel(echecs, 'échec')} sur ${pluriel(passages, 'passage')}`;

// Exportées pour les tests de rendu (bureau-zoro.test.ts).
export function CarteTests({ t }: { t: Tour }) {
  const github = t.nonLus.includes(NON_LU.github) || t.nonLus.includes(NON_LU.sansCle);
  const depotsNonLus = t.nonLus.filter(m => !estMotNonLu(m));
  const vide = !t.projets.length && !depotsNonLus.length && !github;
  return (
    <Section titre="Tests automatiques">
      <div className="space-y-[3px]">
        {t.projets.map(p => {
          const ci = p.ci;
          return ci.etat === 'vert' ? <Ligne key={p.depot} nom={p.depot}>tout passe · {surPassages(ci.echecs, ci.passages)}</Ligne>
            : ci.etat === 'rouge' ? <Ligne key={p.depot} nom={p.depot} alerte>en échec depuis le {jourCourt(ci.depuis)} · {surPassages(ci.echecs, ci.passages)}</Ligne>
            : ci.etat === 'sans-tests' ? <Ligne key={p.depot} nom={p.depot}>pas de tests</Ligne>
            : <Ligne key={p.depot} nom={p.depot} alerte>illisible ({ci.raison})</Ligne>;
        })}
        {depotsNonLus.map(m => <Ligne key={m} nom={m} alerte>non lu</Ligne>)}
        {github && <Ligne nom="GitHub" alerte>non lu</Ligne>}
        {vide && <Gris>Aucun projet actif.</Gris>}
      </div>
    </Section>
  );
}

function texteCle(c: Cle, now: number): { t: string; alerte?: boolean } {
  if (c.etat === 'non-connecte') return { t: 'non connecté' };
  if (c.etat === 'sans-date' || c.expire === null) return { t: 'sans date d’échéance' };
  if (c.etat === 'expiree') return { t: `expirée depuis le ${jourCourt(c.expire)}`, alerte: true };
  const n = Math.max(1, Math.ceil((c.expire - now) / JOUR));
  return { t: `dans ${pluriel(n, 'jour')} (${jourCourt(c.expire)})`, alerte: c.etat === 'bientot' };
}

function CarteCles({ t, now }: { t: Tour; now: number }) {
  const sansGitHub = !t.cles.some(c => c.nom === 'GitHub (lecture)');
  return (
    <Section titre="Clés">
      <div className="space-y-[3px]">
        {sansGitHub && <Ligne nom="GitHub (lecture)" alerte>non lue</Ligne>}
        {t.cles.map(c => { const x = texteCle(c, now); return <Ligne key={c.nom} nom={c.nom} alerte={x.alerte}>{x.t}</Ligne>; })}
      </div>
    </Section>
  );
}

const aRisque = (d: DossierMac) => !!d.illisible || d.nonEnregistres > 0 || d.nonPousses > 0 || (d.git && !d.distant);
// Les stashes : comptés et montrés, jamais une alerte (spec § 9.4).
const misDeCote = (d: DossierMac) => (d.stashes ? `${pluriel(d.stashes, 'changement')} mis de côté` : null);
function detailDossier(d: DossierMac, now: number): string {
  if (d.illisible) return 'non lu';
  const m: string[] = [];
  if (d.nonEnregistres) m.push(`${pluriel(d.nonEnregistres, 'changement')} pas enregistré${d.nonEnregistres > 1 ? 's' : ''}${d.plusAncienNonEnregistre ? ` depuis ${depuis(d.plusAncienNonEnregistre, now)}` : ''}`);
  if (d.nonPousses) m.push(`${pluriel(d.nonPousses, 'enregistrement')} pas envoyé${d.nonPousses > 1 ? 's' : ''} sur GitHub${d.plusAncienNonPousse ? ` depuis ${depuis(d.plusAncienNonPousse, now)}` : ''}`);
  if (d.git && !d.distant) m.push('jamais envoyé sur GitHub');
  const cote = misDeCote(d);
  if (cote) m.push(cote);
  return m.join(' · ');
}
// Un dossier sans risque : son compte (git) ou « pas suivi par git » avec sa date de modification (spec § 9.3).
function inventaire(d: DossierMac): string {
  const base = d.git ? (d.compte ?? 'compte inconnu') : `pas suivi par git · modifié le ${jourCourt(d.modifie)}`;
  const cote = misDeCote(d);
  return cote ? `${base} · ${cote}` : base;
}

export function CarteMac({ t, now }: { t: Tour; now: number }) {
  const mac = t.mac;
  const dossiers = mac?.dossiers ?? [];
  const risque = dossiers.filter(aRisque);
  const reste = dossiers.filter(d => !aRisque(d));
  return (
    <Section titre="Sur ton Mac">
      {(t.macVieux || !mac) && (
        <p className="mb-[3px] text-[8px] font-semibold" style={{ color: ROUGE }}>
          {mac ? `Mac pas vu depuis ${depuis(mac.quand, now)}.` : 'Mac pas vu depuis le début : aucun rapport reçu.'}
        </p>
      )}
      {mac ? (
        <div className="space-y-[3px]">
          {risque.map(d => <Ligne key={d.nom} nom={d.nom} alerte>{detailDossier(d, now)}</Ligne>)}
          {reste.map(d => <Ligne key={d.nom} nom={d.nom}>{inventaire(d)}</Ligne>)}
          {!dossiers.length && <Gris>Aucun dossier dans le rapport.</Gris>}
        </div>
      ) : <Gris>Tout ce qui est sur ton Mac est non lu pour l’instant.</Gris>}
    </Section>
  );
}

function Panneau() {
  const maintenant = useQG(s => s.vues?.maintenant);
  const { vue, setVue, horsLigne, setHorsLigne, derniere } = useVueZoro();
  const [local] = useState(() => Date.now());
  const now = maintenant ?? local;
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const verifier = async () => {
    setEnCours(true);
    setMessage(null);
    const encore = derniere.prendre();
    try {
      const r = await fetch('/api/zoro', { method: 'POST', cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const v = await r.json() as VueZoro & { occupe?: true };
      if (v.occupe) setMessage('Un tour est déjà en cours.');
      if (encore()) { setVue({ dernier: v.dernier, prochain: v.prochain, historique: v.historique }); setHorsLigne(false); }
    } catch {
      setMessage('La vérification n’a pas pu se faire.');
    } finally {
      setEnCours(false);
    }
  };

  const etat = (
    <span className="flex items-center gap-[6px]">
      {message && <span className="text-[8px] font-semibold" style={{ color: ROUGE }}>{message}</span>}
      {horsLigne && <span className="text-[8px] font-semibold" style={{ color: ROUGE }}>Pas de connexion au serveur.</span>}
      <button onClick={() => { void verifier(); }} disabled={enCours}
        className="rounded-[6px] bg-[#1d1b2e] px-[8px] py-[3px] text-[8px] font-semibold text-white disabled:opacity-50">
        {enCours ? 'Vérification…' : 'Vérifier maintenant'}
      </button>
    </span>
  );
  const t = vue?.dernier ?? null;
  return (
    <BureauAgent agent="zoro" cle="bureau-zoro" etat={etat}>
      {!vue ? <Gris>{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</Gris> : (
        <div className="space-y-[10px]">
          <p className="text-[8px] text-[#6b6880]">
            {t ? <>Dernier tour : {jourHeure(t.quand, now)}{t.type === 'verifier' ? ' (vérification à la demande)' : ''}.</> : 'Zoro n’a encore fait aucun tour.'}
            {' '}Prochain tour : {jourLong(vue.prochain)} à {heure(vue.prochain)}.
          </p>
          {t && (
            <div className="flex flex-wrap gap-[4px]">
              <Puce c={TON[etiquetteTour(t).ton][0]} t={TON[etiquetteTour(t).ton][1]}>{etiquetteTour(t).texte}</Puce>
            </div>
          )}
          {t ? (
            <div className="grid grid-cols-2 gap-x-[14px] gap-y-[10px] max-[900px]:grid-cols-1">
              <CarteFailles t={t} />
              <CarteTests t={t} />
              <CarteCles t={t} now={now} />
              <CarteMac t={t} now={now} />
            </div>
          ) : <Gris>Touche « Vérifier maintenant » pour lancer un premier tour.</Gris>}
          {vue.historique.length > 0 && (
            <Gris>Les derniers mardis : {vue.historique.map(h => `${jourCourt(h.quand)} (${h.importants})`).join(' · ')}.</Gris>
          )}
        </div>
      )}
    </BureauAgent>
  );
}

export function BureauZoro() {
  const ouvert = useQG(s => s.volet?.type === 'bureauZoro');
  return <AnimatePresence>{ouvert && <Panneau key="bureau-zoro" />}</AnimatePresence>;
}
