/**
 * Spectator cameras.
 *
 * Three broadcast-style views that the player can cycle with V:
 *   lane    - wide side view of the shooting line and the archer
 *   target  - close-up of the target face from behind the butt
 *   broadcast - slow orbit over the field
 *
 * They are also used behind the main menu, where a slow orbit sells the venue.
 */

import * as THREE from 'three';

export type SpectatorMode = 'lane' | 'target' | 'broadcast';

export interface SpectatorContext {
  archer: THREE.Vector3;
  target: THREE.Vector3;
  distanceM: number;
  time: number;
}

export class SpectatorCamera {
  mode: SpectatorMode = 'broadcast';
  private orbit = 0;

  cycle(): SpectatorMode {
    this.mode = this.mode === 'lane' ? 'target' : this.mode === 'target' ? 'broadcast' : 'lane';
    return this.mode;
  }

  update(ctx: SpectatorContext, dt: number): { position: THREE.Vector3; target: THREE.Vector3; fov: number } {
    this.orbit += dt * 0.06;
    switch (this.mode) {
      case 'lane': {
        const position = new THREE.Vector3(-6.5, 2.2, -2.5);
        const target = new THREE.Vector3(0, 1.4, ctx.distanceM * 0.35);
        return { position, target, fov: 52 };
      }
      case 'target': {
        const position = new THREE.Vector3(2.4, 1.55, ctx.distanceM + 2.6);
        const target = new THREE.Vector3(0, 1.3, ctx.distanceM);
        return { position, target, fov: 30 };
      }
      case 'broadcast':
      default: {
        const radius = ctx.distanceM * 0.62 + 12;
        const position = new THREE.Vector3(
          Math.sin(this.orbit) * radius,
          12 + Math.sin(this.orbit * 0.7) * 3,
          ctx.distanceM * 0.45 + Math.cos(this.orbit) * radius,
        );
        const target = new THREE.Vector3(0, 1.5, ctx.distanceM * 0.45);
        return { position, target, fov: 46 };
      }
    }
  }
}
