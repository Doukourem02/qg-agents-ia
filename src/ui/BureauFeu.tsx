'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useQG } from '@/store';
import type { VueFeu } from '@/server/feu/etiquette';
import type { StatutPaire } from '@/server/feu/types';
import { hhmm, jourHeure, nomPaire, pct, prixFr, usdt } from '@/server/feu/indicateurs';
import { lignesPlan } from '@/server/feu/messages';
import { BureauAgent, Section } from './BureauAgent';
import { derniereSeule } from './derniere-seule';

// Le bureau de Feu (modèle commun : BureauAgent.tsx). « Son travail » : le statut de BTC et ETH calculé par le code (et
// ce qui manque), le plan d'ordres au Signal seulement, le compte (solde Spot et Earn, vu à HH:MM), le régime, les
// positions, le journal et ses débriefs, les niveaux surveillés, les prochaines annonces, la dernière analyse et ses
// sources, les dernières alertes. Lecture seule : Feu ne passe jamais un ordre. Page privée, absent de /demo.
// Chaque prix est montré avec son heure de lecture. Le client n'importe que des fonctions pures et des types.

const ROUGE = '#d23b3b';
const VERT = '#2f9c5a';
const JAUNE = '#F0B90B';
const COULEUR: Record<StatutPaire['statut'], { c: string; t: string }> = {
  Hypothèse: { c: '#f1f0f5', t: '#6b6880' },
  Surveillance: { c: '#fff1cc', t: '#8a6400' },
  Signal: { c: VERT, t: '#fff' },
};

