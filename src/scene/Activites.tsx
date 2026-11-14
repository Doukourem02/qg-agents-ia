'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Blocs } from './Blocs';
import { PORTES_WC } from '@/data/layout';
import { getEngine } from '@/store';

// Ce que la journée de chacun (src/sim/vie.ts) fait bouger dans le décor : les portes des cabines des toilettes (fermée
// quand quelqu'un y est, ouverte sinon), le ballon de chaque match et des paniers de midi, l'arrosoir de celui qui arrose
// le potager. Rien de tout cela n'est une donnée : c'est la vie simulée de l'open space.

const CUBE = new THREE.BoxGeometry(1, 1, 1);
const o = new THREE.Object3D();
const BALLON = 0.17;
const COULEURS = { foot: new THREE.Color('#fbfbf8'), basket: new THREE.Color('#e8742a') };

/** Les portes des quatre cabines : fermée (occupée) ou ouverte vers l'intérieur (libre). */
function PortesWc() {
  const fermees = useRef<(THREE.Group | null)[]>([]);
  const ouvertes = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const occ = getEngine().cabinesOccupees();
    PORTES_WC.forEach((_, i) => {
      const f = fermees.current[i], g = ouvertes.current[i];
      if (f) f.visible = occ[i];
      if (g) g.visible = !occ[i];
    });
  });
  return (
    <>
      {PORTES_WC.map((p, i) => (
        <group key={i}>
          <group ref={el => { fermees.current[i] = el; }} visible={false}><Blocs blocs={p.ferme} /></group>
          <group ref={el => { ouvertes.current[i] = el; }}><Blocs blocs={p.ouverte} /></group>
        </group>
      ))}
    </>
  );
}

/** Les ballons en jeu : blanc au foot, orange au basket ; un petit cube, comme tout le décor. */
function Ballons() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff' }), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const b = getEngine().ballons();
    for (let i = 0; i < 4; i++) {
      const x = b[i];
      o.position.set(x?.x ?? 0, (x?.z ?? -50) + BALLON / 2, x?.y ?? 0);
      o.scale.setScalar(x ? BALLON : 0.0001);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (x) m.setColorAt(i, COULEURS[x.sport]);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[CUBE, mat, 4]} frustumCulled={false} />;
}

/** L'arrosoir de celui qui arrose le potager, et l'eau qui en tombe pendant qu'il arrose. */
function Arrosoir() {
  const ref = useRef<THREE.Group>(null);
  const gouttes = useRef<THREE.InstancedMesh>(null);
  const blocs = useMemo(() => [
    { x: -0.13, y: -0.1, z: 0.32, w: 0.26, d: 0.2, h: 0.2, c: '#3d9c5a' }, // la cuve
    { x: 0.13, y: -0.03, z: 0.44, w: 0.22, d: 0.05, h: 0.04, c: '#3d9c5a' }, // le bec
    { x: -0.05, y: -0.03, z: 0.52, w: 0.1, d: 0.05, h: 0.06, c: '#2f7d45' }, // l'anse
  ], []);
  const eau = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7fc4f0' }), []);
  useFrame(({ clock }) => {
    const e = getEngine(), g = ref.current, m = gouttes.current;
    if (!g || !m) return;
    const a = e.agents.find(x => x.activite?.c.act.type === 'arrosage' && x.activite.phase === 'la' && e.visible(x.id));
    g.visible = !!a;
    if (!a) return;
    g.position.set(a.x + 0.22, 0, a.y + 0.22);
    // l'eau coule quand il est arrêté au bord d'un rang
    const arrose = !a.path.length && a.activite!.etape % 4 !== 0 && a.activite!.etape % 4 !== 3;
    for (let i = 0; i < 4; i++) {
      const f = (clock.elapsedTime * 1.6 + i / 4) % 1;
      o.position.set(0.4 + f * 0.08, 0.44 - f * 0.42, 0);
      o.scale.setScalar(arrose ? 0.045 : 0.0001);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group ref={ref} visible={false}>
      <Blocs blocs={blocs} />
      <instancedMesh ref={gouttes} args={[CUBE, eau, 4]} frustumCulled={false} />
    </group>
  );
}

export function Activites() {
  return (
    <group>
      <PortesWc />
      <Ballons />
      <Arrosoir />
    </group>
  );
}
