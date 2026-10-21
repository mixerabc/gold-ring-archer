/**
 * Camera state machine.
 *
 * The camera is the heart of the archery feel, so its transitions are a pure
 * state machine rather than a pile of booleans in the render loop. That makes
 * the behaviour testable (see cameraStateMachine.test.ts) and keeps the
 * animation layer free of rules.
 *
 *   THIRD_PERSON --drawStart--> DRAWING_TRANSITION --drawFull--> FIRST_PERSON_AIM
 *   FIRST_PERSON_AIM --release--> RELEASE --0.4 s--> ARROW_CAM / THIRD_PERSON
 *   ARROW_CAM --arrowLanded--> THIRD_PERSON
 *   any --spectator--> SPECTATOR --toThirdPerson--> THIRD_PERSON
 */

export type CameraState =
  | 'THIRD_PERSON'
  | 'DRAWING_TRANSITION'
  | 'FIRST_PERSON_AIM'
  | 'RELEASE'
  | 'ARROW_CAM'
  | 'SPECTATOR';

export type CameraEvent =
  | 'drawStart'
  | 'drawFull'
  | 'cancelDraw'
  | 'release'
  | 'arrowLanded'
  | 'toThirdPerson'
  | 'toSpectator'
  | 'toArrowCam';

export interface CameraMachineOptions {
  /** Blend time from third person to the eye, seconds. */
  transitionSeconds: number;
  /** Return to third person after the follow-through. */
  autoReturn: boolean;
  /** Follow the arrow after the follow-through. */
  arrowCam: boolean;
  /** How long the first-person follow-through is held, seconds. */
  followThroughSeconds: number;
}

export const DEFAULT_CAMERA_OPTIONS: CameraMachineOptions = {
  transitionSeconds: 0.4,
  autoReturn: true,
  arrowCam: true,
  followThroughSeconds: 0.4,
};

export interface CameraTransition {
  from: CameraState;
  to: CameraState;
  event: CameraEvent | 'timeout';
  atSeconds: number;
}

export class CameraStateMachine {
  state: CameraState = 'THIRD_PERSON';
  /** Seconds spent in the current state. */
  elapsed = 0;
  /** Total seconds since the machine was created (for logs/tests). */
  total = 0;
  options: CameraMachineOptions;
  readonly history: CameraTransition[] = [];

  constructor(options: Partial<CameraMachineOptions> = {}) {
    this.options = { ...DEFAULT_CAMERA_OPTIONS, ...options };
  }

  get isFirstPerson(): boolean {
    return this.state === 'FIRST_PERSON_AIM' || this.state === 'RELEASE';
  }

  get isAiming(): boolean {
    return this.state === 'FIRST_PERSON_AIM' || this.state === 'RELEASE' || this.state === 'DRAWING_TRANSITION';
  }

  /**
   * Blend factor between the third-person rig (0) and the eye position (1).
   * The drawing transition is eased so the move never snaps.
   */
  get aimBlend(): number {
    switch (this.state) {
      case 'FIRST_PERSON_AIM':
      case 'RELEASE':
        return 1;
      case 'DRAWING_TRANSITION': {
        const t = Math.min(1, this.elapsed / Math.max(0.05, this.options.transitionSeconds));
        return t * t * (3 - 2 * t);
      }
      case 'ARROW_CAM':
        return 0.15;
      default:
        return 0;
    }
  }

  setOptions(patch: Partial<CameraMachineOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  /**
   * Feed an event. Returns true when the state changed.
   *
   * The event table is intentionally explicit: an event that does not apply to
   * the current state is ignored, which keeps the call sites simple.
   */
  send(event: CameraEvent): boolean {
    const next = this.resolve(this.state, event);
    if (!next) return false;
    this.transition(next, event);
    return true;
  }

  private resolve(state: CameraState, event: CameraEvent): CameraState | null {
    if (event === 'toSpectator') return state === 'SPECTATOR' ? null : 'SPECTATOR';
    if (event === 'toThirdPerson') return state === 'THIRD_PERSON' ? null : 'THIRD_PERSON';

    switch (state) {
      case 'THIRD_PERSON':
        if (event === 'drawStart') return 'DRAWING_TRANSITION';
        if (event === 'toArrowCam') return 'ARROW_CAM';
        return null;
      case 'DRAWING_TRANSITION':
        if (event === 'drawFull') return 'FIRST_PERSON_AIM';
        // A rushed release before full draw still fires: it is just a bad shot.
        if (event === 'release') return 'RELEASE';
        if (event === 'cancelDraw') return 'THIRD_PERSON';
        return null;
      case 'FIRST_PERSON_AIM':
        if (event === 'release') return 'RELEASE';
        if (event === 'cancelDraw') return 'THIRD_PERSON';
        return null;
      case 'RELEASE':
        if (event === 'toArrowCam') return 'ARROW_CAM';
        return null;
      case 'ARROW_CAM':
        if (event === 'arrowLanded') return 'THIRD_PERSON';
        if (event === 'drawStart') return 'THIRD_PERSON';
        return null;
      case 'SPECTATOR':
        return null;
    }
  }

  /**
   * Advance time and run the automatic transitions:
   *  - after the follow-through, return to third person or follow the arrow;
   *  - an arrow-cam shot returns to third person when the arrow has landed
   *    (the game sends `arrowLanded`) or after a hard 6 s timeout.
   */
  tick(dt: number): void {
    this.elapsed += dt;
    this.total += dt;

    if (this.state === 'RELEASE' && this.elapsed >= this.options.followThroughSeconds) {
      if (this.options.autoReturn) {
        this.transition(this.options.arrowCam ? 'ARROW_CAM' : 'THIRD_PERSON', 'timeout');
      } else {
        // Stay in first person, but treat the follow-through as over so the
        // player can lower the bow manually.
        this.transition('FIRST_PERSON_AIM', 'timeout');
      }
    } else if (this.state === 'ARROW_CAM' && this.elapsed >= 6) {
      this.transition('THIRD_PERSON', 'timeout');
    }
  }

  private transition(to: CameraState, event: CameraEvent | 'timeout'): void {
    const from = this.state;
    if (from === to) return;
    this.history.push({ from, to, event, atSeconds: this.total });
    this.state = to;
    this.elapsed = 0;
  }

  reset(): void {
    this.state = 'THIRD_PERSON';
    this.elapsed = 0;
    this.total = 0;
    this.history.length = 0;
  }
}
