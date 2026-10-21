/**
 * Procedural archer.
 *
 * No GLB download is required: the archer is built from capsules and boxes with
 * PBR materials, and posed procedurally. That keeps the project runnable
 * offline (a stated requirement) while still giving a full-body model with the
 * correct side-on stance, a nocking/drawing/release cycle and a visible bow
 * mount for the equipment layer.
 *
 * Hierarchy:
 *   root
 *     hips, torso (rotated side-on), head (turned to the target)
 *     legs (front/back, straddling the shooting line)
 *     arms (bow arm + draw arm, re-posed every frame)
 *     quiver, number bib
 *     bowMount  <- the equipment layer attaches the bow here
 */

import * as THREE from 'three';
import { clamp, lerp } from '@shared/math/random';
import type { Handedness } from '@shared/types';
import { nockPosition, stanceFor, type StancePose } from './stance';
import { damp } from './animations';

export interface ArcherOptions {
  handedness?: Handedness;
  kitColor?: number;
  accentColor?: number;
  skinColor?: number;
  bibNumber?: string;
}

interface ArmRig {
  shoulder: THREE.Vector3;
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  joint: THREE.Mesh;
  hand: THREE.Mesh;
  wrist: THREE.Mesh;
}

export class ArcherModel {
  readonly root = new THREE.Group();
  readonly bowMount = new THREE.Group();
  readonly head = new THREE.Group();
  readonly torso = new THREE.Group();

  private stance: StancePose;
  private handedness: Handedness;
  private mirror: 1 | -1;

  private hips: THREE.Mesh;
  private torsoMesh: THREE.Mesh;
  private bowArm: ArmRig;
  private drawArm: ArmRig;
  private legs: { thigh: THREE.Mesh; shin: THREE.Mesh; foot: THREE.Mesh }[] = [];
  private quiver: THREE.Group;

