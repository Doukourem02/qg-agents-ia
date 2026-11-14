import { FURNITURE, GRID, partiesDe, PORTES_WC, ROOMS, type Pt } from '@/data/layout';

// Grille de déplacement : une case est bloquée par un meuble ; un mur bloque le passage entre deux cases, sauf aux portes.

const W = GRID.w, H = GRID.h;
const blocked = new Uint8Array(W * H);
const walls = new Set<string>();
const idx = (x: number, y: number) => y * W + x;
const edge = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// (les portes des cabines des toilettes comptent fermées : on n'entre pas dans une cabine en marchant, Activites.tsx)
for (const f of [...FURNITURE, ...PORTES_WC.flatMap(p => p.ferme)]) {
  if (!f.bloque) continue;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // une case est prise si le meuble couvre son cœur (la moitié centrale)
    if (f.x < x + 0.75 && f.x + f.w > x + 0.25 && f.y < y + 0.75 && f.y + f.d > y + 0.25) blocked[idx(x, y)] = 1;
  }
}

for (const r of ROOMS) for (const partie of partiesDe(r)) {
  if (!r.mur && !r.vitre) continue;
  const [x0, y0, w, d] = partie.r;
  const porte = (cote: string, a: number) => partie.portes.some(p => p.cote === cote && p.a === a);
  for (let i = 0; i < w; i++) {
    const x = x0 + i;
    if (!porte('N', x) && y0 - 1 >= 0) walls.add(edge(idx(x, y0 - 1), idx(x, y0)));
    if (!porte('S', x) && y0 + d < H) walls.add(edge(idx(x, y0 + d - 1), idx(x, y0 + d)));
  }
  for (let j = 0; j < d; j++) {
    const y = y0 + j;
    if (!porte('W', y) && x0 - 1 >= 0) walls.add(edge(idx(x0 - 1, y), idx(x0, y)));
    if (!porte('E', y) && x0 + w < W) walls.add(edge(idx(x0 + w - 1, y), idx(x0 + w, y)));
  }
}

const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
export const isBlocked = (x: number, y: number) => !inside(x, y) || blocked[idx(x, y)] === 1;
export const wallBetween = (a: Pt, b: Pt) => walls.has(edge(idx(a[0], a[1]), idx(b[0], b[1])));

function cellOf(p: Pt): Pt {
  return [Math.min(W - 1, Math.max(0, Math.floor(p[0]))), Math.min(H - 1, Math.max(0, Math.floor(p[1])))];
}

/** La case libre la plus proche (en suivant les passages autorisés). */
function nearestFree(c: Pt): Pt {
  if (!isBlocked(c[0], c[1])) return c;
  const seen = new Set([idx(c[0], c[1])]);
  const q: Pt[] = [c];
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny) || seen.has(idx(nx, ny)) || wallBetween([x, y], [nx, ny])) continue;
      if (!isBlocked(nx, ny)) return [nx, ny];
      seen.add(idx(nx, ny)); q.push([nx, ny]);
    }
  }
  return c;
}

const DIRS: Pt[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Chemin de `from` à `to` (coordonnées libres, en cases) : centres de cases puis le point exact d'arrivée.
 * Renvoie [] si aucun chemin n'existe.
 */
export function findPath(from: Pt, to: Pt): Pt[] {
  const s = cellOf(from); // le départ peut être une case occupée (une chaise derrière un bureau)
  const g = nearestFree(cellOf(to));
  const si = idx(s[0], s[1]), gi = idx(g[0], g[1]);
  if (si === gi) return [to];
  const cost = new Float64Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const open: number[] = [si];
  cost[si] = 0;
  const h = (i: number) => Math.abs((i % W) - g[0]) + Math.abs(Math.floor(i / W) - g[1]);
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (cost[open[k]] + h(open[k]) < cost[open[bi]] + h(open[bi])) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === gi) break;
    const cx = cur % W, cy = Math.floor(cur / W);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!inside(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (blocked[ni] && ni !== gi) continue;
      if (walls.has(edge(cur, ni))) continue;
      const nc = cost[cur] + 1;
      if (nc < cost[ni]) { cost[ni] = nc; prev[ni] = cur; if (!open.includes(ni)) open.push(ni); }
    }
  }
  if (prev[gi] === -1) return [];
  const cells: Pt[] = [];
  for (let i = gi; i !== -1 && i !== si; i = prev[i]) cells.unshift([(i % W) + 0.5, Math.floor(i / W) + 0.5]);
  return simplify([...cells, to]);
}

/** Retire les points intermédiaires alignés, pour des trajets plus fluides. */
function simplify(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const col = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(col) > 1e-6) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
