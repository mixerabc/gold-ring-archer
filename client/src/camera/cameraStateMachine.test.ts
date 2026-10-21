/**
 * Camera state machine tests — acceptance criterion 1 ("the camera moves
 * smoothly from third person to first-person aim and back").
 */

import { describe, expect, it } from 'vitest';
import { CameraStateMachine, DEFAULT_CAMERA_OPTIONS } from './cameraStateMachine';

function machine(patch: Partial<typeof DEFAULT_CAMERA_OPTIONS> = {}): CameraStateMachine {
  return new CameraStateMachine({ ...DEFAULT_CAMERA_OPTIONS, ...patch });
}

describe('camera state machine', () => {
  it('starts in third person with no aim blend', () => {
    const m = machine();
    expect(m.state).toBe('THIRD_PERSON');
    expect(m.aimBlend).toBe(0);
  });

  it('runs the full draw -> aim -> release -> arrow cam -> third person loop', () => {
    const m = machine();
    expect(m.send('drawStart')).toBe(true);
    expect(m.state).toBe('DRAWING_TRANSITION');

    m.tick(0.2);
    expect(m.aimBlend).toBeGreaterThan(0);
    expect(m.aimBlend).toBeLessThan(1);

    expect(m.send('drawFull')).toBe(true);
    expect(m.state).toBe('FIRST_PERSON_AIM');
    expect(m.aimBlend).toBe(1);

    expect(m.send('release')).toBe(true);
    expect(m.state).toBe('RELEASE');

    m.tick(0.39);
    expect(m.state).toBe('RELEASE');
    m.tick(0.02);
    expect(m.state).toBe('ARROW_CAM');

    m.send('arrowLanded');
    expect(m.state).toBe('THIRD_PERSON');
  });

  it('eases the transition monotonically', () => {
    const m = machine({ transitionSeconds: 0.4 });
    m.send('drawStart');
    let previous = -1;
    for (let i = 0; i < 10; i++) {
      m.tick(0.04);
      const blend = m.aimBlend;
      expect(blend).toBeGreaterThanOrEqual(previous);
      previous = blend;
    }
    expect(m.aimBlend).toBeCloseTo(1, 2);
  });

  it('returns straight to third person when arrow cam is disabled', () => {
    const m = machine({ arrowCam: false });
    m.send('drawStart');
    m.send('drawFull');
    m.send('release');
    m.tick(0.41);
    expect(m.state).toBe('THIRD_PERSON');
  });

  it('keeps first person when auto-return is disabled', () => {
    const m = machine({ autoReturn: false });
    m.send('drawStart');
    m.send('drawFull');
    m.send('release');
    m.tick(0.5);
    expect(m.state).toBe('FIRST_PERSON_AIM');
    expect(m.aimBlend).toBe(1);
  });

  it('cancels a draw back to third person', () => {
    const m = machine();
    m.send('drawStart');
    m.send('cancelDraw');
    expect(m.state).toBe('THIRD_PERSON');
  });

  it('ignores events that do not apply', () => {
    const m = machine();
    expect(m.send('release')).toBe(false);
    expect(m.send('drawFull')).toBe(false);
    expect(m.state).toBe('THIRD_PERSON');
  });

  it('supports spectator mode and back', () => {
    const m = machine();
    m.send('toSpectator');
    expect(m.state).toBe('SPECTATOR');
    m.send('drawStart');
    expect(m.state).toBe('SPECTATOR');
    m.send('toThirdPerson');
    expect(m.state).toBe('THIRD_PERSON');
  });

  it('records a transition history for debugging', () => {
    const m = machine();
    m.send('drawStart');
    m.send('drawFull');
    m.send('release');
    m.tick(0.5);
    expect(m.history.map((h) => h.to)).toEqual([
      'DRAWING_TRANSITION',
      'FIRST_PERSON_AIM',
      'RELEASE',
      'ARROW_CAM',
    ]);
  });

  it('resets cleanly', () => {
    const m = machine();
    m.send('drawStart');
    m.reset();
    expect(m.state).toBe('THIRD_PERSON');
    expect(m.total).toBe(0);
    expect(m.history).toHaveLength(0);
  });
});
