'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { VueMafe } from '@/server/mafe/vue';
import type { PointProjet } from '@/server/mafe/avancement';
import { Puce } from './Panels';
import { BureauAgent } from './BureauAgent';
import { derniereSeule } from './derniere-seule';

// Le bureau de Mafe (modèle commun : BureauAgent.tsx). « Son travail » : par quoi commencer, un bloc par projet,
// les projets en pause, la dernière note de séance. Page privée (vrais noms de projets), absent de /demo.
// Il lit /api/mafe à l'ouverture puis toutes les 60 secondes. Seulement « 5 / 134 », jamais de taux.

const nombre = (n: number) => n.toLocaleString('fr-FR');
/** « 10 nov. » à partir d'une date « 2026-11-10 » ou d'un horodatage ISO (jour d'Abidjan = UTC). */
const jourCourt = (iso: string) => {
  const t = Date.parse(iso.slice(0, 10));
  return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};

function useVueMafe() {
  const [vue, setVue] = useState<VueMafe | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  useEffect(() => {
    let arret = false;
    const derniere = derniereSeule();
    const lire = async () => {
      const encore = derniere.prendre();
      try {
        const r = await fetch('/api/mafe', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const v = await r.json() as VueMafe;
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
  return { vue, horsLigne };
}

const Gris = ({ children }: { children: ReactNode }) => <p className="text-[8px] leading-snug text-[#6b6880]">{children}</p>;

/** « 5 / 134 » et une barre : seulement pour une check-list à cases. */
function Barre({ faites, total }: { faites: number; total: number }) {
  return (
    <div className="mt-[3px] flex items-center gap-[6px]">
      <div className="flex h-[5px] w-[120px] overflow-hidden rounded-full bg-[#ebe9f2]" role="img" aria-label={`${faites} faites sur ${total}`}>
        <div className="bg-[#2fbf5b]" style={{ flexGrow: faites }} />
        <div style={{ flexGrow: Math.max(total - faites, 0) }} />
      </div>
      <span className="text-[8px] font-semibold">{nombre(faites)} / {nombre(total)}</span>
    </div>
  );
}

function Projet({ p }: { p: PointProjet }) {
  const a = p.avancement;
  return (
    <div className="rounded-[6px] bg-[#faf9fc] px-[8px] py-[5px]">
      <div className="flex items-baseline gap-[6px]">
        <span className="text-[9px] font-bold">{p.nom}</span>
        {p.dernierTravail && <span className="ml-auto text-[7px] text-[#6b6880]">dernier travail le {jourCourt(p.dernierTravail)}</span>}
      </div>
      {a.genre === 'cases' && <Barre faites={a.faites} total={a.total} />}
      {a.genre === 'liste' && <p className="mt-[2px] text-[8px] font-semibold">{a.restantes} {a.restantes > 1 ? 'tâches restantes' : 'tâche restante'}</p>}
      <p className="mt-[2px] text-[7.5px] leading-snug text-[#6b6880]">{p.ouOnSArrete}</p>
    </div>
  );
}

function Panneau() {
  const haut = useQG(s => s.format === 'haut');
  const { vue, horsLigne } = useVueMafe();
  const r = vue?.releve ?? null;
  const actifs = r?.projets.filter(p => !p.enPause) ?? [];
  const enPause = r?.projets.filter(p => p.enPause) ?? [];
  const etat = horsLigne ? <span className="text-[8px] font-semibold text-[#d23b3b]">Pas de connexion au serveur.</span>
    : r?.pasAJour ? <Puce c="#fff6e5" t="#a06b00">pas à jour · relevé du {jourCourt(r.jour)}</Puce> : null;
  return (
    <BureauAgent agent="mafe" cle="bureau-mafe" etat={etat}>
      {!vue ? <Gris>{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</Gris> : !r ? <Gris>Pas encore de relevé.</Gris> : (
        <div className="space-y-[10px]">
          {(r.phrase || r.priorite) && (
            <p className="rounded-[6px] bg-[#fff6e5] px-[8px] py-[5px] text-[9px]" style={{ boxShadow: 'inset 2.5px 0 0 #e0a42a' }}>
              {r.phrase ?? <><b>Commence par {r.priorite!.nom}</b> — {r.priorite!.raison.split(' : ')[0]}</>}
            </p>
          )}
          <div className={`grid gap-[6px] ${haut ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {actifs.map(p => <Projet key={p.depot} p={p} />)}
          </div>
          {!actifs.length && <Gris>Aucun projet actif.</Gris>}
          {enPause.length > 0 && <Gris>en pause : {enPause.map(p => p.nom).join(', ')}</Gris>}
          {vue.derniereNote && <Gris>Dernière note : {vue.derniereNote.nom}, {jourCourt(vue.derniereNote.jour)}.</Gris>}
        </div>
      )}
    </BureauAgent>
  );
}

export function BureauMafe() {
  const ouvert = useQG(s => s.volet?.type === 'bureauMafe');
  return <AnimatePresence>{ouvert && <Panneau key="bureau-mafe" />}</AnimatePresence>;
}
