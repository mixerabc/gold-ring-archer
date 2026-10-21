/**
 * Compound bow visual.
 *
 * Cam system with cables and idler wheels, a rigid riser, a let-off valley
 * (the cams spin while the string barely moves at the end of the draw), a
 * scope with a level bubble, a peep sight and a mechanical release aid.
 *
 * The visual draw is compressed after the peak, exactly like the force curve in
 * `shared/physics/bow.ts`: the last 15% of the draw moves the string very
 * little while the cams roll over.
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

export function buildCompound(options: BowBuildOptions): BowVisual {
  const { gear } = options;
  const group = new THREE.Group();
  group.name = 'compound';

  const accent = options.accent ?? 0x57a6ff;
  const riserMat = standardMaterial(0x24282e, 0.32, 0.8);
  const accentMat = standardMaterial(accent, 0.28, 0.85);
  const limbMat = standardMaterial(0x101317, 0.24, 0.3);
  const metalMat = standardMaterial(0xc3ccd6, 0.22, 0.95);
  const camMat = standardMaterial(0x2c333b, 0.3, 0.9);
  const rubberMat = standardMaterial(0x121518, 0.95, 0);

  // Riser: shorter and deeper than a recurve, with a large cut-out.
  const riserShape = roundedRect(0.05, 0.5, 0.02);
  const window = new THREE.Path();
  window.moveTo(-0.008, -0.02);
  window.lineTo(0.022, -0.02);
  window.lineTo(0.022, 0.15);
  window.lineTo(-0.008, 0.15);
  window.closePath();
  riserShape.holes.push(window);

  const riserGeo = new THREE.ExtrudeGeometry(riserShape, {
    depth: 0.055,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 2,
    curveSegments: 8,
  });
  riserGeo.translate(0, 0, -0.0275);
  group.add(new THREE.Mesh(riserGeo, riserMat));

  const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.021, 0.08, 4, 8), rubberMat);
  grip.position.set(0.03, -0.02, -0.004);
  grip.scale.set(0.9, 1, 1.35);
  group.add(grip);

  const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.18, 0.058), accentMat);
  inlay.position.set(-0.027, 0.16, 0);
  group.add(inlay);

  // Limbs: short, stiff, angled out of the pockets.
  const limbs: { root: THREE.Group; cam: THREE.Group; sign: number }[] = [];
  for (const sign of [1, -1]) {
    const root = new THREE.Group();
    root.position.set(0, sign * 0.245, 0);
    root.rotation.x = sign * -0.22;
    group.add(root);

    const limb = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.22, 0.016), limbMat);
    limb.position.set(0, sign * 0.11, 0);
    root.add(limb);

    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.045, 0.06), metalMat);
    pocket.position.set(0, sign * 0.01, 0);
    root.add(pocket);

    // Cam: a grooved wheel on a short axle.
    const cam = new THREE.Group();
    cam.position.set(0, sign * 0.235, 0);
    root.add(cam);

    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.018, 24), camMat);
    wheel.rotation.x = Math.PI / 2;
    cam.add(wheel);
    const groove = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.004, 6, 24), metalMat);
    cam.add(groove);
    const module = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.03, 0.022), accentMat);
    module.position.set(0.028, 0, 0);
    cam.add(module);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.05, 8), metalMat);
    axle.rotation.x = Math.PI / 2;
    cam.add(axle);

    limbs.push({ root, cam, sign });
  }

  // String and cables.
  const string = new DynamicLine(0xdfe6ee, 1, 3);
  group.add(string.line);
  const cableA = new DynamicLine(0x8b96a2, 0.95, 2);
  const cableB = new DynamicLine(0x8b96a2, 0.95, 2);
  group.add(cableA.line, cableB.line);

  // Arrow rest (drop-away) and plunger-free mount.
  const restPivot = new THREE.Group();
  restPivot.position.set(0.022, 0.025, 0.025);
  group.add(restPivot);
  const launcher = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.045, 0.05), metalMat);
  launcher.position.set(0, 0.02, 0.02);
  restPivot.add(launcher);

  // Scope on a bar, with a level bubble.
  const scope = new THREE.Group();
  // Offset to the arrow line, like a real scope dovetail.
  scope.position.set(-0.1, 0.14, 0.035);
  group.add(scope);

  const scopeBar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.012), metalMat);
  scopeBar.position.set(0.05, 0.14, 0.035);
  group.add(scopeBar);

  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 8), metalMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.z = 0.06;
  scope.add(bar);

  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.035, 24), camMat);
  housing.rotation.x = Math.PI / 2;
  housing.position.z = 0.13;
  scope.add(housing);

  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1a22,
    roughness: 0.05,
    metalness: 0.1,
    transmission: 0.35,
    thickness: 0.01,
    transparent: true,
    opacity: 0.85,
  });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 28), lensMat);
  lens.position.z = 0.149;
  scope.add(lens);

  const reticle = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0008, 6, 24), standardMaterial(0xff5a3c, 0.4, 0.2));
  reticle.position.z = 0.1505;
  scope.add(reticle);

  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), standardMaterial(0xff5a3c, 0.4, 0.2));
  pin.position.z = 0.1505;
  scope.add(pin);

  const bubbleTube = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.008, 0.006), standardMaterial(0x11161b, 0.4, 0.3));
  bubbleTube.position.set(0, -0.036, 0.13);
  scope.add(bubbleTube);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 8, 6), standardMaterial(0x5ce0a0, 0.3, 0.1));
  bubble.position.set(0, -0.036, 0.134);
  scope.add(bubble);

  const elevationM = gear.sightElevationMm / 1000;
  scope.position.y = 0.14 + elevationM;
  scope.position.x = gear.sightWindageMm / 1000;

  // Peep sight: a small ring served into the string.
  const peep = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0022, 6, 18), camMat);
  peep.visible = false;
  group.add(peep);

  // Release aid: body, jaws and a wrist strap. It lives at the nock point and
  // is shown while the string is drawn.
  const release = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.075, 0.018), metalMat);
  body.rotation.x = 0.25;
  release.add(body);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.02, 0.012), standardMaterial(0x2a2f36, 0.3, 0.9));
  jaw.position.set(0, 0.045, 0.006);
  release.add(jaw);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.004, 6, 16), rubberMat);
  strap.position.set(0, -0.06, -0.02);
  strap.rotation.x = Math.PI / 2;
  release.add(strap);
  group.add(release);

  const nockLocal = new THREE.Vector3(0, 0.012, -braceHeightM(gear));
  const stroke = drawStrokeM(gear);
  const brace = braceHeightM(gear);
  const topTip = new THREE.Vector3();
  const bottomTip = new THREE.Vector3();

  const update = (drawFraction: number, recoil: number, time: number): void => {
    const draw = clamp(drawFraction, 0, 1);
    // Cam roll: most of the rotation happens early, then it locks at the wall.
    const camSpin = draw * Math.PI * 2.1;
    const top = limbs.find((l) => l.sign === 1)!;
    const bottom = limbs.find((l) => l.sign === -1)!;
    top.cam.rotation.z = -camSpin;
    bottom.cam.rotation.z = camSpin;
    const flex = Math.sin(time * 52) * 0.012 * recoil;
    top.root.rotation.x = -0.22 + flex;
    bottom.root.rotation.x = 0.22 - flex;

    // Let-off: the last 15% of draw moves the string only a little.
    const stringDraw = draw <= 0.85 ? draw / 0.85 : 1 + (draw - 0.85) * 0.12;
    nockLocal.set(0, 0.012, -(brace + stroke * Math.min(1.02, stringDraw)));

    group.updateMatrixWorld(true);
    top.cam.getWorldPosition(topTip);
    bottom.cam.getWorldPosition(bottomTip);
    group.worldToLocal(topTip);
    group.worldToLocal(bottomTip);

    string.set([topTip, nockLocal, bottomTip]);
    cableA.set([topTip.clone().add(new THREE.Vector3(-0.012, 0, 0)), bottomTip.clone().add(new THREE.Vector3(-0.012, 0, 0))]);
    cableB.set([topTip.clone().add(new THREE.Vector3(0.012, 0, 0)), bottomTip.clone().add(new THREE.Vector3(0.012, 0, 0))]);

    // Peep sits a hand's width above the nock along the string.
    peep.visible = draw > 0.25;
    peep.position.copy(nockLocal).add(new THREE.Vector3(0, 0.14, 0.01));
    peep.rotation.z = 0.2;

    // Release aid follows the nock; the drop-away rest falls as the string leaves.
    release.position.copy(nockLocal);
    release.visible = draw > 0.05;
    restPivot.rotation.x = draw > 0.02 ? -0.1 : 0.9;

    // Bubble slides with the cant (the game passes it through the group's z rotation).
    bubble.position.x = clamp(group.rotation.z * 0.6, -0.014, 0.014);
  };

  update(0, 0, 0);

  return {
    group,
    update,
    nockLocal,
    sightPin: pin,
    scopeMagnification: gear.sightId?.includes('6') ? 6 : 4,
    releaseAid: release,
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
      cableA.dispose();
      cableB.dispose();
    },
  };
}
