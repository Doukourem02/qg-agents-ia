'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { VueIsaac } from '@/server/isaac/vue';
import { goEntier } from '@/server/isaac/vue';
import { Puce } from './Panels';
import { BureauAgent } from './BureauAgent';
import { derniereSeule } from './derniere-seule';

// Le bureau d'Isaac (modèle commun : BureauAgent.tsx). « Son travail » : la place libre sur le Mac, les propositions
// qui attendent mon Oui (sur Telegram), ce qui a été libéré ces 30 derniers jours. Page privée, absent de /demo.
// Aucun détail technique : la vue ne porte que libellé, taille et impact.
// Il lit /api/isaac à l'ouverture puis toutes les 60 secondes.

const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const jourCourt = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const jourHeure = (ms: number, now: number) => {
  const jour = (t: number) => Math.floor(t / 86_400_000);
  return jour(ms) === jour(now) ? heure(ms) : `${jourCourt(ms)}, ${heure(ms)}`;
};
const GO = 1024 ** 3;
/** « 4 Go » ; sous 1 Go, une décimale (« 0,4 Go »). */
const taille = (octets: number) => octets < GO ? `${(octets / GO).toFixed(1).replace('.', ',')} Go` : `${goEntier(octets)} Go`;

function useVueIsaac() {
  const [vue, setVue] = useState<VueIsaac | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  useEffect(() => {
    let arret = false;
    const derniere = derniereSeule();
    const lire = async () => {
      const encore = derniere.prendre();
      try {
        const r = await fetch('/api/isaac', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const v = await r.json() as VueIsaac;
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
  const { vue, horsLigne } = useVueIsaac();
  const [local] = useState(() => Date.now());
  const now = maintenant ?? local; // l'heure du serveur si la page l'a déjà lue
  const etat = horsLigne ? <span className="text-[8px] font-semibold text-[#d23b3b]">Pas de connexion au serveur.</span>
    : vue && !vue.mac.enLigne ? <Puce c="#fff6e5" t="#a06b00">Le Mac est éteint</Puce> : null;
  const eteint = !!vue && !vue.mac.enLigne;
  const p = vue?.place;
  const pct = p?.total ? Math.max(2, Math.min(100, Math.round((p.libre / p.total) * 100))) : 0;
  return (
    <BureauAgent agent="isaac" cle="bureau-isaac" etat={etat}>
      {!vue ? <Gris>{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</Gris> : (
        <div className="space-y-[10px]">
          <div>
            <h4 className="mb-[3px] text-[8.5px] font-bold">La place sur le Mac</h4>
            {p ? (<>
              <div className={eteint ? 'opacity-50' : ''}>
                <div className="mb-[3px] text-[9px] font-bold">{goEntier(p.libre)} Go libres{p.total ? ` sur ${goEntier(p.total)}` : ''}</div>
                {p.total ? (
                  <div className="h-[6px] overflow-hidden rounded-full bg-[#f1f0f5]" role="img" aria-label={`${goEntier(p.libre)} Go libres sur ${goEntier(p.total)}`}>
                    <div className="h-full rounded-full bg-[#2f9c5a]" style={{ width: `${pct}%` }} />
                  </div>
                ) : null}
              </div>
              <Gris>{eteint ? `Dernière mesure ${jourHeure(p.quand, now)} : le Mac est éteint depuis.` : `Mesuré à ${jourHeure(p.quand, now)}.`}</Gris>
            </>) : <Gris>{vue.mac.vu === null ? 'Pas encore de passage du Mac.' : 'Pas encore de mesure.'}</Gris>}
          </div>
          <div>
            <h4 className="mb-[3px] text-[8.5px] font-bold">À valider</h4>
            {vue.propositions.length ? (
              <div className="space-y-[3px]">
                {vue.propositions.map(x => (
                  <div key={`${x.libelle}-${x.quand}`} className="rounded-[6px] bg-[#faf9fc] px-[8px] py-[4px] text-[8px] leading-snug">
                    <div className="flex items-baseline gap-[6px]"><span className="text-[9px] font-bold">{x.libelle}</span><span className="ml-auto font-semibold">{taille(x.taille)}</span></div>
                    {x.expiree ? <div className="font-semibold text-[#b45309]">Expirée : Isaac en refera une à jour.</div> : null}
                    <div className="text-[#6b6880]">{x.impact}</div>
                  </div>
                ))}
                <Gris>Réponds par Oui ou Non sur Telegram.</Gris>
              </div>
            ) : <Gris>Aucune proposition en attente.</Gris>}
          </div>
          <div>
            <h4 className="mb-[3px] text-[8.5px] font-bold">Libéré ces 30 derniers jours</h4>
            {vue.liberes.liste.length ? (<>
              <div className="mb-[2px] text-[9px] font-bold">{taille(vue.liberes.total)}</div>
              {vue.liberes.liste.map(x => (
                <div key={`${x.libelle}-${x.quand}`} className="flex items-baseline gap-[6px] py-[2px] text-[8px] leading-snug">
                  <span className="font-semibold">{x.libelle}</span>
                  <span className="text-[#6b6880]">{jourCourt(x.quand)}</span>
                  <span className="ml-auto">{taille(x.libere)}</span>
                </div>
              ))}
            </>) : <Gris>Rien libéré pour l’instant.</Gris>}
          </div>
          {vue.refusees.length > 0 && (
            <div>
              <h4 className="mb-[3px] text-[8.5px] font-bold">Refusé par le Mac</h4>
              {vue.refusees.map(x => (
                <div key={`${x.libelle}-${x.quand}`} className="py-[2px] text-[8px] leading-snug">
                  <span className="font-semibold">{x.libelle}</span>{x.raison ? <span className="text-[#6b6880]"> · {x.raison}</span> : null}
                </div>
              ))}
            </div>
          )}
          {vue.missionsEnAttente > 0 && (
            <Gris>{vue.missionsEnAttente > 1 ? `${vue.missionsEnAttente} missions` : '1 mission'} : {eteint ? 'en attente, le Mac est éteint.' : 'en attente du prochain passage.'}</Gris>
          )}
        </div>
      )}
    </BureauAgent>
  );
}

export function BureauIsaac() {
  const ouvert = useQG(s => s.volet?.type === 'bureauIsaac');
  return <AnimatePresence>{ouvert && <Panneau key="bureau-isaac" />}</AnimatePresence>;
}
