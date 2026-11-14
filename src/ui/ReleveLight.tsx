'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { VueLight } from '@/server/light/vue';
import { Puce, Titre } from './Panels';
import { BureauAgent } from './BureauAgent';

// Le bureau de Light (modèle commun : BureauAgent.tsx). « Son travail » : le relevé du matin, regroupé par projet,
// avec les vrais noms (page privée ; le panneau n'existe pas dans /demo).
// Il lit /api/light à l'ouverture puis toutes les 20 secondes.

const VIOLET = '#7a5bd6';

// Heure d'Abidjan = UTC
const heure = (ms: number) => {
  const d = new Date(ms), h = d.getUTCHours(), m = d.getUTCMinutes();
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};
const jourCourt = (jour: string) => new Date(`${jour}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function useVueLight() {
  const [vue, setVue] = useState<VueLight | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  // numéro de la dernière lecture : une réponse plus ancienne n'écrase jamais un état plus frais
  const derniere = useRef(0);
  const lire = useCallback(async () => {
    const n = ++derniere.current;
    try {
      const r = await fetch('/api/light', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const v = await r.json() as VueLight;
      if (n !== derniere.current) return;
      setVue(v);
      setHorsLigne(false);
    } catch {
      if (n === derniere.current) setHorsLigne(true);
    }
  }, []);
  useEffect(() => {
    let arret = false;
    const tour = () => { if (!arret) void lire(); };
    tour();
    const t = setInterval(tour, 20_000);
    return () => { arret = true; clearInterval(t); };
  }, [lire]);
  return { vue, horsLigne };
}

function etatMessage(m: VueLight['message']): string {
  if (m.etat === 'vu' && m.heure) return `vu à ${heure(m.heure)}`;
  if (m.etat === 'relance' && m.heure) return `relancé à ${heure(m.heure)}`;
  if (m.etat === 'envoye' && m.heure) return `envoyé à ${heure(m.heure)}`;
  return 'rien d’important';
}

const couleurEcart = (e: number) => (e >= 2 ? '#d23b3b' : e === 1 ? '#e0753f' : '#6b6880');

function Entete({ vue, horsLigne }: { vue: VueLight | null; horsLigne: boolean }) {
  if (horsLigne) return <span className="text-[8px] font-semibold text-[#d23b3b]">Pas de connexion au serveur.</span>;
  if (!vue) return null;
  if (!vue.jour || !vue.quand) return <span className="text-[8px] text-[#6b6880]">Pas de relevé aujourd’hui</span>;
  return vue.aJour
    ? <span className="text-[8px] font-semibold text-[#2f9c5a]">Relevé de {heure(vue.quand)}</span>
    : <span className="text-[8px] font-semibold text-[#e0753f]">Pas de relevé aujourd’hui · dernier relevé du {jourCourt(vue.jour)}</span>;
}

const GENERAL = '\u0000general';

function Detail({ vue, cle }: { vue: VueLight; cle: string }) {
  if (cle === GENERAL) {
    return (
      <div>
        <h3 className="mb-[4px] text-[10px] font-bold">Général</h3>
        {vue.general.length
          ? <ul className="space-y-[3px]">{vue.general.map((g, i) => <li key={i} className="rounded-[6px] bg-[#faf9fc] px-[6px] py-[4px] text-[8px] leading-snug" style={{ boxShadow: 'inset 2.5px 0 0 #e0753f' }}>{g}</li>)}</ul>
          : <p className="text-[8px] leading-snug text-[#6b6880]">Rien de nouveau dans les outils suivis.</p>}
        <h3 className="mb-[4px] mt-[10px] text-[9px] font-bold">À lire</h3>
        {vue.lectures.length ? (
          <div className="space-y-[4px]">
            {vue.lectures.map((l, i) => (
              <div key={i} className="rounded-[6px] bg-[#faf9fc] px-[6px] py-[4px]">
                <a href={l.url} target="_blank" rel="noreferrer" className="text-[8px] font-semibold leading-tight underline" style={{ color: VIOLET }}>{l.titre}</a>
                <p className="mt-[2px] text-[7.5px] leading-snug text-[#6b6880]">{l.pourquoi}</p>
              </div>
            ))}
          </div>
        ) : <p className="text-[8px] leading-snug text-[#6b6880]">Pas de lecture aujourd’hui.</p>}
        <Titre><span className="uppercase">Sept jours</span></Titre>
        {vue.historique.length ? (
          <ul className="space-y-[2px]">
            {vue.historique.map(h => (
              <li key={h.jour} className="flex items-center gap-[4px] text-[7.5px]">
                <span className="w-[42px] text-[#6b6880]">{jourCourt(h.jour)}</span>
                <span className="flex-1">{h.alertes ? `${h.alertes} alerte${h.alertes > 1 ? 's' : ''}` : 'rien'}</span>
                {h.vu && <Puce c="#2fbf5b" t="#fff">vu</Puce>}
              </li>
            ))}
          </ul>
        ) : <p className="text-[7.5px] text-[#6b6880]">Pas encore d’historique.</p>}
      </div>
    );
  }
  const p = vue.projets.find(x => x.nom === cle);
  if (!p) return null;
  const aOu = p.outils.some(o => o.ou);
  return (
    <div>
      <h3 className="mb-[4px] text-[10px] font-bold">{p.nom} <span className="font-normal text-[#6b6880]">· {p.genres.join(', ')}</span></h3>
      {p.alertes.length
        ? <ul className="space-y-[3px]">{p.alertes.map((a, i) => <li key={i} className="rounded-[6px] bg-[#faf9fc] px-[6px] py-[4px] text-[8px] leading-snug" style={{ boxShadow: 'inset 2.5px 0 0 #d23b3b' }}>{a}</li>)}</ul>
        : <p className="text-[8px] leading-snug text-[#6b6880]">Rien d’important à signaler.</p>}
      <h3 className="mb-[4px] mt-[10px] text-[9px] font-bold">Les outils <span className="font-normal text-[#6b6880]">({p.outils.length})</span></h3>
      {p.outils.length ? (
        <table className="w-full table-fixed border-separate border-spacing-y-[2px] text-left text-[7.5px]">
          <thead>
            <tr className="text-[6.5px] font-semibold text-[#6b6880]">
              <th className="w-[30%] font-semibold">Outil</th>{aOu && <th className="w-[28%] font-semibold">Où</th>}<th className="font-semibold">Utilisée → dernière</th>
            </tr>
          </thead>
          <tbody>
            {p.outils.map((o, i) => (
              <tr key={i} className="bg-[#faf9fc]">
                <td className="truncate rounded-l-[5px] px-[5px] py-[3px] font-semibold">{o.paquet}</td>
                {aOu && <td className="truncate px-[3px] text-[#6b6880]">{o.ou ?? '·'}</td>}
                <td className="truncate rounded-r-[5px] px-[3px]" style={{ color: couleurEcart(o.ecart), fontWeight: o.ecart > 0 ? 600 : 400 }}>
                  {o.utilisee}{o.derniere ? ` → ${o.derniere}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-[8px] leading-snug text-[#6b6880]">Aucune version relevée.</p>}
    </div>
  );
}

