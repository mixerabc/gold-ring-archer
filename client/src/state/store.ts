/**
 * Client state.
 *
 * A single zustand store holds everything the DOM overlay needs: the current
 * screen, the player's setup, settings and the live session summary. The 3D
 * game reads the same store, so there is exactly one source of truth for
 * "which bow am I shooting" and "is the HUD visible".
 *
 * The store deliberately contains no Three.js objects: those live in the game
 * layer and are never serialised.
 */

import { createStore } from 'zustand/vanilla';
import { defaultGear, sanitizeGear } from '@shared/data/gear';
import type { BowClass, Difficulty, GearSetup, Handedness } from '@shared/types';

export type Screen =
  | 'boot'
  | 'menu'
  | 'class'
  | 'venue'
  | 'gear'
  | 'settings'
  | 'playing'
  | 'paused'
  | 'results'
  | 'bracket'
  | 'medal'
  | 'leaderboard'
  | 'online'
  | 'tutorial';

export type VenueId = 'stadium' | 'club' | 'indoor';

export type GameMode = 'practice' | 'ranking' | 'match' | 'tournament' | 'daily' | 'tutorial' | 'online';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface CameraSettings {
  /** Blend from third person into the eye position on the draw (seconds). */
  transitionSeconds: number;
  /** Return to third person automatically after the follow-through. */
  autoReturn: boolean;
  /** Follow the arrow after the release. */
  arrowCam: boolean;
  /** Third-person spring-arm length, metres. */
  armLength: number;
  /** Third-person FOV, degrees. */
  fov: number;
  /** Mouse sensitivity multiplier. */
  sensitivity: number;
  invertY: boolean;
  /** Aim-mode zoom range multiplier (mouse wheel). */
  zoom: number;
}

export interface Settings {
  difficulty: Difficulty;
  quality: QualityPreset;
  /** How much the sight is stabilised and slowed near the gold. */
  aimAssist: 'off' | 'light' | 'strong';
  camera: CameraSettings;
  handedness: Handedness;
  reducedMotion: boolean;
  colourBlindSafe: boolean;
  subtitles: boolean;
  judgeVoice: boolean;
  masterVolume: number;
  muted: boolean;
  showHud: boolean;
  showFps: boolean;
  /** Practice-only gap-aim guide for barebow (never in competition). */
  trainingOverlay: boolean;
  /** Colour-blind-safe target palette. */
  targetPalette: 'standard' | 'cbSafe';
}

export interface SessionSummary {
  mode: GameMode;
  bowClass: BowClass;
  venue: VenueId;
  distanceM: number;
  endsShot: number;
  arrowsShot: number;
  total: number;
  xCount: number;
  tenCount: number;
  /** 0..100, only meaningful in match play. */
  pressure: number;
  opponentName: string;
  opponentScore: number;
  opponentSets: number;
  mySets: number;
  setPoints: number[];
  opponentSetPoints: number[];
  status: 'idle' | 'shooting' | 'endBreak' | 'finished';
  message: string;
}

export interface GameStore {
  screen: Screen;
  previousScreen: Screen;
  bowClass: BowClass;
  venue: VenueId;
  mode: GameMode;
  gearByClass: Record<BowClass, GearSetup>;
  gear: GearSetup;
  settings: Settings;
  session: SessionSummary;
  /** Last end's arrow labels, newest last. */
  endArrows: string[];
  /** True while the pointer is locked / aim mode is available. */
  pointerLocked: boolean;
  setScreen: (screen: Screen) => void;
  setBowClass: (bowClass: BowClass) => void;
  setVenue: (venue: VenueId) => void;
  setMode: (mode: GameMode) => void;
  setGear: (gear: GearSetup) => void;
  patchGear: (patch: Partial<GearSetup>) => void;
  patchSettings: (patch: Partial<Settings>) => void;
  patchCamera: (patch: Partial<CameraSettings>) => void;
  patchSession: (patch: Partial<SessionSummary>) => void;
  setEndArrows: (arrows: string[]) => void;
  setPointerLocked: (locked: boolean) => void;
  resetSession: (patch?: Partial<SessionSummary>) => void;
}

const SETTINGS_KEY = 'gold-ring:settings:v3';
const GEAR_KEY = 'gold-ring:gear:v2';

export const defaultCameraSettings: CameraSettings = {
  transitionSeconds: 0.4,
  autoReturn: true,
  arrowCam: true,
  armLength: 2.6,
  fov: 62,
  sensitivity: 1,
  invertY: false,
  zoom: 3.5,
};

