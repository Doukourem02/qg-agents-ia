'use client';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { useQG } from '@/store';
import { agentById } from '@/sim/routing';
import { NOM_STATUT, prochainEnMots, quandCourt, regrouper, resume, type GroupeJour, type LigneJournal } from '@/data/journal';
import type { EtatAgent } from '@/server/vues';
import { Fermer, Puce, Tete } from './Panels';
import { ListeIgnores } from './Silence';

// Le même « bureau » pour chaque agent réel (L, Light, Clara), dans le même ordre :
//   1. l'en-tête : nom, rôle, état (au travail / au repos / bloqué), dernier et prochain passage ;
//   2. « Ce qui t'attend » : ce que l'agent attend de moi ;
//   3. « Son travail » : le contenu propre à l'agent (sujets et posts de L, relevé de Light, ménage de Clara) ;
//   4. « Son journal » : ce qu'il a fait, par jour.
// L'état, l'attente et le journal viennent de /api/qg/vues (store `vues`) ; « Son travail » garde sa propre lecture.

const ROUGE = '#d23b3b';
const STATUT: Record<EtatAgent['statut'], { c: string; t: string }> = {
  'au travail': { c: '#e0a42a', t: '#fff' },
  'au repos': { c: '#f1f0f5', t: '#6b6880' },
  bloque: { c: ROUGE, t: '#fff' },
};
const JOURNAL_MAX = 30;

const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });

