/**
 * Olympic recurve visual.
 *
 * ILF-style take-down riser with a sight window, two recurved limbs, a served
 * string, a clicker, a magnetic rest and plunger, a long-rod/side-rod
 * stabiliser and a pin sight with extension.
 *
 * The limb bend and the string V are driven by the draw fraction, so what the
 * third-person camera sees matches the draw meter and the physics.
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

export function buildRecurve(options: BowBuildOptions): BowVisual {
  const { gear } = options;
  const group = new THREE.Group();
  group.name = 'recurve';

  const riserColor = 0x1b2a3a;
  const accent = options.accent ?? 0xf5c518;
  const riserMat = standardMaterial(riserColor, 0.34, 0.72);
  const accentMat = standardMaterial(accent, 0.3, 0.8);
  const limbMat = standardMaterial(0x11151a, 0.22, 0.35);
  const metalMat = standardMaterial(0xb9c2cc, 0.24, 0.95);
  const rubberMat = standardMaterial(0x14171a, 0.92, 0);
  const stringMatColor = 0xe8e2d2;

  // Riser: extruded silhouette with a sight window cut out.
  const riserShape = roundedRect(0.058, 0.63, 0.018);
  const windowPath = new THREE.Path();
  const ww = 0.03;
  const wh = 0.17;
  windowPath.moveTo(-ww / 2 + 0.012, 0.03);
  windowPath.lineTo(ww / 2 + 0.012, 0.03);
  windowPath.lineTo(ww / 2 + 0.012, 0.03 + wh);
  windowPath.lineTo(-ww / 2 + 0.012, 0.03 + wh);
  windowPath.closePath();
  riserShape.holes.push(windowPath);

  const riserGeo = new THREE.ExtrudeGeometry(riserShape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
    curveSegments: 10,
  });
  riserGeo.translate(0, 0, -0.025);
  const riser = new THREE.Mesh(riserGeo, riserMat);
  group.add(riser);

  // Grip: a rubber block on the back of the riser.
  const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.09, 4, 8), rubberMat);
  grip.position.set(0.028, -0.01, -0.005);
  grip.scale.set(0.85, 1, 1.3);
  group.add(grip);

  // Riser accent inlay.
  const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.2, 0.052), accentMat);
  inlay.position.set(-0.03, -0.18, 0);
  group.add(inlay);

  // Limb pockets.
  for (const sign of [1, -1]) {
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), metalMat);
    pocket.position.set(0, sign * 0.315, 0);
    group.add(pocket);
  }

  // Limbs: two segments each so they can bend progressively.
  const limbs: { root: THREE.Group; mid: THREE.Group; tip: THREE.Object3D; sign: number }[] = [];
  for (const sign of [1, -1]) {
    const root = new THREE.Group();
    root.position.set(0, sign * 0.315, 0);
    group.add(root);

    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.22, 0.013), limbMat);
    lower.position.set(0, sign * 0.11, 0);
    root.add(lower);

    const mid = new THREE.Group();
    mid.position.set(0, sign * 0.22, 0);
    root.add(mid);

    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.2, 0.011), limbMat);
    upper.position.set(0, sign * 0.1, 0);
    mid.add(upper);

    // Recurve tip: the last few centimetres curve back towards the archer.
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.06, 0.01), limbMat);
    tip.position.set(0, sign * 0.215, -0.018);
    tip.rotation.x = sign * 0.5;
    mid.add(tip);

    const tipAnchor = new THREE.Object3D();
    tipAnchor.position.set(0, sign * 0.235, -0.038);
    mid.add(tipAnchor);

    // Limb decal.
    const decal = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.002), accentMat);
    decal.position.set(0, sign * 0.13, 0.008);
    root.add(decal);

    limbs.push({ root, mid, tip: tipAnchor, sign });
  }

  // String.
  const string = new DynamicLine(stringMatColor, 1, 3);
  group.add(string.line);

  // Serving (a slightly thicker line around the nock point).
  const serving = new DynamicLine(0x3a3f46, 1, 3);
  group.add(serving.line);

  // Arrow rest and plunger.
  const rest = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.05), metalMat);
  rest.position.set(0.02, 0.035, 0.02);
  group.add(rest);
  const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 8), metalMat);
  plunger.rotation.z = Math.PI / 2;
  plunger.position.set(0.032, 0.03, 0.01);
  group.add(plunger);

  // Clicker: a thin spring plate that the arrow pulls past.
  const clicker = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.1, 0.012), metalMat);
  clicker.position.set(0.026, 0.1, 0.055);
  group.add(clicker);

  // Sight: extension bar, vertical bar, aperture and pin.
  const sight = new THREE.Group();
  // The aperture sits on a dovetail to the right of the riser, so the pin can
  // line up with the arrow and the eye while the riser stays out of the way.
  sight.position.set(-0.11, 0.13, 0.03);
  group.add(sight);

  const sightBar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.012), metalMat);
  sightBar.position.set(0.055, 0.13, 0.03);
  group.add(sightBar);

  const extension = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.15, 8), metalMat);
  extension.rotation.x = Math.PI / 2;
  extension.position.set(0, 0, 0.075);
  sight.add(extension);

  const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.14, 0.008), metalMat);
  vertical.position.set(0, 0.04, 0.15);
  sight.add(vertical);

  const aperture = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0018, 8, 28), metalMat);
  aperture.position.set(0, 0.06, 0.155);
  sight.add(aperture);

  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 8, 6), accentMat);
  pin.position.set(0, 0.06, 0.155);
  sight.add(pin);

  const pinGlow = new THREE.PointLight(accent, 0.06, 0.2);
  pinGlow.position.copy(pin.position);
  sight.add(pinGlow);

  // Apply the sight marks from the gear setup.
  const elevationM = gear.sightElevationMm / 1000;
  const windageM = gear.sightWindageMm / 1000;
  aperture.position.y = 0.06 + elevationM;
  pin.position.y = 0.06 + elevationM;
  pin.position.x = windageM;
  pinGlow.position.copy(pin.position);
  sight.position.z = 0.03 + (gear.sightExtensionIn ?? 3) * 0.008;

  // Stabiliser: long rod, V-bar, side rods, weights and dampers.
  const stabiliser = new THREE.Group();
  stabiliser.position.set(0, -0.19, 0.02);
  group.add(stabiliser);

  const longRodLength = 0.72;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, longRodLength, 8), standardMaterial(0x20262e, 0.35, 0.7));
  rod.rotation.x = Math.PI / 2;
  rod.position.z = longRodLength / 2;
  stabiliser.add(rod);

  const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.05, 16), metalMat);
  weight.rotation.x = Math.PI / 2;
  weight.position.z = longRodLength + 0.02;
  stabiliser.add(weight);
  const damper = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 12), rubberMat);
  damper.rotation.x = Math.PI / 2;
  damper.position.z = longRodLength - 0.12;
  stabiliser.add(damper);

  const vbar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.03), metalMat);
  vbar.position.z = 0.07;
  stabiliser.add(vbar);

  for (const sign of [1, -1]) {
    const side = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.34, 8), standardMaterial(0x20262e, 0.35, 0.7));
    side.rotation.x = Math.PI / 2;
    side.rotation.y = sign * 0.62;
    side.position.set(sign * 0.08, 0, 0.2);
    stabiliser.add(side);
    const sideWeight = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 12), metalMat);
    sideWeight.rotation.x = Math.PI / 2;
    sideWeight.position.set(sign * 0.17, 0, 0.36);
    stabiliser.add(sideWeight);
  }

  // The nock point and the string geometry.
  const nockLocal = new THREE.Vector3(0, 0.012, -(braceHeightM(gear) + drawStrokeM(gear)));
  const stroke = drawStrokeM(gear);
  const brace = braceHeightM(gear);
  const topTip = new THREE.Vector3();
  const bottomTip = new THREE.Vector3();

  const update = (drawFraction: number, recoil: number, time: number): void => {
    const draw = clamp(drawFraction, 0, 1);
    const bend = 0.16 * draw + Math.sin(time * 46) * 0.02 * recoil;
    const top = limbs.find((l) => l.sign === 1)!;
    const bottom = limbs.find((l) => l.sign === -1)!;
    top.root.rotation.x = -bend * 0.55;
    top.mid.rotation.x = -bend * 0.75;
    bottom.root.rotation.x = bend * 0.55;
    bottom.mid.rotation.x = bend * 0.75;

    group.updateMatrixWorld(true);
    top.tip.getWorldPosition(topTip);
    bottom.tip.getWorldPosition(bottomTip);
    group.worldToLocal(topTip);
    group.worldToLocal(bottomTip);

    nockLocal.set(0, 0.012, -(brace + stroke * draw));
    // Recoil makes the string ring for a moment after the shot.
    const ring = recoil * Math.sin(time * 60) * 0.012;
    nockLocal.z += ring;

    string.set([topTip, nockLocal, bottomTip]);

    // Serving: a short segment either side of the nock.
    const upper = topTip.clone().lerp(nockLocal, 0.965);
    const lower = bottomTip.clone().lerp(nockLocal, 0.965);
    serving.set([upper, nockLocal, lower]);
  };

  update(0, 0, 0);

  return {
    group,
    update,
    nockLocal,
    sightPin: pin,
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
      serving.dispose();
    },
  };
}
