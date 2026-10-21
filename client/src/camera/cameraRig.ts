/**
 * Camera rig.
 *
 * Owns the single PerspectiveCamera and blends between the third-person and
 * first-person rigs with the state machine's eased `aimBlend`. Arrow cam and
 * spectator views take over completely when active.
 *
 * Blending positions AND look targets (rather than just positions) is what
 * makes the move feel like an archer stepping into the bow rather than a dolly
 * shot: the eye settles on the gold at the same time as the body drops away.
 */

import * as THREE from 'three';
import type { CameraState } from './cameraStateMachine';
import { ThirdPersonCamera } from './thirdPerson';
import { FirstPersonCamera } from './firstPersonAim';
import { ArrowCam } from './arrowCam';
import { SpectatorCamera } from './spectator';
import type { Target } from '../range/target';

export interface CameraRigContext {
  state: CameraState;
  aimBlend: number;
  head: THREE.Vector3;
  eye: THREE.Vector3;
  target: Target;
  /** Aim point in metres from the gold centre. */
  aim: { x: number; y: number };
  cant: number;
  orbitYaw: number;
  orbitPitch: number;
  armLength: number;
  fov: number;
  zoom: number;
  mirror: number;
  breath: number;
  pressure: number;
  tremor: number;
  time: number;
  recoil: number;
  arrow?: { position: THREE.Vector3; velocity: THREE.Vector3; landed: boolean };
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly third = new ThirdPersonCamera();
  readonly first = new FirstPersonCamera();
  readonly arrow = new ArrowCam();
  readonly spectator = new SpectatorCamera();

  private roll = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  update(ctx: CameraRigContext, dt: number): void {
    const aimWorld = ctx.target.facePointToWorld(ctx.aim);

    if (ctx.state === 'ARROW_CAM' && ctx.arrow) {
      const pose = this.arrow.update(ctx.arrow.position, ctx.arrow.velocity, dt, ctx.arrow.landed);
      this.applyPose(pose.position, pose.target, pose.fov, 0);
      return;
    }

    if (ctx.state === 'SPECTATOR') {
      const pose = this.spectator.update(
        { archer: ctx.head, target: aimWorld, distanceM: ctx.target.distanceM, time: ctx.time },
        dt,
      );
      this.applyPose(pose.position, pose.target, pose.fov, 0);
      return;
    }

    const third = this.third.update(
      {
        head: ctx.head,
        target: aimWorld,
        orbitYaw: ctx.orbitYaw,
        orbitPitch: ctx.orbitPitch,
        armLength: ctx.armLength,
        mirror: ctx.mirror,
        fov: ctx.fov,
        recoil: ctx.recoil,
      },
      dt,
    );

    const first = this.first.update(
      {
        eye: ctx.eye,
        targetPoint: aimWorld,
        cant: ctx.cant,
        fov: Math.min(ctx.fov, 48),
        zoom: ctx.zoom,
        breath: ctx.breath,
        pressure: ctx.pressure,
        tremor: ctx.tremor,
        time: ctx.time,
      },
      dt,
    );

    const blend = ctx.aimBlend;
    const position = third.position.clone().lerp(first.position, blend);
    const target = third.target.clone().lerp(first.target, blend);
    const fov = THREE.MathUtils.lerp(third.fov, first.fov, blend);
    const roll = first.roll * blend + Math.sin(ctx.time * 43) * ctx.recoil * 0.004;

    this.applyPose(position, target, fov, roll);
  }

  private applyPose(position: THREE.Vector3, target: THREE.Vector3, fov: number, roll: number): void {
    this.camera.position.copy(position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
    if (Math.abs(roll) > 1e-5) this.camera.rotateZ(roll);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.roll = roll;
  }

  get currentRoll(): number {
    return this.roll;
  }

  snap(): void {
    this.third.snap();
    this.first.snap();
    this.arrow.snap();
  }
}