export function Section({ titre, n, children }: { titre: string; n?: number; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-[5px] border-b border-[#f1f0f5] pb-[2px] text-[9.5px] font-bold">
        {titre}{n !== undefined && <span className="font-normal text-[#6b6880]"> ({n})</span>}
      </h3>
      {children}
    </section>
  );
}

const Gris = ({ children }: { children: ReactNode }) => <p className="text-[8px] leading-snug text-[#6b6880]">{children}</p>;

/** Une ligne du journal : l'heure, la tâche (×n si fusionnée), le résultat. */
export function LigneFaite({ l, avecNom }: { l: LigneJournal; avecNom?: boolean }) {
  return (
    <div className="flex items-baseline gap-[5px] py-[2px] text-[8px] leading-snug">
      <span className="w-[54px] shrink-0 text-[7px] tabular-nums text-[#6b6880]">{l.n > 1 && heure(l.depuis) !== heure(l.quand) ? `${heure(l.depuis)}–${heure(l.quand)}` : heure(l.quand)}</span>
      <span className="min-w-0 flex-1">
        {avecNom && <b>{agentById(l.agent)?.nom ?? l.agent} · </b>}
        <span title={l.resultat ? l.texte : undefined} className={l.erreur ? 'font-semibold text-[#e0753f]' : l.resultat ? 'text-[#2f9c5a]' : ''}>{resume(l)}</span>
      </span>
    </div>
  );
}

/** Les jours du journal, avec leur titre (« Aujourd’hui », « Hier », « lun. 9 nov. »). */
export function Jours({ jours, parAgent }: { jours: GroupeJour[]; parAgent?: boolean }) {
  return (
    <div className="space-y-[6px]">
      {jours.map(j => (
        <div key={j.jour}>
          <div className="mb-[2px] text-[7px] font-semibold uppercase tracking-[.06em] text-[#6b6880]">{j.titre}</div>
          {j.agents.map(a => parAgent ? (
            <div key={a.agent} className="mb-[3px] flex gap-[6px] rounded-[6px] bg-[#faf9fc] px-[5px] py-[3px]">
              <Tete id={a.agent} size={14} />
              <div className="min-w-0 flex-1">
                <div className="text-[7.5px] font-bold">{agentById(a.agent)?.nom ?? a.agent}</div>
                {a.lignes.map((l, i) => <LigneFaite key={`${l.quand}-${i}`} l={l} />)}
              </div>
            </div>
          ) : a.lignes.map((l, i) => <LigneFaite key={`${a.agent}-${l.quand}-${i}`} l={l} />))}
        </div>
      ))}
    </div>
  );
}

/**
 * Le panneau d'un bureau. `etat` : une ligne propre à l'agent dans l'en-tête (LinkedIn connecté, Gmail…) ;
 * `children` : « Son travail ».
 */
export function BureauAgent({ agent, cle, etat, children }: { agent: string; cle: string; etat?: ReactNode; children: ReactNode }) {
  const ouvrir = useQG(s => s.ouvrir);
  const haut = useQG(s => s.format === 'haut');
  const vues = useQG(s => s.vues);
  const horsLigne = useQG(s => s.vuesHorsLigne);
  const a = agentById(agent);
  const nom = a?.nom ?? agent;
  const e = vues?.agents.find(x => x.agent === agent);
  const now = vues?.maintenant ?? 0;
  const attente = vues?.taches.enAttente.filter(x => x.agent === agent) ?? [];
  // ce que j'ai dit d'ignorer sur Telegram : toujours visible ici, avec depuis quand
  const ignores = vues?.silence?.ignores.filter(x => x.agent === agent) ?? [];
  const aujourdhui = vues ? vues.calendrier.jours[vues.calendrier.aujourdhui] : '';
  const jours = vues ? regrouper(vues.taches.faites.filter(x => x.agent === agent), aujourdhui, JOURNAL_MAX) : [];
  const lecture = horsLigne && !vues ? 'Pas de connexion au serveur.' : 'Lecture…';
  return (
    <motion.div key={cle} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
      className={`qg-panel absolute flex flex-col p-[12px] ${haut ? 'bottom-[66px] left-[8px] right-[8px] top-[50px]' : 'left-[calc(50%-395px)] top-[56px] h-[552px] w-[790px]'}`}>
      <header className="mb-[8px] shrink-0">
        <div className="flex items-center gap-[8px]">
          <Tete id={agent} size={22} />
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[16px] italic leading-tight">Le bureau de {nom}</h2>
            <div className="truncate text-[7.5px] text-[#6b6880]">{a?.role}</div>
          </div>
          {e && <Puce c={STATUT[e.statut].c} t={STATUT[e.statut].t}>{NOM_STATUT[e.statut]}</Puce>}
          <Fermer onClick={() => ouvrir(null)} />
        </div>
        <div className="mt-[4px] flex flex-wrap items-center gap-x-[12px] gap-y-[2px] text-[8px]">
          {e ? (<>
            {e.statut === 'au travail' && e.tache && <span><span className="text-[#6b6880]">En ce moment : </span><b>{e.tache}</b></span>}
            <span><span className="text-[#6b6880]">Dernier passage : </span>{e.dernierPassage ? quandCourt(e.dernierPassage.quand, now) : 'aucun pour l’instant'}</span>
            {e.pause ? <b className="text-[#6b6880]">{e.pause}</b> : e.note ? <b style={{ color: ROUGE }}>{e.note}</b> : <span><span className="text-[#6b6880]">Prochain passage : </span>{prochainEnMots(e, now) ?? 'aucun prévu'}</span>}
          </>) : <span className="text-[#6b6880]">{lecture}</span>}
          {horsLigne && vues && <span className="font-semibold" style={{ color: ROUGE }}>Hors ligne : dernière lecture affichée.</span>}
          {etat && <span className="ml-auto">{etat}</span>}
        </div>
        {e?.statut === 'bloque' && (
          <div className="mt-[5px] rounded-[6px] px-[8px] py-[4px] text-[8px] font-semibold text-white" style={{ background: ROUGE }}>
            Le dernier passage prévu aujourd’hui n’a pas eu lieu (routine bloquée ?) · voir le Calendrier
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 space-y-[12px] overflow-y-auto pr-[4px]">
        <Section titre="Ce qui t’attend" n={vues ? attente.length : undefined}>
          {!vues ? <Gris>{lecture}</Gris> : attente.length ? (
            <div className="flex flex-wrap gap-[4px]">
              {attente.map(x => (
                <span key={x.texte} className="flex items-center gap-[4px] rounded-[6px] bg-[#fff6e5] px-[6px] py-[3px] text-[8px] font-semibold" style={{ boxShadow: 'inset 2.5px 0 0 #e0a42a' }}>
                  {x.texte}{x.nombre ? <Puce c="#1d1b2e" t="#fff">{x.nombre}</Puce> : null}
                </span>
              ))}
            </div>
          ) : <Gris>Rien à faire pour toi.</Gris>}
          {ignores.length > 0 && <div className="mt-[5px]"><ListeIgnores ignores={ignores} now={now} /></div>}
        </Section>
        <Section titre="Son travail">{children}</Section>
        <Section titre="Son journal">
          {!vues ? <Gris>{lecture}</Gris> : jours.length ? <Jours jours={jours} /> : <Gris>Rien dans le journal ces 7 derniers jours.</Gris>}
        </Section>
      </div>
    </motion.div>
  );
}
