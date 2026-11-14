'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Blocs } from './Blocs';
import { CASCADE, ilot } from './paysage';
import { ILE } from '@/data/layout';
import { allumage, lumiereA, minutesDe } from '@/sim/lumiere';
import { useQG } from '@/store';

// Un peu de vie autour du bureau (des décors, aucune donnée) : des oiseaux qui passent de temps en temps, des
// papillons autour des fleurs, un margouillat qui fait ses pompes sur le mur de gauche, l'eau qui tombe de la cascade,
// et trois petites îles qui flottent doucement autour de la grande. Oiseaux et papillons seulement le jour.

const CUBE = new THREE.BoxGeometry(1, 1, 1);
const o = new THREE.Object3D();
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const jour = () => allumage(lumiereA(minutesDe(useQG.getState().horloge))) < 0.5;
/** Pose une instance (un pavé) : centre, taille. */
function poser(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, w: number, d: number, h: number) {
  o.position.set(x, z, y); o.rotation.set(0, 0, 0); o.scale.set(w, h, d); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
}

/** Les oiseaux : quatre silhouettes qui traversent le ciel, à leur rythme ; un corps et deux ailes qui battent. */
function Oiseaux() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const vols = useMemo(() => {
    const r = rng(7);
    return Array.from({ length: 4 }, (_, i) => ({ depart: r() * 30 + i * 9, periode: 26 + r() * 22, angle: r() * Math.PI * 2, z: 4.5 + r() * 2.5, decal: (r() - 0.5) * 14 }));
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#2a2a36' }), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime, visible = jour();
    vols.forEach((v, i) => {
      const f = ((t + v.depart) % v.periode) / v.periode; // 0 → 1 : un passage, puis rien jusqu'au suivant
      const enVol = visible && f < 0.5;
      const cx = ILE.x + ILE.w / 2 + Math.sin(v.angle) * v.decal, cy = ILE.y + ILE.d / 2 + Math.cos(v.angle) * v.decal;
      const p = (f / 0.5 - 0.5) * 70, x = cx + Math.cos(v.angle) * p, y = cy + Math.sin(v.angle) * p;
      const batt = Math.sin(t * 14 + i) * 0.12, s = enVol ? 1 : 0;
      poser(m, i * 3, x, y, v.z, 0.2 * s, 0.2 * s, 0.1 * s);
      poser(m, i * 3 + 1, x - Math.sin(v.angle) * 0.22, y + Math.cos(v.angle) * 0.22, v.z + batt, 0.24 * s, 0.24 * s, 0.04 * s);
      poser(m, i * 3 + 2, x + Math.sin(v.angle) * 0.22, y - Math.cos(v.angle) * 0.22, v.z + batt, 0.24 * s, 0.24 * s, 0.04 * s);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[CUBE, mat, 12]} frustumCulled={false} />;
}

/** Les papillons : deux ailes de couleur qui battent, autour du potager, des fleurs de devant et de la terrasse. */
const PAPILLONS: [number, number, string][] = [[43.2, 4.5, '#f2c94c'], [44.5, 7.5, '#ffffff'], [8.0, 32.3, '#f2a33a'], [2.6, 32.5, '#5ab0f0'], [-4.5, 20.4, '#f77fbf'], [41.0, 11.4, '#f2c94c']];
function Papillons() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), []);
  const pret = useRef(false);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    if (!pret.current) { const c = new THREE.Color(); PAPILLONS.forEach(([, , col], i) => { m.setColorAt(i * 2, c.set(col)); m.setColorAt(i * 2 + 1, c.set(col)); }); if (m.instanceColor) m.instanceColor.needsUpdate = true; pret.current = true; }
    const t = clock.elapsedTime, s = jour() ? 1 : 0;
    PAPILLONS.forEach(([x0, y0], i) => {
      const x = x0 + Math.sin(t * 0.7 + i) * 0.9 + Math.sin(t * 1.9 + i * 2) * 0.2, y = y0 + Math.cos(t * 0.5 + i * 1.3) * 0.7, z = 0.6 + Math.sin(t * 1.3 + i) * 0.25;
      const batt = 0.04 + Math.abs(Math.sin(t * 12 + i)) * 0.11;
      poser(m, i * 2, x - batt / 2 - 0.01, y, z, batt * s, 0.1 * s, 0.1 * s);
      poser(m, i * 2 + 1, x + batt / 2 + 0.01, y, z, batt * s, 0.1 * s, 0.1 * s);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[CUBE, mat, PAPILLONS.length * 2]} frustumCulled={false} />;
}

