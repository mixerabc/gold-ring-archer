/**
 * Crowd.
 *
 * Low-poly spectators in the grandstands, drawn as one InstancedMesh. They
 * bounce and raise their arms when the home archer shoots a ten, which is
 * driven by the `cheer` value the game sets after each arrow.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '@shared/math/random';

interface Spectator {
  base: THREE.Vector3;
  phase: number;
  scale: number;
  hue: number;
}

export class Crowd {
  readonly mesh: THREE.InstancedMesh;
  private spectators: Spectator[] = [];
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshStandardMaterial;
  private cheer = 0;
  private time = 0;
  private updateAccumulator = 0;
  private dummy = new THREE.Object3D();

  constructor(count: number, options: { rows?: number; startZ?: number; seed?: number } = {}) {
    const rand = mulberry32(options.seed ?? 991);
    const body = new THREE.CapsuleGeometry(0.16, 0.48, 3, 6);
    body.translate(0, 0.62, 0);
    const head = new THREE.SphereGeometry(0.115, 6, 5);
    head.translate(0, 1.05, 0);
    const merged = mergeGeometries([body, head], false) ?? body;
    this.geometry = merged;

    this.material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02 });
    this.mesh = new THREE.InstancedMesh(merged, this.material, count);
    this.mesh.name = 'crowd';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    const rows = options.rows ?? 6;
    const startZ = options.startZ ?? 6;
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(rand() * rows);
      const along = rand() * 34;
      const jitter = (rand() - 0.5) * 0.35;
      const base = new THREE.Vector3(
        side * (11 + row * 1.1 + jitter),
        1.4 + row * 0.55,
        startZ + along,
      );
      const phase = rand() * Math.PI * 2;
      const scale = 0.7 + rand() * 0.18;
      const hue = rand();
      this.spectators.push({ base, phase, scale, hue });

      this.dummy.position.copy(base);
      this.dummy.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      // Muted, varied clothing.
      color.setHSL(0.55 + hue * 0.3, 0.35 + hue * 0.3, 0.18 + hue * 0.22);
      this.mesh.setColorAt(i, color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** 0..1 crowd excitement; decays on its own. */
  setCheer(value: number): void {
    this.cheer = Math.max(this.cheer, Math.min(1, value));
  }

  update(dt: number): void {
    this.time += dt;
    this.cheer = Math.max(0, this.cheer - dt * 0.35);
    this.updateAccumulator += dt;
    // 12 Hz is plenty for a bobbing crowd and keeps the matrix upload cheap.
    if (this.updateAccumulator < 0.08) return;
    this.updateAccumulator = 0;

    for (let i = 0; i < this.spectators.length; i++) {
      const s = this.spectators[i];
      const bounce = Math.abs(Math.sin(this.time * 5.5 + s.phase)) * 0.055 * this.cheer;
      this.dummy.position.set(s.base.x, s.base.y + bounce, s.base.z);
      this.dummy.rotation.set(0, s.base.x > 0 ? -Math.PI / 2 : Math.PI / 2, Math.sin(this.time * 3 + s.phase) * 0.04 * this.cheer);
      this.dummy.scale.setScalar(s.scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
