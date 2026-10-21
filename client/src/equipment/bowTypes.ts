/**
 * Shared types and helpers for the bow visuals.
 *
 * Every bow is built in the same local frame:
 *   +y = up the bow, +z = towards the target, origin = the grip pivot.
 * The string sits behind the grip at -z; the arrow rest is just above the
 * origin. This matches the physics origin used by `shared/physics/shot.ts`.
 */

import * as THREE from 'three';
import type { GearSetup } from '@shared/types';

export interface BowVisual {
  readonly group: THREE.Group;
  /** Bend the limbs, move the string, spin the cams. */
  update(drawFraction: number, recoil: number, time: number): void;
  /** Local nock point of the string (where the arrow attaches). */
  readonly nockLocal: THREE.Vector3;
  /** Sight pin / scope centre, used by the first-person sight picture. */
  readonly sightPin: THREE.Object3D | null;
  /** Scope magnification for the second-camera lens (compound only). */
  readonly scopeMagnification: number;
  /** Release aid object (compound) shown at the draw hand. */
  readonly releaseAid: THREE.Object3D | null;
  dispose(): void;
}

export interface BowBuildOptions {
  gear: GearSetup;
  /** Lower detail for the AI archers on other lanes. */
  lowDetail?: boolean;
  accent?: number;
}

/** Rounded rectangle shape, used for risers and limb profiles. */
export function roundedRect(width: number, height: number, radius: number): THREE.Shape {
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  return shape;
}

export function standardMaterial(
  color: number,
  roughness: number,
  metalness: number,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

/** A thin line rebuilt every frame (the bow string). */
export class DynamicLine {
  readonly line: THREE.Line;
  private positions: Float32Array;
  private attribute: THREE.BufferAttribute;

  constructor(color: number, opacity = 1, points = 3) {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(points * 3);
    this.attribute = new THREE.BufferAttribute(this.positions, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.attribute);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      linewidth: 1,
    });
    this.line = new THREE.Line(geometry, material);
    this.line.frustumCulled = false;
  }

  set(points: THREE.Vector3[]): void {
    for (let i = 0; i < points.length && i * 3 + 2 < this.positions.length; i++) {
      this.positions[i * 3] = points[i].x;
      this.positions[i * 3 + 1] = points[i].y;
      this.positions[i * 3 + 2] = points[i].z;
    }
    this.attribute.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}

/** Brace height in metres from the gear (recurve ~0.22 m). */
export function braceHeightM(gear: GearSetup): number {
  return gear.braceHeightIn * 0.0254;
}

/** Draw stroke in metres: the distance the nock travels from brace to anchor. */
export function drawStrokeM(gear: GearSetup): number {
  return Math.max(0.2, (gear.drawLengthIn - gear.braceHeightIn - 1.75) * 0.0254);
}
