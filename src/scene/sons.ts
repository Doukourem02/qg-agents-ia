// Les sons du jardin, fabriqués sur place (Web Audio : aucun fichier, aucune dépendance) : le jour, des pépiements et
// de petits chants d'oiseaux, au hasard ; la nuit, un grillon très discret. Tout bas. Coupés par défaut : le navigateur
// n'accepte le son qu'après un geste, et c'est un choix (« Sons : oui / non », Réglages), retenu dans ce navigateur.

const CLE = 'qg-sons';
/** Le volume général : tout bas. */
export const VOLUME = 0.035;

/** Le choix retenu (ou « non » : coupés par défaut ; et si le stockage est refusé, « non » aussi). */
export function lireChoixSons(stockage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try { return stockage?.getItem(CLE) === 'oui'; } catch { return false; }
}
export function ecrireChoixSons(stockage: Pick<Storage, 'setItem'> | null | undefined, oui: boolean) {
  try { stockage?.setItem(CLE, oui ? 'oui' : 'non'); } catch { /* stockage refusé : le choix ne durera que la visite */ }
}

/** Un chant d'oiseau : de 1 à 7 pépiements, chacun une note qui glisse (fréquences en Hz, durées en s). */
export type Pepiement = { debut: number; duree: number; de: number; a: number };
export function chant(r: () => number): Pepiement[] {
  const n = 1 + Math.floor(r() * 7), base = 2200 + r() * 2600, out: Pepiement[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const duree = 0.04 + r() * 0.1, de = base * (0.85 + r() * 0.3), a = de * (r() < 0.5 ? 1.3 + r() * 0.4 : 0.6 + r() * 0.2);
    out.push({ debut: t, duree, de, a });
    t += duree + 0.03 + r() * 0.09;
  }
  return out;
}
/** Le prochain chant : entre 3 et 14 s. */
export const attenteChant = (r: () => number) => 3 + r() * 11;

type Moteur = { ctx: AudioContext; sortie: GainNode; minuterie: ReturnType<typeof setTimeout> | null };
let moteur: Moteur | null = null;

function jouerChant(m: Moteur) {
  const t0 = m.ctx.currentTime + 0.05;
  for (const p of chant(Math.random)) {
    const osc = m.ctx.createOscillator(), env = m.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.de, t0 + p.debut);
    osc.frequency.exponentialRampToValueAtTime(p.a, t0 + p.debut + p.duree);
    env.gain.setValueAtTime(0, t0 + p.debut);
    env.gain.linearRampToValueAtTime(1, t0 + p.debut + 0.012);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + p.debut + p.duree);
    osc.connect(env).connect(m.sortie);
    osc.start(t0 + p.debut); osc.stop(t0 + p.debut + p.duree + 0.02);
  }
}

/** Le grillon : un trille aigu et bref, très bas (le tiers du volume des oiseaux). */
function jouerGrillon(m: Moteur) {
  const t0 = m.ctx.currentTime + 0.05;
  for (let i = 0; i < 4; i++) {
    const osc = m.ctx.createOscillator(), env = m.ctx.createGain(), t = t0 + i * 0.06;
    osc.type = 'triangle'; osc.frequency.setValueAtTime(4600, t);
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.3, t + 0.008); env.gain.linearRampToValueAtTime(0, t + 0.035);
    osc.connect(env).connect(m.sortie); osc.start(t); osc.stop(t + 0.04);
  }
}

/** Allumer les sons (à appeler pendant un geste : un clic). `nuit()` dit s'il fait nuit à l'heure de la page. */
export function demarrerSons(nuit: () => boolean) {
  if (typeof window === 'undefined') return;
  if (!moteur) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx(), sortie = ctx.createGain();
    sortie.gain.value = VOLUME;
    sortie.connect(ctx.destination);
    moteur = { ctx, sortie, minuterie: null };
  }
  const m = moteur;
  void m.ctx.resume();
  const suivant = () => {
    if (nuit()) { jouerGrillon(m); m.minuterie = setTimeout(suivant, 2500 + Math.random() * 6000); return; }
    jouerChant(m);
    m.minuterie = setTimeout(suivant, attenteChant(Math.random) * 1000);
  };
  if (m.minuterie) clearTimeout(m.minuterie);
  m.minuterie = setTimeout(suivant, 800);
}

export function arreterSons() {
  if (!moteur) return;
  if (moteur.minuterie) clearTimeout(moteur.minuterie);
  moteur.minuterie = null;
  void moteur.ctx.suspend();
}
