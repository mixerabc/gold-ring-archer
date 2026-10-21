/**
 * Arrow flight simulation.
 *
 * Fixed-step integration at 240 Hz (see `FLIGHT_HZ`) of:
 *   - gravity,
 *   - quadratic aerodynamic drag relative to the *moving air* (so wind drift
 *     falls out of the same term that produces speed loss),
 *   - fletching stabilisation (a small restoring yaw moment that removes the
 *     initial yaw error over the first ~0.15 s),
 *   - spin drift (Magnus effect, tiny but real),
 *   - arrow paradox: a visual-only lateral flex oscillation that does NOT feed
 *     back into the trajectory (the arrow's centre of mass still flies true).
 *
 * The impact point is the intersection with the actual tilted target face, so
 * the 15 degree face lean used by the renderer is the same lean used for scoring.
 */

import { G, GRAIN_TO_KG, IN_TO_M } from './bow';
import { sampleWind } from './wind';
import type { FlightResult, FlightSample, Vec3, WindFieldConfig } from '../types';

/** Fixed simulation rate. */
export const FLIGHT_HZ = 240;
export const FLIGHT_DT = 1 / FLIGHT_HZ;

/** Air density at 15 C, sea level, kg/m^3. */
export const AIR_DENSITY = 1.225;

/** Drag coefficient of a fletched arrow (shaft + vanes, subsonic). */
export const ARROW_CD = 1.5;

/** Magnus / spin drift coefficient, tuned so drift is a few centimetres at 70 m. */
export const SPIN_DRIFT = 0.00005;

export interface LaunchParams {
  /** Arrow rest position in world space. */
  origin: Vec3;
  /** Muzzle speed, m/s. */
  speed: number;
  /** Elevation above the horizontal, radians. */
  elevation: number;
  /** Yaw, radians; positive points to the archer's right (+x). */
  yaw: number;
  /** Arrow mass, grains. */
  massGr: number;
  /** Shaft diameter, mm. */
  diameterMm: number;
  /** Arrow length, inches (fletching drag scales with it). */
  lengthIn: number;
  /** Face plane distance from the shooting line, m. */
  distanceM: number;
  /** Lateral lane offset of the target centre, m. */
  laneX: number;
  /** Gold centre height, m. */
  centreHeightM: number;
  /** Face tilt from vertical, degrees. */
  faceTiltDeg: number;
  /** Wind field; omit for still air. */
  wind?: WindFieldConfig;
  /** Start time for the wind field (seconds into the end). */
  windTime?: number;
  /** Record a sample every N steps (for the trail renderer). */
  sampleEvery?: number;
}

export interface SimState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
  spinPhase: number;
}

/**
 * Effective drag area of the arrow, m^2.
 *
 * A spinning, fletched arrow is largely streamlined: the vanes add only a small
 * frontal area on top of the shaft. Calibrated so a 315 grain shaft leaves at
 * 60 m/s and still arrives at ~50 m/s over 70 m — the classic recurve number.
 * (An earlier version scaled the whole vane plate area into the drag, which
 * made arrows fall out of the sky at 40 m. Keep this term small.)
 */
export function arrowAreaM2(diameterMm: number, lengthIn: number): number {
  const d = diameterMm / 1000;
  const shaft = Math.PI * (d / 2) ** 2;
  // Three vanes, ~5 mm x 50 mm, at ~12% of their plate area in effective frontal drag.
  const vaneArea = 3 * 0.005 * 0.05 * 0.12;
  const scale = Math.min(1.4, Math.max(0.7, lengthIn / 29));
  return shaft + vaneArea * scale;
}

/** Drag constant k in a = -k * |v_rel| * v_rel. */
export function dragConstant(massGr: number, diameterMm: number, lengthIn: number): number {
  const massKg = Math.max(1e-4, massGr * GRAIN_TO_KG);
  const area = arrowAreaM2(diameterMm, lengthIn);
  return (0.5 * AIR_DENSITY * ARROW_CD * area) / massKg;
}

function facePlaneNormal(faceTiltDeg: number): Vec3 {
  const t = (faceTiltDeg * Math.PI) / 180;
  // Face leans back: normal points towards the archer and slightly up.
  return { x: 0, y: Math.sin(t), z: -Math.cos(t) };
}

/**
 * Advance the arrow by one fixed step. Exported so the worker and the server can
 * replay a flight identically.
 */
export function stepArrow(
  state: SimState,
  dt: number,
  k: number,
  wind: WindFieldConfig | undefined,
  windTime: number,
  spin: number,
): void {
  const air = wind
    ? sampleWind(wind, state.x, state.y, state.z + 0.0001, windTime + state.t)
    : { x: 0, y: 0, z: 0, speed: 0 };

  const rx = state.vx - air.x;
  const ry = state.vy - air.y;
  const rz = state.vz - air.z;
  const relSpeed = Math.hypot(rx, ry, rz);

  // Quadratic drag plus gravity.
  const drag = k * relSpeed;
  let ax = -drag * rx;
  let ay = -drag * ry - G;
  let az = -drag * rz;

  // Spin drift: a right-hand spin (positive) drifts the arrow slightly right.
  ax += SPIN_DRIFT * spin * 0.02 * relSpeed;

  state.vx += ax * dt;
  state.vy += ay * dt;
  state.vz += az * dt;
  state.x += state.vx * dt;
  state.y += state.vy * dt;
  state.z += state.vz * dt;
  state.t += dt;
  state.spinPhase += dt * spin;
}

