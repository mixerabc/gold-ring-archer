/**
 * Input layer.
 *
 * Mouse, keyboard, gamepad and touch are normalised into one small state
 * object that the game loop reads once per frame. Nothing here touches the
 * scene: it only reports "the draw button is held", "the pointer moved this
 * much" and "fire was pressed this frame".
 *
 * Bindings follow section 7 of the design brief and are remappable through the
 * settings screen (the map lives in `defaultBindings`).
 */

export type Action =
  | 'draw'
  | 'fire'
  | 'holdBreath'
  | 'leanLeft'
  | 'leanRight'
  | 'nextSight'
  | 'prevSight'
  | 'cameraToggle'
  | 'spectator'
  | 'pause'
  | 'hud'
  | 'reload'
  | 'tutorialHint';

export const defaultBindings: Record<Action, string[]> = {
  draw: ['MouseRight'],
  fire: ['KeyF', 'Space'],
  holdBreath: ['ShiftLeft'],
  leanLeft: ['KeyQ'],
  leanRight: ['KeyE'],
  nextSight: ['KeyR'],
  prevSight: ['KeyT'],
  cameraToggle: ['KeyC'],
  spectator: ['KeyV'],
  pause: ['Escape', 'KeyP'],
  hud: ['KeyH'],
  reload: ['KeyN'],
  tutorialHint: ['F1'],
};

export interface PointerDelta {
  dx: number;
  dy: number;
  /** Wheel notches this frame (positive = zoom in). */
  wheel: number;
}

export class Input {
  readonly keys = new Set<string>();
  readonly pressed = new Set<string>();
  readonly released = new Set<string>();

  pointer: PointerDelta = { dx: 0, dy: 0, wheel: 0 };
  leftDown = false;
  rightDown = false;
  /** Touch drag state (mobile). */
  touchDrawing = false;
  touchMoved = 0;

  pointerLocked = false;
  private canvas: HTMLElement;
  private disposers: Array<() => void> = [];
  private bindings: Record<Action, string[]> = { ...defaultBindings };
  private gamepadIndex: number | null = null;
  private prevButtons: boolean[] = [];
  private gamepadAxes = { x: 0, y: 0 };

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    this.attach();
  }

  setBindings(bindings: Partial<Record<Action, string[]>>): void {
    this.bindings = { ...this.bindings, ...bindings };
  }

  private attach(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      // Do not steal keys from form controls on the menu screens.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    };
    const onBlur = () => {
      this.keys.clear();
      this.rightDown = false;
      this.leftDown = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.touchDrawing = true;
        this.touchMoved = 0;
      } else if (e.button === 0) {
        this.leftDown = true;
      } else if (e.button === 2) {
        this.rightDown = true;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.touchDrawing = false;
      } else if (e.button === 0) {
        this.leftDown = false;
      } else if (e.button === 2) {
        this.rightDown = false;
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        this.touchMoved += Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0);
      }
      this.pointer.dx += e.movementX ?? 0;
      this.pointer.dy += e.movementY ?? 0;
    };
    const onWheel = (e: WheelEvent) => {
      this.pointer.wheel += e.deltaY > 0 ? -1 : 1;
      e.preventDefault();
    };
    const onContext = (e: Event) => e.preventDefault();
    const onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', onContext);
    document.addEventListener('pointerlockchange', onLockChange);

    this.disposers.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => this.canvas.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('pointermove', onPointerMove),
      () => this.canvas.removeEventListener('wheel', onWheel),
      () => this.canvas.removeEventListener('contextmenu', onContext),
      () => document.removeEventListener('pointerlockchange', onLockChange),
    );
  }

  requestPointerLock(): void {
    if (!this.pointerLocked && this.canvas.requestPointerLock) {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === 'function') result.catch(() => undefined);
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(action: Action): boolean {
    return this.bindings[action].some((code) => this.keys.has(code));
  }

  /** True on the frame the action's first binding was pressed. */
  wasPressed(action: Action): boolean {
    return this.bindings[action].some((code) => this.pressed.has(code));
  }

  /** True on the frame the action's first binding was released. */
  wasReleased(action: Action): boolean {
    return this.bindings[action].some((code) => this.released.has(code));
  }

  /** True while the draw control is held (mouse, key, gamepad trigger or touch). */
  get drawing(): boolean {
    return this.rightDown || this.isDown('draw') || this.touchDrawing || this.gamepadDraw;
  }

  get firePressed(): boolean {
    return this.wasPressed('fire') || this.gamepadFirePressed;
  }

  private gamepadFirePressed = false;
  private gamepadDraw = false;

  /** Poll the first connected gamepad. Triggers map to draw/fire. */
  pollGamepad(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && pads.length ? pads[0] : null;
    if (!pad) {
      this.gamepadIndex = null;
      this.gamepadAxes = { x: 0, y: 0 };
      this.gamepadFirePressed = false;
      this.gamepadDraw = false;
      return;
    }
    this.gamepadIndex = pad.index;
    const buttons = pad.buttons.map((b) => b.pressed);
    // Trigger 7 = right trigger (draw), button 0 = A / cross (fire).
    this.gamepadAxes = { x: pad.axes[0] ?? 0, y: pad.axes[3] ?? pad.axes[1] ?? 0 };
    const fireNow = buttons[0] ?? false;
    this.gamepadFirePressed = fireNow && !(this.prevButtons[0] ?? false);
    this.gamepadDraw = buttons[7] ?? false;
    this.prevButtons = buttons;
  }

  /** Called at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.pointer.dx = 0;
    this.pointer.dy = 0;
    this.pointer.wheel = 0;
    this.gamepadFirePressed = false;
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    this.exitPointerLock();
  }
}
