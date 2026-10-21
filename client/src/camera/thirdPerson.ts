/**
 * Third-person "stance" camera.
 *
 * An over-the-shoulder spring arm behind and slightly to the archer's right
 * (mirrored for left-handed archers). The player can look around with the
 * mouse; the camera keeps the archer's head and the target in frame and never
 * dips below the ground.
 */

import * as THREE from 'three';
import { clamp } from '@shared/math/random';

export interface ThirdPersonContext {
  /** Archer head position in world space. */
  head: THREE.Vector3;
  /** Target gold centre in world space. */
  target: THREE.Vector3;
  /** Mouse orbit yaw, radians (0 = looking downrange). */
  orbitYaw: number;
  /** Mouse orbit pitch, radians (positive = up). */
  orbitPitch: number;
  /** Arm length in metres. */
  armLength: number;
  /** +1 right-handed, -1 left-handed. */
  mirror: number;
  fov: number;
  /** Camera kick after the shot. */
  recoil: number;
}

export class ThirdPersonCamera {
  readonly position = new THREE.Vector3(0, 1.8, -2.6);
  readonly target = new THREE.Vector3(0, 1.4, 8);
  private initialized = false;

  update(ctx: ThirdPersonContext, dt: number): { position: THREE.Vector3; target: THREE.Vector3; fov: number } {
    const yaw = ctx.orbitYaw;
    const pitch = clamp(ctx.orbitPitch, -0.55, 0.5);
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const desired = new THREE.Vector3()
      .copy(ctx.head)
      .addScaledVector(forward, -ctx.armLength * (1 - pitch * 0.25))
      .addScaledVector(right, -0.58 * ctx.mirror)
      .add(new THREE.Vector3(0, 0.28 + pitch * 1.2, 0));

    // Keep the camera above the grass.
    desired.y = Math.max(0.45, desired.y);

    const lookAt = new THREE.Vector3()
      .copy(ctx.head)
      .addScaledVector(forward, 9)
      .add(new THREE.Vector3(0, 1.1 + pitch * 5, 0));

    if (!this.initialized) {
      this.position.copy(desired);
      this.target.copy(lookAt);
      this.initialized = true;
    } else {
      // Spring-arm smoothing: position follows a little slower than the look
      // target, which is what gives the camera its weight.
      damp(this.position, desired, 7.5, dt);
      damp(this.target, lookAt, 9.5, dt);
    }

    // Recoil pushes the camera back and up by a few centimetres.
    this.position.y += ctx.recoil * 0.03;
    this.position.addScaledVector(forward, -ctx.recoil * 0.04);

    return { position: this.position, target: this.target, fov: ctx.fov };
  }

  snap(): void {
    this.initialized = false;
  }
}

function damp(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  const t = 1 - Math.exp(-lambda * dt);
  current.lerp(target, t);
}