  private drawVisual = 0;
  private raiseVisual = 0;
  private releaseTimer = -1;
  private releaseQuality = 1;
  private time = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  private cant = 0;
  private tremor = 0;

  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor(options: ArcherOptions = {}) {
    this.handedness = options.handedness ?? 'right';
    this.mirror = this.handedness === 'right' ? 1 : -1;
    this.stance = stanceFor(this.handedness);

    const skin = this.material(0xc98f6d, 0.72, 0);
    const kit = this.material(options.kitColor ?? 0x16365f, 0.78, 0.04);
    const accent = this.material(options.accentColor ?? 0xf5c518, 0.55, 0.15);
    const pants = this.material(0x1b2029, 0.85, 0.02);
    const shoe = this.material(0x11151a, 0.6, 0.1);
    const hair = this.material(0x241a14, 0.9, 0);
    const leather = this.material(0x5a4632, 0.8, 0.05);

    // Hips and torso.
    this.hips = this.mesh(new THREE.CapsuleGeometry(0.135, 0.1, 4, 12), pants);
    this.hips.position.set(0, this.stance.hipHeight, 0);
    this.hips.scale.set(1.15, 1, 0.8);
    this.root.add(this.hips);

    this.torso.position.set(0, this.stance.hipHeight + 0.04, 0);
    this.torso.rotation.y = this.stance.bodyYaw;
    this.root.add(this.torso);

    this.torsoMesh = this.mesh(new THREE.CapsuleGeometry(0.155, 0.3, 6, 14), kit);
    this.torsoMesh.position.set(0, 0.3, 0);
    this.torsoMesh.scale.set(1.18, 1, 0.72);
    this.torso.add(this.torsoMesh);

    // Chest accent stripe (national kit).
    const stripe = this.mesh(new THREE.BoxGeometry(0.035, 0.34, 0.235), accent);
    stripe.position.set(0.12, 0.32, 0);
    this.torso.add(stripe);

    // Number bib on the chest.
    const bib = this.mesh(new THREE.PlaneGeometry(0.17, 0.2), this.bibMaterial(options.bibNumber ?? '07'));
    bib.position.set(0, 0.3, 0.12);
    this.torso.add(bib);

    // Head.
    this.head.position.set(0, this.stance.hipHeight + 0.62, 0);
    this.head.rotation.y = this.stance.headYaw;
    this.root.add(this.head);

    const skull = this.mesh(new THREE.SphereGeometry(0.105, 18, 14), skin);
    skull.scale.set(1, 1.12, 1.02);
    this.head.add(skull);

    const nose = this.mesh(new THREE.SphereGeometry(0.022, 8, 6), skin);
    nose.position.set(0, -0.01, 0.1);
    this.head.add(nose);

    const cap = this.mesh(new THREE.SphereGeometry(0.112, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), kit);
    cap.position.y = 0.015;
    this.head.add(cap);

    const brim = this.mesh(new THREE.BoxGeometry(0.16, 0.012, 0.11), kit);
    brim.position.set(0, 0.02, 0.08);
    this.head.add(brim);

    const hairBack = this.mesh(new THREE.SphereGeometry(0.098, 12, 8), hair);
    hairBack.position.set(0, -0.03, -0.035);
    hairBack.scale.set(1, 0.9, 0.9);
    this.head.add(hairBack);

    // Legs: hip -> knee -> ankle for each side, built from tapered cylinders.
    const legSpecs = [
      { hip: new THREE.Vector3(this.mirror * -0.1, this.stance.hipHeight - 0.04, 0.02), foot: this.stance.frontFoot, front: true },
      { hip: new THREE.Vector3(this.mirror * 0.1, this.stance.hipHeight - 0.04, -0.02), foot: this.stance.backFoot, front: false },
    ];
    for (const spec of legSpecs) {
      const knee = new THREE.Vector3(
        (spec.hip.x + spec.foot.x) / 2 + this.mirror * 0.02,
        0.5,
        (spec.hip.z + spec.foot.z) / 2 + 0.04,
      );
      const thigh = this.mesh(new THREE.CylinderGeometry(0.075, 0.062, 1, 10), pants);
      const shin = this.mesh(new THREE.CylinderGeometry(0.06, 0.045, 1, 10), pants);
      const foot = this.mesh(new THREE.BoxGeometry(0.1, 0.07, 0.27), shoe);
      foot.position.set(spec.foot.x, 0.045, spec.foot.z + 0.03);
      foot.rotation.y = this.mirror * Math.PI * 0.5;
      this.root.add(thigh, shin, foot);
      this.placeSegment(thigh, spec.hip, knee);
      this.placeSegment(shin, knee, new THREE.Vector3(spec.foot.x, 0.08, spec.foot.z));
      this.legs.push({ thigh, shin, foot });
    }

    // Arms.
    this.bowArm = this.buildArm(kit, skin, accent);
    this.drawArm = this.buildArm(kit, skin, accent);

    // Quiver on the back, angled, with a few arrow nocks showing.
    this.quiver = new THREE.Group();
    this.quiver.position.set(this.mirror * 0.1, this.stance.hipHeight + 0.22, -0.2);
    this.quiver.rotation.set(0.25, 0, this.mirror * -0.35);
    const tube = this.mesh(new THREE.CylinderGeometry(0.055, 0.048, 0.42, 12, 1, true), leather);
    this.quiver.add(tube);
    for (let i = 0; i < 4; i++) {
      const shaft = this.mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 5), this.material(0x20242a, 0.5, 0.3));
      shaft.position.set((i - 1.5) * 0.018, 0.24, (i % 2) * 0.012);
      this.quiver.add(shaft);
      const vane = this.mesh(new THREE.PlaneGeometry(0.02, 0.05), this.material(i % 2 ? 0xf5c518 : 0xe8eef5, 0.7, 0));
      vane.position.copy(shaft.position).add(new THREE.Vector3(0, 0.05, 0));
      this.quiver.add(vane);
    }
    this.root.add(this.quiver);

    // Bow mount: the equipment layer puts a bow in this group.
    this.bowMount.name = 'bowMount';
    this.root.add(this.bowMount);

    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    this.applyHandedness();
  }

  private material(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.materials.push(mat);
    return mat;
  }

  private bibMaterial(number: string): THREE.MeshStandardMaterial {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f2f5f8';
    ctx.fillRect(0, 0, 256, 300);
    ctx.fillStyle = '#0d1116';
    ctx.font = 'bold 150px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(number, 128, 150);
    ctx.strokeStyle = '#c8d0d8';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 248, 292);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8, metalness: 0 });
    this.materials.push(mat);
    return mat;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.geometries.push(geometry);
    return new THREE.Mesh(geometry, material);
  }

  private buildArm(kit: THREE.Material, skin: THREE.Material, accent: THREE.Material): ArmRig {
    const upper = this.mesh(new THREE.CylinderGeometry(0.055, 0.045, 1, 10), kit);
    const fore = this.mesh(new THREE.CylinderGeometry(0.043, 0.034, 1, 10), skin);
    const joint = this.mesh(new THREE.SphereGeometry(0.05, 10, 8), kit);
    const hand = this.mesh(new THREE.SphereGeometry(0.042, 10, 8), skin);
    hand.scale.set(0.85, 1.1, 0.75);
    const wrist = this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 10), accent);
    this.root.add(upper, fore, joint, hand, wrist);
    return { shoulder: new THREE.Vector3(), upper, fore, joint, hand, wrist };
  }

  private placeSegment(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = Math.max(0.01, dir.length());
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.scale.set(1, len, 1);
  }

  setHandedness(handedness: Handedness): void {
    if (this.handedness === handedness) return;
    this.handedness = handedness;
    this.mirror = handedness === 'right' ? 1 : -1;
    this.stance = stanceFor(handedness);
    this.applyHandedness();
  }

  private applyHandedness(): void {
    this.torso.rotation.y = this.stance.bodyYaw;
    this.head.rotation.y = this.stance.headYaw;
    this.quiver.position.x = this.mirror * 0.1;
    this.quiver.rotation.z = this.mirror * -0.35;
    this.legs[0]?.foot.position.set(this.stance.frontFoot.x, 0.045, this.stance.frontFoot.z + 0.03);
    this.legs[1]?.foot.position.set(this.stance.backFoot.x, 0.045, this.stance.backFoot.z + 0.03);
    this.legs.forEach((leg) => {
      leg.foot.rotation.y = this.mirror * Math.PI * 0.5;
    });
  }

  /** Smoothly follow the draw controller. */
  setDraw(drawFraction: number, drawing: boolean): void {
    this.targetDraw = clamp(drawFraction, 0, 1);
    this.targetRaise = drawing || drawFraction > 0.01 ? 1 : 0;
  }

  private targetDraw = 0;
  private targetRaise = 0;

  setAim(yaw: number, pitch: number, cant: number, tremor: number): void {
    this.aimYaw = yaw;
    this.aimPitch = pitch;
    this.cant = cant;
    this.tremor = tremor;
  }

  /** Play the release: hand snaps back, bow jumps, head stays on target. */
  triggerRelease(quality: number): void {
    this.releaseTimer = 0;
    this.releaseQuality = clamp(quality, 0, 1);
  }

  get eyePosition(): THREE.Vector3 {
    const eye = new THREE.Vector3(this.mirror * -0.02, this.stance.hipHeight + 0.675, 0.09);
    return this.root.localToWorld(eye);
  }

  get anchorWorld(): THREE.Vector3 {
    return this.root.localToWorld(new THREE.Vector3(this.stance.anchor.x, this.stance.anchor.y, this.stance.anchor.z));
  }

  /** World-space hand position (used by the bow and the arrow). */
  get bowHandWorld(): THREE.Vector3 {
    return this.bowArm.hand.getWorldPosition(new THREE.Vector3());
  }

  update(dt: number): void {
    this.time += dt;
    this.drawVisual = damp(this.drawVisual, this.targetDraw, 12, dt);
    this.raiseVisual = damp(this.raiseVisual, this.targetRaise, 7, dt);

    if (this.releaseTimer >= 0) {
      this.releaseTimer += dt;
      if (this.releaseTimer > 1.4) this.releaseTimer = -1;
    }

    const breath = Math.sin(this.time * 1.55) * 0.006;
    this.torso.position.y = this.stance.hipHeight + 0.04 + breath;
    this.head.position.y = this.stance.hipHeight + 0.62 + breath * 1.4;
    this.torsoMesh.scale.y = 1 + Math.sin(this.time * 1.55) * 0.008;

    const draw = this.drawVisual;
    const raised = this.raiseVisual;

    // Bow hand: from the relaxed position at the hip to the full-draw position.
    const restBowHand = new THREE.Vector3(this.mirror * 0.2, this.stance.hipHeight + 0.12, 0.12);
    const fullBowHand = new THREE.Vector3(this.stance.bowHand.x, this.stance.bowHand.y, this.stance.bowHand.z);
    const bowHand = restBowHand.clone().lerp(fullBowHand, raised);
    // Small tremor at full draw.
    const tremble = this.tremor * 0.004;
    bowHand.x += Math.sin(this.time * 31) * tremble;
    bowHand.y += Math.sin(this.time * 27.3) * tremble * 0.7;

    // Draw hand follows the string; at rest it hangs by the hip.
    const nock = nockPosition(this.stance, draw);
    const restDrawHand = new THREE.Vector3(this.mirror * -0.12, this.stance.hipHeight + 0.1, 0.05);
    const drawHand = restDrawHand.clone().lerp(new THREE.Vector3(nock.x, nock.y, nock.z), raised);

    // Release: the string hand flies back past the ear.
    if (this.releaseTimer >= 0) {
      const t = Math.min(1, this.releaseTimer / 0.16);
      const back = new THREE.Vector3(this.mirror * -0.22, this.stance.hipHeight + 0.58, -0.26);
      drawHand.lerp(back, t);
      // Punished release: a little sideways flinch.
      drawHand.x += (1 - this.releaseQuality) * 0.08 * t;
    }

    const bowShoulder = new THREE.Vector3(this.mirror * 0.12, this.stance.hipHeight + 0.53, 0.14);
    const drawShoulder = new THREE.Vector3(this.mirror * -0.12, this.stance.hipHeight + 0.53, -0.14);

    const bowElbow = new THREE.Vector3(
      lerp(this.mirror * 0.22, this.mirror * 0.16, raised),
      this.stance.hipHeight + 0.34 + raised * 0.14,
      lerp(0.02, 0.36, raised),
    );
    const drawElbow = new THREE.Vector3(
      this.mirror * -lerp(0.24, 0.3, draw),
      this.stance.hipHeight + lerp(0.36, 0.56, draw),
      lerp(-0.06, -0.22, draw),
    );

    this.poseArm(this.bowArm, bowShoulder, bowElbow, bowHand);
    this.poseArm(this.drawArm, drawShoulder, drawElbow, drawHand);

    // Bow mount follows the bow hand and the aim/cant.
    this.bowMount.position.copy(bowHand);
    this.bowMount.rotation.set(this.aimPitch * 0.4, 0, this.cant);

    // Head keeps looking at the target, with a tiny draw-induced tilt.
    this.head.rotation.y = this.stance.headYaw + this.aimYaw * 0.35;
    this.head.rotation.x = -this.aimPitch * 0.3;
    this.head.rotation.z = -this.cant * 0.5;

    this.root.updateMatrixWorld(true);
  }

  private poseArm(arm: ArmRig, shoulder: THREE.Vector3, elbow: THREE.Vector3, hand: THREE.Vector3): void {
    this.placeSegment(arm.upper, shoulder, elbow);
    this.placeSegment(arm.fore, elbow, hand);
    arm.joint.position.copy(elbow);
    arm.hand.position.copy(hand);
    arm.hand.quaternion.identity();
    arm.wrist.position.copy(elbow).lerp(hand, 0.88);
    arm.wrist.quaternion.copy(arm.fore.quaternion);
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => {
      const mat = m as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      m.dispose();
    });
  }
}