export const defaultSettings: Settings = {
  difficulty: 'standard',
  quality: 'high',
  aimAssist: 'light',
  camera: { ...defaultCameraSettings },
  handedness: 'right',
  reducedMotion: false,
  colourBlindSafe: false,
  subtitles: true,
  judgeVoice: true,
  masterVolume: 0.7,
  muted: false,
  showHud: true,
  showFps: false,
  trainingOverlay: false,
  targetPalette: 'standard',
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...defaultSettings,
      ...parsed,
      camera: { ...defaultCameraSettings, ...(parsed.camera ?? {}) },
    };
  } catch {
    return { ...defaultSettings };
  }
}

function loadGear(): Record<BowClass, GearSetup> {
  const fallback: Record<BowClass, GearSetup> = {
    recurve: defaultGear('recurve'),
    compound: defaultGear('compound'),
    barebow: defaultGear('barebow'),
  };
  try {
    const raw = localStorage.getItem(GEAR_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Record<BowClass, GearSetup>>;
    return {
      recurve: sanitizeGear({ ...fallback.recurve, ...(parsed.recurve ?? {}) }),
      compound: sanitizeGear({ ...fallback.compound, ...(parsed.compound ?? {}) }),
      barebow: sanitizeGear({ ...fallback.barebow, ...(parsed.barebow ?? {}) }),
    };
  } catch {
    return fallback;
  }
}

function persist(settings: Settings, gearByClass: Record<BowClass, GearSetup>): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem(GEAR_KEY, JSON.stringify(gearByClass));
  } catch {
    // Private browsing / quota: settings simply do not persist.
  }
}

const initialGear = loadGear();

const store = createStore<GameStore>()((set, get) => ({
  screen: 'boot',
  previousScreen: 'menu',
  bowClass: 'recurve',
  venue: 'stadium',
  mode: 'practice',
  gearByClass: initialGear,
  gear: initialGear.recurve,
  settings: loadSettings(),
  session: {
    mode: 'practice',
    bowClass: 'recurve',
    venue: 'stadium',
    distanceM: 70,
    endsShot: 0,
    arrowsShot: 0,
    total: 0,
    xCount: 0,
    tenCount: 0,
    pressure: 0,
    opponentName: 'AI',
    opponentScore: 0,
    opponentSets: 0,
    mySets: 0,
    setPoints: [],
    opponentSetPoints: [],
    status: 'idle',
    message: '',
  },
  endArrows: [],
  pointerLocked: false,

  setScreen: (screen) =>
    set((state) => ({
      previousScreen: state.screen === 'boot' ? 'menu' : state.screen,
      screen,
    })),

  setBowClass: (bowClass) =>
    set((state) => {
      const gear = state.gearByClass[bowClass];
      return {
        bowClass,
        gear,
        settings: { ...state.settings, handedness: gear.handedness },
      };
    }),

  setVenue: (venue) => set({ venue }),

  setMode: (mode) => set({ mode }),

  setGear: (gear) =>
    set((state) => {
      const clean = sanitizeGear(gear);
      const gearByClass = { ...state.gearByClass, [clean.class]: clean };
      persist(state.settings, gearByClass);
      return { gear: clean, gearByClass };
    }),

  patchGear: (patch) => {
    const state = get();
    const next = sanitizeGear({ ...state.gear, ...patch });
    const gearByClass = { ...state.gearByClass, [next.class]: next };
    persist(state.settings, gearByClass);
    set({ gear: next, gearByClass });
  },

  patchSettings: (patch) => {
    const state = get();
    const settings = { ...state.settings, ...patch };
    persist(settings, state.gearByClass);
    set({ settings });
  },

  patchCamera: (patch) => {
    const state = get();
    const settings = { ...state.settings, camera: { ...state.settings.camera, ...patch } };
    persist(settings, state.gearByClass);
    set({ settings });
  },

  patchSession: (patch) => set((state) => ({ session: { ...state.session, ...patch } })),

  setEndArrows: (endArrows) => set({ endArrows }),

  setPointerLocked: (pointerLocked) => set({ pointerLocked }),

  resetSession: (patch) =>
    set((state) => ({
      endArrows: [],
      session: {
        mode: state.mode,
        bowClass: state.bowClass,
        venue: state.venue,
        distanceM: 70,
        endsShot: 0,
        arrowsShot: 0,
        total: 0,
        xCount: 0,
        tenCount: 0,
        pressure: 0,
        opponentName: 'AI',
        opponentScore: 0,
        opponentSets: 0,
        mySets: 0,
        setPoints: [],
        opponentSetPoints: [],
        status: 'idle',
        message: '',
        ...patch,
      },
    })),
}));

/**
 * The UI and the game loop are imperative, not React, so the vanilla store is
 * the right fit: `getState()` in the render loop and `subscribe()` for the few
 * places that need a notification. Wrapping it keeps the call sites unchanged
 * if the UI ever moves to React.
 */
export const useGameStore = {
  getState: store.getState,
  setState: store.setState,
  subscribe: store.subscribe,
};

/** Non-reactive read, for the render loop. */
export const gameState = () => store.getState();
