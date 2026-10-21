/**
 * Barebow visual.
 *
 * Rule-legal barebow: riser, limbs, string, rest and plunger — no sight, no
 * stabiliser, no clicker. The archer aims by string picture and gap, which is
 * why the first-person view shows the arrow tip and the string blur rather than
 * a pin.
 */

import * as THREE from 'three';
import { clamp } from '@shared/math/random';
import {
  braceHeightM,
  drawStrokeM,
  DynamicLine,
  roundedRect,
  standardMaterial,
  type BowBuildOptions,
  type BowVisual,
} from './bowTypes';

export function buildBarebow(options: BowBuildOptions): BowVisual {
  const { gear } = options;
  const group = new THREE.Group();
  group.name = 'barebow';

  const accent = options.accent ?? 0x3ddc84;
  const riserMat = standardMaterial(0x3a2a1c, 0.55, 0.25);
  const accentMat = standardMaterial(accent, 0.5, 0.15);
  const limbMat = standardMaterial(0x1a1512, 0.5, 0.1);
  const metalMat = standardMaterial(0xa8b0b8, 0.35, 0.9);
  const rubberMat = standardMaterial(0x151312, 0.95, 0);

  const riserShape = roundedRect(0.05, 0.6, 0.02);
  const window = new THREE.Path();
  window.moveTo(-0.006, 0.02);
  window.lineTo(0.024, 0.02);
  window.lineTo(0.024, 0.16);
  window.lineTo(-0.006, 0.16);
  window.closePath();
  riserShape.holes.push(window);

  const riserGeo = new THREE.ExtrudeGeometry(riserShape, {
    depth: 0.045,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
    curveSegments: 8,
  });
  riserGeo.translate(0, 0, -0.0225);
  group.add(new THREE.Mesh(riserGeo, riserMat));

  const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.085, 4, 8), rubberMat);
  grip.position.set(0.026, -0.005, -0.004);
  grip.scale.set(0.9, 1, 1.25);
  group.add(grip);

  // Wooden riser grain: a few thin accent lines.
  for (let i = 0; i < 3; i++) {
    const grain = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.16, 0.047), accentMat);
    grain.position.set(-0.026 + i * 0.004, -0.18 + i * 0.01, 0);
    group.add(grain);
  }

  for (const sign of [1, -1]) {
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.045, 0.045), metalMat);
    pocket.position.set(0, sign * 0.3, 0);
    group.add(pocket);
  }

  const limbs: { root: THREE.Group; mid: THREE.Group; tip: THREE.Object3D; sign: number }[] = [];
  for (const sign of [1, -1]) {
    const root = new THREE.Group();
    root.position.set(0, sign * 0.3, 0);
    group.add(root);

    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.23, 0.012), limbMat);
    lower.position.set(0, sign * 0.115, 0);
    root.add(lower);

    const mid = new THREE.Group();
    mid.position.set(0, sign * 0.23, 0);
    root.add(mid);

    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.21, 0.01), limbMat);
    upper.position.set(0, sign * 0.105, 0);
    mid.add(upper);

    const tipAnchor = new THREE.Object3D();
    tipAnchor.position.set(0, sign * 0.215, 0);
    mid.add(tipAnchor);

    limbs.push({ root, mid, tip: tipAnchor, sign });
  }

  const string = new DynamicLine(0xd8d0bc, 1, 3);
  group.add(string.line);

  // Rest and plunger only (no clicker, no sight).
  const rest = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.045), metalMat);
  rest.position.set(0.018, 0.032, 0.02);
  group.add(rest);
  const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.026, 8), metalMat);
  plunger.rotation.z = Math.PI / 2;
  plunger.position.set(0.03, 0.028, 0.008);
  group.add(plunger);

  // A leather shelf pad, typical of barebow risers.
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.004, 0.03), standardMaterial(0x5a4632, 0.9, 0));
  pad.position.set(0.014, 0.026, 0.03);
  group.add(pad);

  const nockLocal = new THREE.Vector3(0, 0.012, -(braceHeightM(gear) + drawStrokeM(gear)));
  const stroke = drawStrokeM(gear);
  const brace = braceHeightM(gear);
  const topTip = new THREE.Vector3();
  const bottomTip = new THREE.Vector3();

  const update = (drawFraction: number, recoil: number, time: number): void => {
    const draw = clamp(drawFraction, 0, 1);
    const bend = 0.18 * draw + Math.sin(time * 43) * 0.025 * recoil;
    const top = limbs.find((l) => l.sign === 1)!;
    const bottom = limbs.find((l) => l.sign === -1)!;
    top.root.rotation.x = -bend * 0.5;
    top.mid.rotation.x = -bend * 0.8;
    bottom.root.rotation.x = bend * 0.5;
    bottom.mid.rotation.x = bend * 0.8;

    group.updateMatrixWorld(true);
    top.tip.getWorldPosition(topTip);
    bottom.tip.getWorldPosition(bottomTip);
    group.worldToLocal(topTip);
    group.worldToLocal(bottomTip);

    nockLocal.set(0, 0.012, -(brace + stroke * draw));
    string.set([topTip, nockLocal, bottomTip]);
  };

  update(0, 0, 0);

  return {
    group,
    update,
    nockLocal,
    sightPin: null,
    scopeMagnification: 1,
    releaseAid: null,
    dispose() {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      string.dispose();
    },
  };
}
