'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { Constat } from '@/server/lea/types';
import { bilanPartiel, endroit, groupesConstats, lignesPartiel, messageRienACorriger, lignesRelecture, phraseTentative, shaCourt, type VueLea } from '@/server/lea/etiquette';
import { Puce } from './Panels';
import { BureauAgent, Section } from './BureauAgent';
import { derniereSeule } from './derniere-seule';

// Le bureau de Léa (modèle commun : BureauAgent.tsx). « Son travail » : ce qu'elle a trouvé en relisant tes pushes, puis
// ses relectures récentes. Page privée (vrais noms de projets et de fichiers), absent de /demo. Un secret n'apparaît jamais :
// seulement son genre, le fichier et la ligne. Le client n'importe que `etiquette.ts` (aucun code serveur).
// Il lit /api/lea à l'ouverture puis toutes les 60 secondes ; « Vu » fait un POST { vu: id }.

const ROUGE = '#d23b3b';
const heure = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const jourCourt = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const jourHeure = (ms: number) => `${jourCourt(ms)}, ${heure(ms)}`;
const RELECTURES_MAX = 12;

/** Depuis combien de temps, en mots simples (heures, puis jours). */
function dureeAbsence(passage: number): string {
  const h = Math.max(1, Math.floor((Date.now() - passage) / 3_600_000));
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} j`;
}

function useVueLea() {
  const [vue, setVue] = useState<VueLea | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [derniere] = useState(() => derniereSeule());
  useEffect(() => {
    let arret = false;
    const lire = async () => {
      const encore = derniere.prendre();
      try {
        const r = await fetch('/api/lea', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const v = await r.json() as VueLea;
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
  }, [derniere]);
  return { vue, setVue, horsLigne, derniere };
}

const Gris = ({ children }: { children: ReactNode }) => <p className="text-[8px] leading-snug text-[#6b6880]">{children}</p>;

const COULEUR: Record<Constat['gravite'], [string, string, string]> = {
  grave: ['#fdecec', ROUGE, 'grave'], moyen: ['#fff6e5', '#a06b00', 'moyen'], mineur: ['#f1f0f5', '#6b6880', 'mineur'],
};

function CarteConstat({ c, vu, enCours }: { c: Constat; vu: (id: string) => void; enCours: boolean }) {
  const [fond, texte, nom] = COULEUR[c.gravite];
  return (
    <div className="rounded-[6px] bg-[#faf9fc] px-[8px] py-[5px] text-[8.5px] leading-snug" style={{ boxShadow: `inset 2.5px 0 0 ${texte}` }}>
      <div className="flex items-baseline gap-[6px]">
        <Puce c={fond} t={texte}>{nom}</Puce>
        <span className="min-w-0 flex-1 truncate"><b>{c.depot}</b> · <code>{shaCourt(c.sha)}</code> {c.message}</span>
        <button onClick={() => vu(c.id)} disabled={enCours}
          className="shrink-0 rounded-[6px] bg-[#1d1b2e] px-[8px] py-[2px] text-[8px] font-semibold text-white disabled:opacity-50">Vu</button>
      </div>
      <div className="mt-[2px] text-[#6b6880]"><code>{endroit(c)}</code></div>
      <div className="mt-[2px]">{c.quoi}</div>
      <div className="mt-[2px] text-[#2a2740]"><b>À faire : </b>{c.conseil}</div>
    </div>
  );
}

function Panneau() {
  const { vue, setVue, horsLigne, derniere } = useVueLea();
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const vu = async (id: string) => {
    setEnCours(true);
    setMessage(null);
    const encore = derniere.prendre();
    try {
      const r = await fetch('/api/lea', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vu: id }) });
      if (!r.ok) throw new Error(String(r.status));
      const v = await r.json() as VueLea;
      if (encore()) setVue(v);
    } catch {
      setMessage('Le « Vu » n’a pas pu être noté.');
    } finally {
      setEnCours(false);
    }
  };

  const etat = (
    <span className="flex items-center gap-[6px]">
      {message && <span className="text-[8px] font-semibold" style={{ color: ROUGE }}>{message}</span>}
      {horsLigne && <span className="text-[8px] font-semibold" style={{ color: ROUGE }}>Pas de connexion au serveur.</span>}
    </span>
  );
  const { aCorriger, remarques } = vue ? groupesConstats(vue.constats) : { aCorriger: [], remarques: [] };
  const partiel = vue ? lignesPartiel(bilanPartiel(vue.relectures, vue.passage)) : [];
  const projets = vue ? [...new Set(vue.relectures.map(r => r.depot))] : [];
  // le dernier essai, s'il n'a pas été complet : ce qui n'a pas marché (projets illisibles, relu en partie, lot sans rapport…)
  const rate = vue ? phraseTentative(vue.tentative) : null;
  return (
    <BureauAgent agent="lea" cle="bureau-lea" etat={etat}>
      {!vue ? <Gris>{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</Gris> : (
        <div className="space-y-[10px]">
          <p className="text-[8px] text-[#6b6880]">
            {vue.passage === null ? 'Léa n’a encore fait aucune relecture complète.' : <>Dernier passage complet : {jourHeure(vue.passage)}.</>}
            {vue.absente && vue.passage !== null && <b style={{ color: ROUGE }}> Elle n’est pas passée depuis plus de 3 heures.</b>}
            {projets.length > 0 && <> Projets relus récemment : {projets.join(', ')}.</>}
          </p>
          {rate && vue.tentative && (
            <p className="text-[8px] font-semibold" style={{ color: ROUGE }}>Dernier essai ({jourHeure(vue.tentative.quand)}) : {rate}</p>
          )}
          {partiel.length > 0 && (
            <div className="space-y-[1px] text-[8px] font-semibold" style={{ color: '#a06b00' }}>{partiel.map(l => <p key={l}>{l}</p>)}</div>
          )}
          <Section titre="À corriger" n={aCorriger.length}>
            {aCorriger.length ? (
              <div className="space-y-[4px]">{aCorriger.map(c => <CarteConstat key={c.id} c={c} vu={id => { void vu(id); }} enCours={enCours} />)}</div>
            ) : <Gris>{messageRienACorriger(vue.absente && vue.passage !== null ? dureeAbsence(vue.passage) : null)}</Gris>}
          </Section>
          <details>
            <summary className="cursor-pointer border-b border-[#f1f0f5] pb-[2px] text-[9.5px] font-bold">
              Petites remarques <span className="font-normal text-[#6b6880]">({remarques.length})</span>
            </summary>
            <div className="mt-[5px] space-y-[4px]">
              {remarques.length ? remarques.map(c => <CarteConstat key={c.id} c={c} vu={id => { void vu(id); }} enCours={enCours} />) : <Gris>Aucune petite remarque.</Gris>}
            </div>
          </details>
          <Section titre="Relectures récentes">
            {vue.relectures.length ? (
              <div className="space-y-[3px]">
                {vue.relectures.slice(0, RELECTURES_MAX).map(r => (
                  <details key={`${r.depot}-${r.quand}`} className="rounded-[6px] bg-[#faf9fc] px-[8px] py-[4px] text-[9px]">
                    <summary className="flex cursor-pointer items-baseline gap-[6px]">
                      <span className="font-bold">{r.depot}</span>
                      <span className="ml-auto text-right text-[8px] text-[#6b6880]">{jourHeure(r.quand)}</span>
                    </summary>
                    <ul className="mt-[3px] space-y-[1px] text-[8px] leading-snug text-[#6b6880]">
                      {lignesRelecture(r).map(l => <li key={l}>{l}</li>)}
                      {r.commits.map(k => <li key={k.sha}><code>{shaCourt(k.sha)}</code> {k.message}</li>)}
                    </ul>
                  </details>
                ))}
              </div>
            ) : <Gris>Pas encore de relecture.</Gris>}
          </Section>
        </div>
      )}
    </BureauAgent>
  );
}

export function BureauLea() {
  const ouvert = useQG(s => s.volet?.type === 'bureauLea');
  return <AnimatePresence>{ouvert && <Panneau key="bureau-lea" />}</AnimatePresence>;
}