function Carte({ actif, onClick, titre, chips, badge, grave }: { actif: boolean; onClick: () => void; titre: string; chips?: string[]; badge: number; grave: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={actif}
      className={`flex w-full items-center gap-[6px] rounded-[8px] px-[8px] py-[5px] text-left ${actif ? 'bg-[#efeafb]' : 'bg-[#faf9fc] hover:bg-[#f4f1fa]'}`}
      style={actif ? { boxShadow: `inset 0 0 0 1.5px ${VIOLET}` } : undefined}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[9px] font-bold">{titre}</span>
        {!!chips?.length && <span className="mt-[2px] flex flex-wrap gap-[3px]">{chips.map(c => <span key={c} className="rounded-full bg-[#f1f0f5] px-[5px] text-[6.5px] text-[#6b6880]">{c}</span>)}</span>}
      </span>
      <span className="min-w-[16px] rounded-full px-[5px] text-center text-[8px] font-bold" style={grave ? { background: '#d23b3b', color: '#fff' } : { background: '#e6e4ec', color: '#6b6880' }}>{badge}</span>
    </button>
  );
}

function Contenu({ vue, haut }: { vue: VueLight; haut: boolean }) {
  const [choix, setChoix] = useState<string | null>(null);
  const cles = [...vue.projets.map(p => p.nom), GENERAL];
  const cle = choix && cles.includes(choix) ? choix : cles[0];
  const nbGeneral = vue.general.length + vue.lectures.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[8px]">
      <div className="shrink-0">
        {vue.resume && <p className="mb-[6px] font-serif text-[9px] italic leading-snug">{vue.resume}</p>}
        <div className="flex flex-wrap items-center gap-[8px]">
          <Puce c={vue.message.etat === 'vu' ? '#2fbf5b' : vue.message.etat === 'relance' ? '#e0a42a' : '#f1f0f5'} t={vue.message.etat === 'vu' || vue.message.etat === 'relance' ? '#fff' : '#6b6880'}>
            {etatMessage(vue.message)}
          </Puce>
          {vue.comptesNonLus.map(c => <span key={c} className="text-[7.5px] font-semibold text-[#e0753f]">compte non lu : {c}</span>)}
        </div>
      </div>
      <div className={`grid min-h-0 flex-1 gap-[12px] ${haut ? 'grid-rows-[auto_1fr]' : 'grid-cols-[230px_1fr]'}`}>
        <div className={`min-h-0 space-y-[4px] overflow-y-auto ${haut ? 'max-h-[40%]' : ''}`}>
          {vue.projets.map(p => (
            <Carte key={p.nom} actif={cle === p.nom} onClick={() => setChoix(p.nom)} titre={p.nom} chips={p.genres}
              badge={p.alertes.length} grave={p.alertes.length > 0} />
          ))}
          <Carte actif={cle === GENERAL} onClick={() => setChoix(GENERAL)} titre="Général" badge={nbGeneral} grave={false} />
        </div>
        <div className="min-h-0 min-w-0 overflow-y-auto pr-[4px]"><Detail vue={vue} cle={cle} /></div>
      </div>
    </div>
  );
}

function Panneau() {
  const haut = useQG(s => s.format === 'haut');
  const { vue, horsLigne } = useVueLight();
  return (
    <BureauAgent agent="light" cle="releve-light" etat={<Entete vue={vue} horsLigne={horsLigne} />}>
      <p className="mb-[6px] text-[8px] leading-snug">Chaque matin, Light vérifie si les outils de tes projets ont du retard.</p>
      {vue
        ? <div className={`flex flex-col ${haut ? 'h-[420px]' : 'h-[340px]'}`}><Contenu vue={vue} haut={haut} /></div>
        : <p className="text-[8px] text-[#6b6880]">{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</p>}
    </BureauAgent>
  );
}

export function ReleveLight() {
  const ouvert = useQG(s => s.volet?.type === 'releveLight');
  return <AnimatePresence>{ouvert && <Panneau key="releve-light" />}</AnimatePresence>;
}