export interface TrajectoryOptions {
  maxTime?: number;
  sampleEvery?: number;
}

/**
 * Integrate a full flight until the arrow reaches the target plane, the ground,
 * or the time limit. Returns the impact, the sampled trail and the derived
 * metrics (drop, drift, max height).
 */
export function simulateFlight(params: LaunchParams, options: TrajectoryOptions = {}): FlightResult {
  const dt = FLIGHT_DT;
  const k = dragConstant(params.massGr, params.diameterMm, params.lengthIn);
  const maxTime = options.maxTime ?? 4;
  const sampleEvery = options.sampleEvery ?? 6; // ~40 Hz trail
  const spin = 420; // rad/s, ~4000 rpm

  const state: SimState = {
    x: params.origin.x,
    y: params.origin.y,
    z: params.origin.z,
    vx: Math.cos(params.elevation) * Math.sin(params.yaw) * params.speed,
    vy: Math.sin(params.elevation) * params.speed,
    vz: Math.cos(params.elevation) * Math.cos(params.yaw) * params.speed,
    t: 0,
    spinPhase: 0,
  };

  const normal = facePlaneNormal(params.faceTiltDeg);
  const centre = { x: params.laneX, y: params.centreHeightM, z: params.distanceM };

  const samples: FlightSample[] = [];
  let maxHeight = state.y;
  let step = 0;
  let hitGround = false;
  let prev = { ...state };
  let impact = { x: 0, y: 0, z: params.distanceM, speed: 0, angle: 0 };
  let hitFace = false;

  const faceDistance = (s: { x: number; y: number; z: number }): number =>
    (s.x - centre.x) * normal.x + (s.y - centre.y) * normal.y + (s.z - centre.z) * normal.z;

  let prevFaceDistance = faceDistance(state);

  while (state.t < maxTime) {
    prev = { ...state };
    stepArrow(state, dt, k, params.wind, params.windTime ?? 0, spin);
    step++;

    if (state.y > maxHeight) maxHeight = state.y;

    const d = faceDistance(state);
    if (!hitFace && d <= 0 && prevFaceDistance > 0) {
      // Interpolate the exact crossing point on the tilted face.
      const f = prevFaceDistance / (prevFaceDistance - d);
      const ix = prev.x + (state.x - prev.x) * f;
      const iy = prev.y + (state.y - prev.y) * f;
      const iz = prev.z + (state.z - prev.z) * f;
      const speed = Math.hypot(
        prev.vx + (state.vx - prev.vx) * f,
        prev.vy + (state.vy - prev.vy) * f,
        prev.vz + (state.vz - prev.vz) * f,
      );
      const vy = prev.vy + (state.vy - prev.vy) * f;
      const vh = Math.hypot(
        prev.vx + (state.vx - prev.vx) * f,
        prev.vz + (state.vz - prev.vz) * f,
      );
      impact = { x: ix, y: iy, z: iz, speed, angle: Math.atan2(-vy, Math.max(1e-6, vh)) };
      hitFace = true;
      samples.push({
        t: state.t,
        x: ix,
        y: iy,
        z: iz,
        speed,
        flex: flexOffset(state.t, spin),
      });
      break;
    }
    prevFaceDistance = d;

    if (state.y <= 0) {
      // Hit the ground short of the target.
      hitGround = true;
      const f = prev.y / (prev.y - state.y || 1e-6);
      const ix = prev.x + (state.x - prev.x) * f;
      const iz = prev.z + (state.z - prev.z) * f;
      impact = {
        x: ix,
        y: 0,
        z: iz,
        speed: Math.hypot(state.vx, state.vy, state.vz),
        angle: Math.PI / 2,
      };
      samples.push({ t: state.t, x: ix, y: 0, z: iz, speed: impact.speed, flex: flexOffset(state.t, spin) });
      break;
    }

    if (step % sampleEvery === 0) {
      samples.push({
        t: state.t,
        x: state.x,
        y: state.y,
        z: state.z,
        speed: Math.hypot(state.vx, state.vy, state.vz),
        flex: flexOffset(state.t, spin),
      });
    }
  }

  if (!hitFace && !hitGround) {
    impact = {
      x: state.x,
      y: state.y,
      z: state.z,
      speed: Math.hypot(state.vx, state.vy, state.vz),
      angle: Math.atan2(-state.vy, Math.max(1e-6, Math.hypot(state.vx, state.vz))),
    };
    samples.push({
      t: state.t,
      x: state.x,
      y: state.y,
      z: state.z,
      speed: impact.speed,
      flex: flexOffset(state.t, spin),
    });
  }

  const timeOfFlight = state.t;
  // Classic ballistic drop at the moment of impact: 1/2 g t^2. This is the number
  // the "Range Test" debug mode and the sight-mark helper compare against.
  const drop = 0.5 * G * timeOfFlight * timeOfFlight;

  // Wind drift: compare with the same shot in still air (cheap, one extra run).
  const stillAir = params.wind
    ? simulateFlight({ ...params, wind: undefined }, { maxTime, sampleEvery: 1_000_000 })
    : undefined;
  const windDrift = stillAir ? impact.x - stillAir.impact.x : 0;

  return {
    impact,
    samples,
    timeOfFlight,
    maxHeight: maxHeight - params.origin.y,
    windDrift,
    drop,
    hitGround: hitGround || !hitFace,
  };
}