/** Le margouillat, sur la face extérieure du mur de gauche, au ras du sol (il reste là quand le mur se baisse). */
function Margouillat() {
  const ref = useRef<THREE.Group>(null);
  const corps = useMemo(() => [
    { x: -0.43, y: 24.0, z: 0.18, w: 0.06, d: 0.34, h: 0.1, c: '#3a4f8a' }, // le corps
    { x: -0.44, y: 23.72, z: 0.19, w: 0.07, d: 0.16, h: 0.11, c: '#e8742a' }, // la tête orange
    { x: -0.42, y: 24.34, z: 0.2, w: 0.04, d: 0.42, h: 0.04, c: '#4a5f9a' }, // la queue
    { x: -0.42, y: 23.9, z: 0.12, w: 0.04, d: 0.04, h: 0.06, c: '#3a4f8a' }, { x: -0.42, y: 24.25, z: 0.12, w: 0.04, d: 0.04, h: 0.06, c: '#3a4f8a' }, // les pattes
  ], []);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime % 9;
    // ses pompes : trois petits coups d'avant en arrière, puis il ne bouge plus ; de temps en temps, il file un peu
    ref.current.position.x = t < 1.5 ? -Math.abs(Math.sin(t * Math.PI * 2)) * 0.03 : 0;
    ref.current.position.z = t > 6 ? Math.sin(((t - 6) / 3) * Math.PI) * 0.48 : 0;
  });
  return <group ref={ref}><Blocs blocs={corps} /></group>;
}

/** L'eau qui tombe de la cascade : des gouttes qui glissent le long du rideau d'eau, puis recommencent en haut. */
function Cascade() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#e6f2fa' }), []);
  const gouttes = useMemo(() => { const r = rng(3); return Array.from({ length: 26 }, () => ({ x: CASCADE.x + 0.06 + r() * (CASCADE.w - 0.12), d: r(), v: 1.6 + r() * 0.9 })); }, []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime, y = ILE.y + ILE.d + 0.2;
    gouttes.forEach((g, i) => { const f = (t * g.v * 0.25 + g.d) % 1; poser(m, i, g.x, y, -f * 4.2, 0.06, 0.06, 0.18); });
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[CUBE, mat, 26]} frustumCulled={false} />;
}

/** Trois petites îles flottantes, autour de la grande : elles montent et descendent tout doucement. */
const ILOTS: { x: number; y: number; z: number; rayon: number; graine: number }[] = [
  { x: ILE.x - 4.6, y: 12, z: -0.9, rayon: 1.6, graine: 11 },
  { x: ILE.x + ILE.w + 4.2, y: 4, z: 0.2, rayon: 1.2, graine: 12 },
  { x: 8, y: ILE.y + ILE.d + 4.5, z: -1.6, rayon: 1.4, graine: 13 },
];
function Ilots() {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const blocs = useMemo(() => ILOTS.map(i => ilot(rng(i.graine), i.rayon)), []);
  useFrame(({ clock }) => {
    ILOTS.forEach((i, k) => { const g = refs.current[k]; if (g) g.position.y = i.z + Math.sin(clock.elapsedTime * 0.5 + k * 2) * 0.12; });
  });
  return (
    <>
      {ILOTS.map((i, k) => (
        <group key={k} ref={el => { refs.current[k] = el; }} position={[i.x, i.z, i.y]}><Blocs blocs={blocs[k]} /></group>
      ))}
    </>
  );
}

export function Vie() {
  return (
    <group>
      <Oiseaux />
      <Papillons />
      <Margouillat />
      <Cascade />
      <Ilots />
    </group>
  );
}