function useVueFeu() {
  const [vue, setVue] = useState<VueFeu | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [derniere] = useState(() => derniereSeule());
  useEffect(() => {
    let arret = false;
    const lire = async () => {
      const encore = derniere.prendre();
      try {
        const r = await fetch('/api/feu', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const v = await r.json() as VueFeu;
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
  return { vue, horsLigne };
}

const Gris = ({ children }: { children: ReactNode }) => <p className="text-[8px] leading-snug text-[#6b6880]">{children}</p>;
const Ligne = ({ children }: { children: ReactNode }) => <div className="text-[8.5px] leading-snug">{children}</div>;

function CartePaire({ s }: { s: StatutPaire }) {
  const k = COULEUR[s.statut];
  const conds: [string, { ok: boolean; detail: string }][] = [['Contexte 4h/1h', s.conditions.contexte], ['Zone', s.conditions.zone], ['Déclencheur 15m', s.conditions.declencheur]];
  return (
    <div className="rounded-[6px] bg-[#faf9fc] px-[8px] py-[5px] text-[8.5px] leading-snug" style={{ boxShadow: `inset 2.5px 0 0 ${s.statut === 'Signal' ? VERT : JAUNE}` }}>
      <div className="flex items-baseline gap-[6px]">
        <b className="text-[9.5px]">{nomPaire(s.paire)}</b>
        <span className="rounded-[4px] px-[5px] py-[0.5px] text-[7.5px] font-bold" style={{ background: k.c, color: k.t }}>{s.statut}</span>
        <span className="ml-auto tabular-nums">{prixFr(s.prix)} <span className="text-[#6b6880]">lu à {hhmm(s.lu)} UTC</span></span>
      </div>
      <ul className="mt-[3px] space-y-[1px]">
        {conds.map(([nom, c]) => (
          <li key={nom}><span className="font-bold" style={{ color: c.ok ? VERT : '#9a97ab' }}>{c.ok ? '✓' : '·'}</span> <b>{nom}</b> : {c.detail}</li>
        ))}
      </ul>
      {s.manque && <div className="mt-[2px]"><b>Ce qui manque :</b> {s.manque}. On attend.</div>}
      <div className="mt-[2px] text-[7.5px] text-[#6b6880]">
        RSI 15m {s.rsi15 === null ? 'indisponible' : Math.round(s.rsi15)}{s.ratio !== null ? ` · ratio possible ${s.ratio.toFixed(1).replace('.', ',')} pour 1 net de frais` : ''}{s.rate ? ' · zone dépassée de plus de 1 % : c’est raté' : ''}
      </div>
    </div>
  );
}

function Panneau() {
  const { vue, horsLigne } = useVueFeu();
  const now = useQG(s => s.vues?.maintenant) ?? 0;
  const c = vue?.compte;
  const etat = horsLigne ? <span className="text-[8px] font-semibold" style={{ color: ROUGE }}>Pas de connexion au serveur.</span>
    : c ? <span className="text-[8px] text-[#6b6880]">{c.cle === 'ok' && c.quand ? `Solde vu à ${hhmm(c.quand)} UTC` : c.cle === 'droits' ? 'Clé Binance refusée (droits en trop)' : 'Clé Binance pas encore créée'}</span> : undefined;
  const signaux = vue?.passage?.statuts.filter(s => s.statut === 'Signal' && s.plan) ?? [];
  return (
    <BureauAgent agent="feu" cle="bureau-feu" etat={etat}>
      {!vue ? <Gris>{horsLigne ? 'Pas de connexion au serveur.' : 'Lecture…'}</Gris> : (
        <div className="space-y-[10px]">
          <Gris>Feu lit BTC/USDT et ETH/USDT (4h, 1h, 15m) et applique tes règles par le code. Il propose ; tu décides et tu poses tes ordres toi-même. Il ne peut passer aucun ordre.</Gris>
          <Section titre="Le marché">
            {!vue.passage ? <Gris>Pas encore de lecture du marché.</Gris> : (
              <div className="space-y-[4px]">
                {vue.passage.erreur && <p className="text-[8px] font-semibold" style={{ color: ROUGE }}>Dernière lecture ratée : {vue.passage.erreur}. Les statuts ci-dessous datent de {hhmm(vue.passage.quand)} UTC.</p>}
                {vue.passage.statuts.map(s => <CartePaire key={s.paire} s={s} />)}
                {vue.interdit && <Ligne><b style={{ color: ROUGE }}>Aucune entrée maintenant :</b> {vue.interdit}.</Ligne>}
              </div>
            )}
          </Section>
          <Section titre="Plan d’ordres en cours" n={signaux.length}>
            {signaux.length ? signaux.map(s => (
              <div key={s.paire} className="rounded-[6px] bg-[#eef8f1] px-[8px] py-[5px]">
                <div className="text-[8.5px] font-bold">Signal {nomPaire(s.paire)} · prix lu {prixFr(s.prix)} à {hhmm(s.lu)} UTC</div>
                {lignesPlan(s.plan!).map((l, i) => <Ligne key={i}>{l}</Ligne>)}
                <Gris>La décision est la tienne. Limite non exécutée et prix parti sans toi : on ne court pas après.</Gris>
              </div>
            )) : <Gris>Aucun : pas de Signal, on attend.</Gris>}
          </Section>
          <Section titre="Ton compte">
            {c?.cle === 'ok' ? (
              <Ligne>Spot <b>{usdt(c.spotUsdt ?? 0)}</b> · Simple Earn <b>{usdt(c.earnUsdt ?? 0)}</b>{(c.crypto ?? 0) > 0 ? <> · BTC/ETH <b>{usdt(c.crypto ?? 0)}</b></> : null} · total <b>{usdt(c.total ?? 0)}</b> <span className="text-[#6b6880]">(vu à {c.quand ? hhmm(c.quand) : '—'} UTC{c.quand && now - c.quand > 20 * 60_000 ? ', le Mac ne l’a pas relu depuis' : ''} ; {c.ordresOuverts ?? 0} ordre(s) ouvert(s))</span></Ligne>
            ) : c?.cle === 'droits' ? (
              <Ligne><b style={{ color: ROUGE }}>Ta clé a des droits en trop</b> ({(c.droits ?? []).join(', ')}) : Feu refuse de s’en servir et ne lit rien. Recrée-la avec « Lecture » seulement.</Ligne>
            ) : (
              <Ligne>La clé Binance en lecture seule n’est pas encore créée : Feu ne voit pas ton solde. Tout le reste marche ; les calculs partent du montant déclaré.</Ligne>
            )}
            {vue.capital && <Gris>Capital des calculs : {usdt(vue.capital.montant)} ({vue.capital.source === 'compte' ? 'lu sur ton compte' : `déclaré le ${jourHeure(vue.capital.quand)}`}) · régime {vue.regime === 'standard' ? 'standard' : 'apprentissage (sous 100 USDT : apprendre à tenir un plan)'}.</Gris>}
            {vue.points.map((p, i) => <Gris key={i}>À éclaircir : {p}</Gris>)}
            {vue.pause && <Ligne><b style={{ color: ROUGE }}>Pause</b> jusqu’au {jourHeure(vue.pause.jusqua)} UTC : {vue.pause.raison}.</Ligne>}
          </Section>
          <Section titre="Positions en cours" n={vue.positions.length}>
            {vue.positions.length ? vue.positions.map(p => (
              <Ligne key={`${p.paire}-${p.ouverture}`}>{nomPaire(p.paire)} : entrée {prixFr(p.prixEntree)}, quantité {p.quantite.toLocaleString('fr-FR', { maximumFractionDigits: 8 })}{p.objectif ? `, objectif ${prixFr(p.objectif)}` : ''}{p.stop ? `, stop ${prixFr(p.stop)}` : ' — aucun stop posé : pose ton OCO'}</Ligne>
            )) : <Gris>Aucune position ouverte.</Gris>}
          </Section>
          <Section titre="Journal">
            {vue.journal ? (
              <Ligne>{vue.journal.operations} opération(s) · {vue.journal.gagnantes} gagnante(s), {vue.journal.perdantes} perdante(s) · net {usdt(vue.journal.net)}{vue.journal.netPct !== null ? ` (${pct(vue.journal.netPct)})` : ''} · frais {usdt(vue.journal.frais)} · plans respectés {vue.journal.plansRespectes === null ? 'sans objet' : pct(vue.journal.plansRespectes, 0)} · cette semaine {vue.journal.semaine}{vue.regime === 'apprentissage' ? ' sur 3' : ''}</Ligne>
            ) : <Gris>Pas encore de journal.</Gris>}
            {vue.operations.map(o => (
              <details key={o.cloture} className="mt-[3px] text-[8px]">
                <summary className="cursor-pointer">{nomPaire(o.paire)} · {jourHeure(o.cloture)} · <b style={{ color: o.gagnante ? VERT : ROUGE }}>{o.net >= 0 ? '+' : ''}{usdt(o.net)}</b></summary>
                <ul className="ml-[8px] mt-[2px] space-y-[1px]">{o.debrief.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </details>
            ))}
          </Section>
          <Section titre="Niveaux surveillés (clôture d’une bougie 1h)">
            {vue.niveaux ? Object.entries(vue.niveaux).map(([p, n]) => (
              <Ligne key={p}><b>{nomPaire(p)}</b> : support {n.supports.map(z => `${prixFr(z.bas)}–${prixFr(z.haut)}`).join(', ') || 'aucun'} · résistances {n.resistances.map(z => (z.bas === z.haut ? prixFr(z.bas) : `${prixFr(z.bas)}–${prixFr(z.haut)}`)).join(', ')} · alerte {n.surveilles.map(x => `${x.sens === 'haut' ? '↑' : '↓'} ${prixFr(x.prix)}`).join(', ')}{n.contexte ? ` · contexte haussier si reprise de ${prixFr(n.contexte.prix)}${n.contexte.repris ? ' (repris)' : ''}` : ''}</Ligne>
            )) : <Gris>Pas encore de niveaux.</Gris>}
          </Section>
          <Section titre="Prochaines annonces" n={vue.annonces.length}>
            {vue.annonces.length ? vue.annonces.map(a => (
              <Ligne key={`${a.quand}-${a.nom}`}>{a.aConfirmer ? `le ${new Date(a.quand).toLocaleDateString('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' })}` : `${jourHeure(a.quand)} UTC`} · {a.nom}{a.aConfirmer ? '' : ` · pas d’entrée de ${hhmm(a.quand - 3_600_000)} à ${hhmm(a.quand + 3_600_000)}`}</Ligne>
            )) : <Gris>Aucune annonce connue.</Gris>}
          </Section>
          <Section titre="L’analyse et l’actualité du jour">
            {vue.analyse ? (
              <div className="space-y-[2px]">
                <Gris>Analyse de {hhmm(vue.analyse.creneau ?? vue.analyse.recu)} · {vue.analyse.envoye ? `envoyée sur Telegram à ${hhmm(vue.analyse.envoye)}` : vue.analyse.perimee ? 'périmée, pas envoyée' : now >= (vue.analyse.creneau ?? vue.analyse.recu) ? 'pas encore partie, nouvel essai au prochain passage' : 'en attente de son heure'}</Gris>
                <Ligne><b>Lecture :</b> {vue.analyse.lecture}</Ligne>
                <Ligne><b>Analyse :</b> {vue.analyse.analyse}</Ligne>
                <Ligne><b>Opportunité :</b> {vue.analyse.opportunite}</Ligne>
                <Ligne><b>Action :</b> {vue.analyse.action}</Ligne>
                <Ligne><b>Pourquoi :</b> {vue.analyse.pourquoi}</Ligne>
                <ul className="mt-[2px] space-y-[1px] text-[8px]">
                  {vue.analyse.actualite.map((x, i) => <li key={i}>• {x.texte} <a href={x.source} target="_blank" rel="noreferrer" className="underline">{x.source.replace(/^https:\/\/(www\.)?/, '').split('/')[0]}</a>, {x.date}</li>)}
                </ul>
              </div>
            ) : <Gris>Pas encore d’analyse (quatre par jour : 08:00, 12:00, 16:00, 20:00, dès la mise en service).</Gris>}
          </Section>
          <details>
            <summary className="cursor-pointer border-b border-[#f1f0f5] pb-[2px] text-[9.5px] font-bold">Dernières alertes <span className="font-normal text-[#6b6880]">({vue.messages.length})</span></summary>
            <ul className="mt-[5px] space-y-[3px] text-[8px]">
              {vue.messages.length ? vue.messages.map((m, i) => (
                <li key={i}><span className="text-[#6b6880]">{jourHeure(m.quand)} · {m.envoye ? 'envoyée' : `gardée ici (${m.raison ?? 'pas partie'})`}</span><pre className="whitespace-pre-wrap font-sans">{m.texte}</pre></li>
              )) : <Gris>Aucune alerte.</Gris>}
              {vue.ignores.length > 0 && <Gris>Ignoré par toi : {vue.ignores.join(', ')} (écris « reprends Feu » pour annuler).</Gris>}
            </ul>
          </details>
        </div>
      )}
    </BureauAgent>
  );
}

export function BureauFeu() {
  const ouvert = useQG(s => s.volet?.type === 'bureauFeu');
  return <AnimatePresence>{ouvert && <Panneau key="bureau-feu" />}</AnimatePresence>;
}
