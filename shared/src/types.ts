/**
 * GOLD RING — shared domain types.
 *
 * Everything in `shared/` is deliberately free of browser and Node APIs so the
 * exact same rules engine and physics run in the client, on the server (for
 * authoritative validation) and inside the unit tests.
 *
 * Coordinate conventions (used by physics, camera, targets and scoring):
 *   x : lateral, positive to the archer's right when looking downrange
 *   y : up
 *   z : downrange, positive towards the targets (archer stands at z = 0)
 * Impact points are reported on the target face plane in metres relative to the
 * gold centre, with x lateral and y vertical (both positive away from centre).
 */

export type BowClass = 'recurve' | 'compound' | 'barebow';
export type Handedness = 'right' | 'left';
export type Difficulty = 'arcade' | 'standard' | 'realistic';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Rules configuration (mirrors shared/src/rules/worldArchery.json)    */
/* ------------------------------------------------------------------ */

export interface RingColor {
  rings: number[];
  name: string;
  hex: string;
}

export interface FaceConfig {
  id: string;
  label: string;
  diameterCm: number;
  rings: number;
  ringWidthCm: number;
  /** Lowest ring printed on the face; arrows outside it are misses on that face. */
  minScoringRing: number;
  xRingDiameterCm: number;
  colors: RingColor[];
  tripleSpot?: boolean;
}

export interface EquipmentLimits {
  sight: boolean;
  stabiliser: boolean;
  clicker: boolean;
  releaseAid: boolean;
  peep: boolean;
  scopeMagnification: number;
  barebowGapAim: boolean;
}

export interface BowSpec {
  drawWeightLb: { min: number; max: number; default: number };
  bowLengthIn: { min: number; max: number; default: number };
  drawLengthIn: { min: number; max: number; default: number };
  braceHeightIn: { min: number; max: number; default: number };
  efficiency: number;
  letOff: number;
  peakDrawIn?: number;
  stabiliser?: { longRodIn: number; sideRodIn: number };
}

export interface ClassRules {
  id: BowClass;
  name: string;
  shortName: string;
  distanceM: number;
  face: string;
  arrowsPerEnd: number;
  ends: number;
  totalArrows: number;
  bow: BowSpec;
  arrowSpeedMps: { min: number; max: number };
  limits: EquipmentLimits;
  matchStyle: 'setSystem' | 'cumulative';
  description: string;
}

export interface FaceTiltRules {
  /** Target face inclination from vertical, in degrees (top of the face leans back). */
  degrees: number;
  /** Height of the gold centre above the ground, metres. */
  centreHeightM: number;
}

export interface FieldOfPlayRules {
  laneWidthM: number;
  minLaneWidthM: number;
  waitingLineM: number;
  shootingLineWidthM: number;
  targetCentreHeightM: number;
  faceTiltDeg: number;
  distanceMarkerOffsetM: number;
  mediaZoneDepthM: number;
  officialsZoneDepthM: number;
  windFlagPositionsM: number[];
}

export interface TimingRules {
  rankingEndSeconds: number;
  rankingWarningSeconds: number;
  matchArrowSeconds: number;
  matchWarningSeconds: number;
  matchEndSeconds: number;
  teamEndSeconds: number;
  mixedTeamEndSeconds: number;
  shootOffArrowSeconds: number;
  practiceEndSeconds: number;
}

export interface SignalRules {
  phases: {
    id: 'prepare' | 'shoot' | 'warning' | 'expired';
    light: 'red' | 'green' | 'yellow';
    label: string;
  }[];
  buzzer: { start: string; warning: string; end: string };
}

export interface PenaltyRules {
  earlyRelease: string;
  lateRelease: string;
  cancelHighestArrowOfEnd: boolean;
  description: string;
}

export interface ScoringRules {
  lineCutter: 'outerEdgeOfShaft' | 'shaftCentre';
  xCountsAsTen: boolean;
  xRingTieBreak: boolean;
  tieBreakers: string[];
  robinHood: string;
  passThrough: string;
  bounceBack: string;
  judgeReviewRadiusMm: number;
  defaultShaftDiameterMm: number;
}

