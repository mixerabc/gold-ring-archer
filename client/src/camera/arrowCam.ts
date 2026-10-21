/**
 * Arrow-follow camera.
 *
 * A short chase behind the arrow after the release. It is deliberately close
 * and slightly above the shaft so the fletching stays in frame and the target
 * grows as the arrow flies; this is the shot everyone wants to watch.
 */

import * as THREE from 'three';

export class ArrowCam {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  private smoothed = new THREE.Vector3();
  private initialized = false;

  update(
    arrowPosition: THREE.Vector3,
    velocity: THREE.Vector3,
    dt: number,
    landed = false,
  ): { position: THREE.Vector3; target: THREE.Vector3; fov: number } {
    const direction = velocity.clone();
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
    direction.normalize();

    const desired = arrowPosition
      .clone()
      .addScaledVector(direction, -1.15)
      .add(new THREE.Vector3(0, 0.28, 0));

    if (!this.initialized) {
      this.smoothed.copy(desired);
      this.initialized = true;
    } else {
      this.smoothed.lerp(desired, 1 - Math.exp(-14 * dt));
    }

    this.position.copy(this.smoothed);
    this.target.copy(arrowPosition).addScaledVector(direction, 4);
    if (landed) this.target.copy(arrowPosition);

    return { position: this.position, target: this.target, fov: 58 };
  }

  snap(): void {
    this.initialized = false;
  }
}
