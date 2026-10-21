/**
 * Arrow visuals: the nocked arrow, arrows in flight, arrows stuck in the target
 * and the trail behind a shot.
 *
 * One arrow mesh is reused through an object pool; a tournament can put a lot
 * of arrows in the air and on the butt, and allocating geometry per shot is the
 * fastest way to stutter.
 */

import * as THREE from 'three';
import type { ArrowSpecData } from '@shared/types';

export interface ArrowVisualOptions {
  shaftColor?: string;
  fletchingColor?: string;
  nockColor?: string;
  lengthIn?: number;
  diameterMm?: number;
  fletching?: 'vane' | 'feather';
}

export function arrowFromSpec(spec: ArrowSpecData): ArrowVisualOptions {
  return {
    shaftColor: spec.colors.shaft,
    fletchingColor: spec.colors.fletching,
    nockColor: spec.colors.nock,
    lengthIn: spec.lengthIn,
    diameterMm: spec.diameterMm,
    fletching: spec.fletching,
  };
}

export class ArrowVisual {
  readonly group = new THREE.Group();
  private shaft: THREE.Mesh;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor(options: ArrowVisualOptions = {}) {
    const lengthM = (options.lengthIn ?? 29) * 0.0254;
    const radius = ((options.diameterMm ?? 5.5) / 2) / 1000;

    const shaftMat = new THREE.MeshStandardMaterial({
      color: options.shaftColor ?? '#1b1f24',
      roughness: 0.35,
      metalness: 0.55,
    });
    const fletchMat = new THREE.MeshStandardMaterial({
      color: options.fletchingColor ?? '#f5c518',
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const nockMat = new THREE.MeshStandardMaterial({
      color: options.nockColor ?? '#e8eef5',
      roughness: 0.6,
      metalness: 0.05,
    });
    const pointMat = new THREE.MeshStandardMaterial({ color: '#c9d2da', roughness: 0.25, metalness: 0.95 });
    this.materials.push(shaftMat, fletchMat, nockMat, pointMat);

    // Shaft along +z.
    const shaftGeo = new THREE.CylinderGeometry(radius, radius, lengthM, 6);
    this.geometries.push(shaftGeo);
    this.shaft = new THREE.Mesh(shaftGeo, shaftMat);
    this.shaft.rotation.x = Math.PI / 2;
    this.shaft.position.z = lengthM / 2;
    this.group.add(this.shaft);

    // Point.
    const pointGeo = new THREE.ConeGeometry(radius * 1.6, 0.028, 8);
    this.geometries.push(pointGeo);
    const point = new THREE.Mesh(pointGeo, pointMat);
    point.rotation.x = Math.PI / 2;
    point.position.z = lengthM + 0.012;
    this.group.add(point);

    // Nock.
    const nockGeo = new THREE.CylinderGeometry(radius * 1.25, radius * 1.1, 0.018, 6);
    this.geometries.push(nockGeo);
    const nock = new THREE.Mesh(nockGeo, nockMat);
    nock.rotation.x = Math.PI / 2;
    nock.position.z = -0.008;
    this.group.add(nock);

    // Three fletchings, 120 degrees apart.
    const fletchGeo = new THREE.PlaneGeometry(0.055, 0.018);
    this.geometries.push(fletchGeo);
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3;
      const vaneGroup = new THREE.Group();
      vaneGroup.rotation.z = angle;
      const vane = new THREE.Mesh(fletchGeo, fletchMat);
      // The plane stands radially out of the shaft, along the last 5 cm.
      vane.rotation.y = Math.PI / 2;
      vane.position.set(radius * 1.7, 0, lengthM - 0.055);
      vaneGroup.add(vane);
      this.group.add(vaneGroup);
    }

    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  /** Cosmetic arrow paradox: a tiny lateral bend of the shaft. */
  setFlex(amount: number): void {
    this.shaft.rotation.z = amount;
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}

/** A trail line for a shot in flight. */
export class ArrowTrail {
  readonly line: THREE.Line;
  private positions: Float32Array;
  private attribute: THREE.BufferAttribute;
  private count = 0;

  constructor(maxPoints = 160) {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(maxPoints * 3);
    this.attribute = new THREE.BufferAttribute(this.positions, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.attribute);
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.35 });
    this.line = new THREE.Line(geometry, material);
    this.line.frustumCulled = false;
  }

  reset(): void {
    this.count = 0;
    this.line.geometry.setDrawRange(0, 0);
  }

  push(point: { x: number; y: number; z: number }): void {
    if (this.count * 3 + 2 >= this.positions.length) return;
    this.positions[this.count * 3] = point.x;
    this.positions[this.count * 3 + 1] = point.y;
    this.positions[this.count * 3 + 2] = point.z;
    this.count++;
    this.attribute.needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.count);
  }

  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}

/**
 * Pool of arrows stuck in the target. Arrows are recycled between ends so the
 * scene graph does not grow without bound.
 */
export class ImpactArrowPool {
  private pool: ArrowVisual[] = [];
  private active: ArrowVisual[] = [];
  readonly parent: THREE.Object3D;

  constructor(parent: THREE.Object3D, options: ArrowVisualOptions = {}, size = 24) {
    this.parent = parent;
    for (let i = 0; i < size; i++) {
      const arrow = new ArrowVisual(options);
      arrow.group.visible = false;
      parent.add(arrow.group);
      this.pool.push(arrow);
    }
  }

  /**
   * Place an arrow in the target.
   *
   * @param position world impact point
   * @param normal target face normal (arrow points into the butt)
   */
  place(position: THREE.Vector3, normal: THREE.Vector3, depth = 0.06): ArrowVisual {
    const arrow = this.pool.pop() ?? new ArrowVisual();
    if (!this.pool.includes(arrow) && !arrow.group.parent) this.parent.add(arrow.group);
    arrow.group.visible = true;
    arrow.group.position.copy(position).addScaledVector(normal, -depth);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    arrow.group.quaternion.copy(quaternion);
    // A tiny random roll so the fletchings do not all line up.
    arrow.group.rotateZ(Math.random() * Math.PI);
    arrow.setFlex((Math.random() - 0.5) * 0.02);
    this.active.push(arrow);
    return arrow;
  }

  clear(): void {
    for (const arrow of this.active) {
      arrow.group.visible = false;
      this.pool.push(arrow);
    }
    this.active = [];
  }

  dispose(): void {
    [...this.pool, ...this.active].forEach((a) => a.dispose());
    this.pool = [];
    this.active = [];
  }
}