export interface FormatRules {
  id: string;
  name: string;
  description: string;
  scoringStyle: 'cumulative' | 'setSystem';
  ends: number;
  arrowsPerEnd: number;
  setPointsToWin?: number;
  setPointsDraw?: number;
  tieBreak?: string;
  maxArrows?: number;
}

export interface TeamFormatRules {
  id: string;
  name: string;
  archersPerTeam: number;
  ends: number;
  arrowsPerEnd: number;
  endSeconds: number;
  alternateShooting: boolean;
  description: string;
}

export interface RulesConfig {
  meta: {
    schemaVersion: number;
    game: string;
    rulebook: {
      title: string;
      books: string[];
      edition: string;
      verified: boolean;
      verifiedBy: string | null;
      verifiedOn: string | null;
      citation: string;
    };
    warning: string;
  };
  units: Record<string, string>;
  fieldOfPlay: FieldOfPlayRules;
  faces: Record<string, FaceConfig>;
  classes: Record<BowClass, ClassRules>;
  formats: Record<string, FormatRules>;
  teamFormats: Record<string, TeamFormatRules>;
  timing: TimingRules;
  signals: SignalRules;
  penalties: PenaltyRules;
  scoring: ScoringRules;
  procedures: Record<string, string | number | boolean>;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export interface ArrowImpact {
  /** Lateral offset from the gold centre, metres. */
  x: number;
  /** Vertical offset from the gold centre, metres. */
  y: number;
  /** Speed at impact, m/s. */
  speed?: number;
  /** Impact angle below horizontal, radians. */
  angle?: number;
}

export interface ArrowScore {
  /** 0 = miss (M). */
  value: number;
  isX: boolean;
  /** True when the shaft's outer edge touched the next inner ring's line. */
  lineCut: boolean;
  /** Distance from the gold centre, metres. */
  radius: number;
  /** Display label: "10", "9", "X", "M". */
  label: string;
}

export interface ScoredArrow extends ArrowScore {
  index: number;
  impact: ArrowImpact;
  /** Which spot of a triple face the arrow hit (0..2), if applicable. */
  spot?: number;
}

export interface EndResult {
  index: number;
  arrows: ScoredArrow[];
  total: number;
  xCount: number;
}

export interface ArcherMatchScore {
  archerId: string;
  name: string;
  total: number;
  xCount: number;
  tenCount: number;
  setPoints: number;
  ends: EndResult[];
}

/* ------------------------------------------------------------------ */
/* Equipment                                                           */
/* ------------------------------------------------------------------ */

export interface ArrowSpecData {
  id: string;
  brand: string;
  name: string;
  /** Shaft spine in deflection units (higher = softer). */
  spine: number;
  lengthIn: number;
  /** Grains. */
  weightGr: number;
  pointWeightGr: number;
  diameterMm: number;
  fletching: 'vane' | 'feather';
  fletchingLengthIn: number;
  colors: { shaft: string; fletching: string; nock: string };
  recommendedDrawWeightLb: { min: number; max: number };
}

export interface RiserData {
  id: string;
  brand: string;
  name: string;
  lengthIn: number;
  massGr: number;
  material: string;
  color: string;
  accent: string;
  geometry: { limbPocket: number; gripDepth: number; windowDepth: number };
}

export interface LimbData {
  id: string;
  brand: string;
  name: string;
  length: 'short' | 'medium' | 'long';
  drawWeightsLb: number[];
  material: string;
  color: string;
}

export interface SightData {
  id: string;
  brand: string;
  name: string;
  type: 'pin' | 'scope';
  extensionIn: number;
  apertureMm: number;
  magnification: number;
  clicksPerRevolution: number;
  elevationRangeMm: number;
  windageRangeMm: number;
}

export interface StabiliserData {
  id: string;
  brand: string;
  name: string;
  longRodIn: number;
  sideRodIn: number;
  weightsOz: number;
}

export interface ReleaseAidData {
  id: string;
  brand: string;
  name: string;
  type: 'thumb' | 'backTension' | 'wrist';
  sensitivity: number;
}

export interface RestData {
  id: string;
  brand: string;
  name: string;
  type: 'magnetic' | 'dropAway';
}

export interface EquipmentCatalog {
  meta: {
    note: string;
    brands: Record<string, { fictional: boolean; description: string }>;
  };
  risers: RiserData[];
  limbs: LimbData[];
  sights: SightData[];
  stabilisers: StabiliserData[];
  releases: ReleaseAidData[];
  rests: RestData[];
  arrows: ArrowSpecData[];
  strings: { id: string; brand: string; name: string; strands: number; material: string }[];
  tabs: { id: string; brand: string; name: string; type: string }[];
}

export interface GearSetup {
  class: BowClass;
  riserId: string;
  limbId: string;
  drawWeightLb: number;
  drawLengthIn: number;
  braceHeightIn: number;
  tillerMm: number;
  clickerPositionMm: number;
  plungerTension: number;
  arrowId: string;
  arrowLengthIn: number;
  pointWeightGr: number;
  sightId?: string;
  sightExtensionIn?: number;
  sightElevationMm: number;
  sightWindageMm: number;
  stabiliserId?: string;
  releaseId?: string;
  restId: string;
  stringId: string;
  tabId: string;
  nockHeightMm: number;
  /** Cosmetic. */
  handedness: Handedness;
}

/* ------------------------------------------------------------------ */
/* Physics                                                             */
/* ------------------------------------------------------------------ */

export interface WindFieldConfig {
  seed: number;
  /** Base wind speed at 10 m, m/s. */
  baseSpeed: number;
  /** Direction the wind blows TOWARDS, degrees clockwise from downrange (+z). */
  baseDirectionDeg: number;
  gustStrength: number;
  gustFrequencyHz: number;
  /** Vertical shear exponent (power law). */
  shear: number;
  turbulence: number;
}

export interface WindSample extends Vec3 {
  speed: number;
}

export interface DrawCurvePoint {
  drawIn: number;
  forceLb: number;
}

export interface BowShotParams {
  bowClass: BowClass;
  drawWeightLb: number;
  drawLengthIn: number;
  braceHeightIn: number;
  letOff: number;
  peakDrawIn: number;
  arrowMassGr: number;
  efficiency: number;
}

export interface LaunchSolution {
  /** Elevation above the horizontal, radians. */
  elevation: number;
  /** Yaw, radians (positive = right). */
  yaw: number;
  /** Flight time to the target plane, seconds. */
  time: number;
  /** Impact speed, m/s. */
  speed: number;
  /** Speed at the muzzle. */
  muzzleSpeed: number;
}

export interface FlightSample {
  t: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  /** Visual flex offset of the shaft, metres (cosmetic arrow paradox). */
  flex: number;
}

export interface FlightResult {
  impact: { x: number; y: number; z: number; speed: number; angle: number };
  samples: FlightSample[];
  timeOfFlight: number;
  maxHeight: number;
  /** Lateral drift caused by the wind, metres (vs. the same shot in still air). */
  windDrift: number;
  /** Vertical drop caused by gravity and drag, metres. */
  drop: number;
  hitGround: boolean;
}

export interface ShotRequest {
  bowClass: BowClass;
  distanceM: number;
  windSeed: number;
  /** Aim point on the target plane, metres from centre (before sway). */
  aim: Vec2;
  /** 0..1.02 — how far the bow was drawn relative to full draw. */
  drawFraction: number;
  /** Seconds between the draw reaching anchor and the release. */
  holdSeconds: number;
  /** 0..1 quality of the release (1 = perfect). */
  releaseQuality: number;
  /** Bow cant, radians (positive = top of the bow to the right). */
  cantRad: number;
  /** Grip torque, radians. */
  torqueRad: number;
  /** Sight elevation offset from the ideal setting, metres at the sight. */
  sightElevationOffsetMm: number;
  sightWindageOffsetMm: number;
  /** Windage/elevation errors from sway, metres at the target. */
  sway: Vec2;
  gear: {
    drawWeightLb: number;
    drawLengthIn: number;
    braceHeightIn: number;
    letOff: number;
    arrowMassGr: number;
    arrowSpine: number;
    arrowLengthIn: number;
    efficiency: number;
  };
  wind?: WindFieldConfig;
}

export interface ShotOutcome {
  flight: FlightResult;
  /** Impact on the target face, metres from centre (0,0 if the arrow missed). */
  faceImpact: Vec2;
  score: ArrowScore;
  muzzleSpeed: number;
  /** Human-readable reasons, useful for the judge log and server validation. */
  notes: string[];
  simulatedAt: number;
}
