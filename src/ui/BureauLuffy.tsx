'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { VueLuffy } from '@/server/luffy/vue';
import { Puce } from './Panels';
import { BureauAgent } from './BureauAgent';
import { derniereSeule } from './derniere-seule';

// Le bureau de Luffy (modèle commun : BureauAgent.tsx). « Son travail » : une ligne par site, la dernière vérification,
// les pannes des 7 derniers jours. Page privée (vrais sites), absent de /demo. Aucun détail technique.
// Il lit /api/luffy à l'ouverture puis toutes les 60 secondes.

const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const jourCourt = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const jourHeure = (ms: number, now: number) => {
  const jour = (t: number) => Math.floor(t / 86_400_000);
  return jour(ms) === jour(now) ? heure(ms) : `${jourCourt(ms)}, ${heure(ms)}`;
};

function useVueLuffy() {
  const [vue, setVue] = useState<VueLuffy | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  useEffect(() => {
    let arret = false;
    const derniere = derniereSeule();
    const lire = async () => {
      const encore = derniere.prendre();
      try {
        const r = await fetch('/api/luffy', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const v = await r.json() as VueLuffy;
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

function Panneau() {
  const maintenant = useQG(s => s.vues?.maintenant);
  const { vue, horsLigne } = useVueLuffy();
  const [local] = useState(() => Date.now());
  const now = maintenant ?? local; // l'heure du serveur si la page l'a déjà lue
  const etat = horsLigne ? <span className="text-[8px] font-semibold text-[#d23b3b]">Pas de connexion au serveur.</span>
    : vue?.endormi ? <Puce c="#fff6e5" t="#a06b00">Luffy ne vérifie plus</Puce> : null;
  return (
    <BureauAgent agent="luffy" cle="bureau-luffy" etat={etat}>
      {!vue ? <Gris>{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</Gris> : (
        <div className="space-y-[10px]">
          <div className="space-y-[3px]">
            {vue.sites.map(s => (
              <div key={s.id} className={`flex items-baseline gap-[6px] rounded-[6px] bg-[#faf9fc] px-[8px] py-[4px] text-[9px] ${vue.endormi ? 'opacity-50' : ''}`}>
                <span aria-hidden>{vue.endormi ? '•' : s.enLigne ? '✅' : '⚠️'}</span>
                <span className="font-bold">{s.nom}</span>
                <span className={`ml-auto text-[8px] ${s.enLigne ? 'text-[#2f9c5a]' : 'font-semibold text-[#d23b3b]'}`}>
                  {vue.endormi ? 'état inconnu' : s.enLigne ? 'en ligne' : `en panne depuis ${s.depuis !== undefined ? jourHeure(s.depuis, now) : 'un moment'}`}
                </span>
              </div>
            ))}
          </div>
          <Gris>
            {vue.dernier === null ? 'Luffy n’a encore rien vérifié.'
              : vue.endormi ? `Luffy ne vérifie plus depuis ${jourHeure(vue.dernier, now)}.`
              : `Dernière vérification à ${jourHeure(vue.dernier, now)}.`}
          </Gris>
          <div>
            <h4 className="mb-[3px] text-[8.5px] font-bold">Pannes des 7 derniers jours</h4>
            {vue.pannes7j.length ? vue.pannes7j.map(p => (
              <div key={`${p.nom}-${p.debut}`} className="flex items-baseline gap-[6px] py-[2px] text-[8px] leading-snug">
                <span className="font-semibold">{p.nom}</span>
                <span className="text-[#6b6880]">{jourHeure(p.debut, now)}</span>
                <span className="ml-auto">{p.fin === undefined ? `en cours · ${p.duree}` : p.duree}</span>
              </div>
            )) : <Gris>Aucune panne.</Gris>}
          </div>
        </div>
      )}
    </BureauAgent>
  );
}

export function BureauLuffy() {
  const ouvert = useQG(s => s.volet?.type === 'bureauLuffy');
  return <AnimatePresence>{ouvert && <Panneau key="bureau-luffy" />}</AnimatePresence>;
}