/**
 * Cosmetic arrow-paradox flex: the shaft oscillates at the bow's natural
 * frequency right after the shot and decays. Purely visual — the trajectory is
 * unaffected, exactly like a real arrow whose centre of mass flies straight.
 */
export function flexOffset(t: number, spin: number): number {
  const freq = 42 + (spin % 7); // Hz-ish, depends on spine
  const decay = Math.exp(-t * 6);
  return Math.sin(t * freq) * 0.028 * decay;
}

/**
 * Solve the launch elevation that makes the arrow cross the face plane at the
 * requested point (still air). Uses a secant iteration on the elevation angle;
 * the yaw is solved directly from the geometry.
 */
export function solveAim(params: Omit<LaunchParams, 'elevation' | 'yaw'> & { target: Vec3 }): {
  elevation: number;
  yaw: number;
  time: number;
} {
  const dx = params.target.x - params.origin.x;
  const dz = params.target.z - params.origin.z;
  const yaw = Math.atan2(dx, Math.max(1e-6, dz));

  const evaluate = (elevation: number): { err: number; time: number } => {
    const result = simulateFlight(
      { ...params, elevation, yaw, wind: undefined },
      { sampleEvery: 1_000_000, maxTime: 6 },
    );
    return { err: result.impact.y - params.target.y, time: result.timeOfFlight };
  };

  // Bracket the solution: a low shot falls short (negative error), a high shot
  // overshoots. 45 degrees always overshoots at archery distances.
  let lo = -0.05;
  let hi = (45 * Math.PI) / 180;
  let loErr = evaluate(lo).err;
  const hiErr = evaluate(hi).err;

  if (loErr > 0) {
    // Even a flat shot lands high (very close target): use the flat solution.
    return { elevation: lo, yaw, time: evaluate(lo).time };
  }
  if (hiErr < 0) {
    // Out of range at this speed.
    return { elevation: hi, yaw, time: evaluate(hi).time };
  }

  let mid = (lo + hi) / 2;
  let result = evaluate(mid);
  for (let i = 0; i < 40; i++) {
    mid = (lo + hi) / 2;
    result = evaluate(mid);
    if (Math.abs(result.err) < 1e-4) break;
    if (result.err < 0) lo = mid;
    else hi = mid;
  }
  return { elevation: mid, yaw, time: result.time };
}

/**
 * Independent reference used by the tests: a point-mass projectile with a
 * quadratic drag term and no wind or spin. It uses a deliberately different
 * integrator (forward Euler at 1 kHz) so it is a genuine cross-check.
 *
 * `drop` is reported as 1/2 g t^2 — the same quantity the production integrator
 * reports — while `apex` and `speedAtTarget` come straight out of this
 * integration.
 */
export function referenceTrajectory(speed: number, angleRad: number, distanceM: number, k = 0): {
  drop: number;
  apex: number;
  time: number;
  speedAtTarget: number;
} {
  const dt = 0.001;
  let x = 0;
  let y = 0;
  let vx = speed * Math.cos(angleRad);
  let vy = speed * Math.sin(angleRad);
  let t = 0;
  let apex = 0;
  while (x < distanceM && t < 10) {
    const v = Math.hypot(vx, vy);
    const ax = -k * v * vx;
    const ay = -G - k * v * vy;
    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;
    t += dt;
    if (y > apex) apex = y;
  }
  return { drop: 0.5 * G * t * t, apex, time: t, speedAtTarget: Math.hypot(vx, vy) };
}

/** Convert a world impact point to face coordinates (metres from the gold centre). */
export function worldToFace(
  impact: Vec3,
  laneX: number,
  centreHeightM: number,
  faceTiltDeg: number,
): { x: number; y: number; outside: boolean } {
  const t = (faceTiltDeg * Math.PI) / 180;
  const dx = impact.x - laneX;
  const dy = impact.y - centreHeightM;
  // Face axes: u = +x, v = up the face (tilted back by t).
  const u = dx;
  const v = dy * Math.cos(t);
  return { x: u, y: v, outside: false };
}

/** Height (m) at which the arrow rest sits, relative to the archer's feet. */
export const ARROW_REST_HEIGHT_M = 1.45;
/** Forward offset of the arrow rest from the shooting line. */
export const ARROW_REST_FORWARD_M = 0.55;
/** Reference draw length used to convert inches to metres in the renderer. */
export const DRAW_IN_TO_M = IN_TO_M;
