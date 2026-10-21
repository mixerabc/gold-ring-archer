/**
 * First-person aim camera.
 *
 * The camera sits at the archer's eye, looks at the point the sight is set on,
 * and rolls slightly with the bow cant. The sight picture itself (pin, scope,
 * string blur) is geometry in front of the camera, so it parallaxes correctly
 * when the archer sways.
 */

import * as THREE from 'three';
import { clamp } from '@shared/math/random';

export interface FirstPersonContext {
  eye: THREE.Vector3;
  /** World point the sight is aimed at. */
  targetPoint: THREE.Vector3;
  /** Bow cant, radians. */
  cant: number;
  /** Base field of view before zoom. */
  fov: number;
  /** Sight/scope zoom multiplier (1 = no zoom). */
  zoom: number;
  /** Breathing phase 0..1, used for a tiny head bob. */
  breath: number;
  /** 0..1 match pressure, adds a small camera tremble. */
  pressure: number;
  /** 0..1 tremor from the draw controller. */
  tremor: number;
  time: number;
}

export class FirstPersonCamera {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  private initialized = false;

  update(ctx: FirstPersonContext, dt: number): { position: THREE.Vector3; target: THREE.Vector3; fov: number; roll: number } {
    this.position.copy(ctx.eye);
    // Head bob with the breath (a couple of millimetres).
    this.position.y += Math.sin(ctx.breath * Math.PI * 2) * 0.004;
    this.position.x += Math.sin(ctx.time * 0.7) * 0.002;

    if (!this.initialized) {
      this.smoothTarget.copy(ctx.targetPoint);
      this.initialized = true;
    } else {
      // The aim point moves with the mouse; a light smoothing removes jitter
      // without making the sight feel laggy.
      const t = 1 - Math.exp(-18 * dt);
      this.smoothTarget.lerp(ctx.targetPoint, t);
    }

    // Tremor and pressure add a small angular shake, never a big one.
    const shake = (ctx.tremor * 0.0009 + ctx.pressure * 0.0005) * (1 + Math.sin(ctx.time * 9.3));
    this.target.copy(this.smoothTarget);
    this.target.x += Math.sin(ctx.time * 13.1) * shake * 30;
    this.target.y += Math.cos(ctx.time * 11.7) * shake * 30;

    const zoom = clamp(ctx.zoom, 1, 8);
    return {
      position: this.position,
      target: this.target,
      fov: clamp(ctx.fov / zoom, 6, 80),
      roll: -ctx.cant * 0.55,
    };
  }

  snap(): void {
    this.initialized = false;
  }
}
