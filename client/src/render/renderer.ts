/**
 * Renderer bootstrap.
 *
 * The game prefers WebGPU when the browser exposes it and the quality preset
 * allows it, and falls back to WebGL 2 automatically. Both paths use ACES
 * filmic tone mapping and an sRGB output; the WebGL path additionally gets the
 * post-processing chain (bloom, DOF, grade, SMAA, optional GTAO).
 *
 * WebGPU note: the post-processing chain is deliberately WebGL-only in this
 * build. Three's WebGPU node pipeline is a different render graph, and mixing
 * the two would double the bundle for no gameplay gain. The WebGPU path is
 * therefore "clean" rendering with tone mapping and MSAA.
 */

import * as THREE from 'three';
import { PostFx, type PostFxOptions, type RenderView } from './postfx';
import { ScopeCamera } from './scopeCamera';
import type { QualityPreset } from '../state/store';

export type RendererBackend = 'webgpu' | 'webgl2';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  quality: QualityPreset;
  preferWebGPU: boolean;
}

export interface QualitySettings {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  postfx: PostFxOptions | null;
  anisotropy: number;
  grassDensity: number;
  crowdDensity: number;
}

export function qualitySettings(preset: QualityPreset, devicePixelRatio: number): QualitySettings {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  switch (preset) {
    case 'low':
      return {
        pixelRatio: Math.min(1, dpr),
        shadows: false,
        shadowMapSize: 512,
        postfx: null,
        anisotropy: 1,
        grassDensity: 0.25,
        crowdDensity: 0.35,
      };
    case 'medium':
      return {
        pixelRatio: Math.min(1.25, dpr),
        shadows: true,
        shadowMapSize: 1024,
        postfx: { bloom: true, dof: true, smaa: false, ao: false },
        anisotropy: 2,
        grassDensity: 0.5,
        crowdDensity: 0.6,
      };
    case 'ultra':
      return {
        pixelRatio: Math.min(2, dpr),
        shadows: true,
        shadowMapSize: 4096,
        postfx: { bloom: true, dof: true, smaa: true, ao: true },
        anisotropy: 8,
        grassDensity: 1,
        crowdDensity: 1,
      };
    case 'high':
    default:
      return {
        pixelRatio: Math.min(1.5, dpr),
        shadows: true,
        shadowMapSize: 2048,
        postfx: { bloom: true, dof: true, smaa: true, ao: false },
        anisotropy: 4,
        grassDensity: 0.75,
        crowdDensity: 0.8,
      };
  }
}

export class RenderPipeline {
  readonly backend: RendererBackend;
  // WebGPURenderer and WebGLRenderer do not share a public base class with the
  // methods we need, so the field is typed loosely and documented here.
  readonly renderer: THREE.WebGLRenderer;
  private webgpu: unknown = null;
  private postfx: PostFx | null = null;
  private scope: ScopeCamera | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private quality: QualitySettings;
  private canvas: HTMLCanvasElement;

  private constructor(
    backend: RendererBackend,
    renderer: THREE.WebGLRenderer,
    canvas: HTMLCanvasElement,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    quality: QualitySettings,
  ) {
    this.backend = backend;
    this.renderer = renderer;
    this.canvas = canvas;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
  }

  static async create(options: RendererOptions, scene: THREE.Scene, camera: THREE.PerspectiveCamera): Promise<RenderPipeline> {
    const quality = qualitySettings(options.quality, window.devicePixelRatio);
    const gpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

    if (options.preferWebGPU && gpuAvailable) {
      try {
        const mod = (await import('three/webgpu')) as unknown as {
          WebGPURenderer: new (params: { canvas: HTMLCanvasElement; antialias: boolean }) => THREE.WebGLRenderer & {
            init: () => Promise<void>;
          };
        };
        const gpu = new mod.WebGPURenderer({ canvas: options.canvas, antialias: true });
        await gpu.init();
        gpu.setPixelRatio(quality.pixelRatio);
        gpu.setSize(window.innerWidth, window.innerHeight, false);
        gpu.toneMapping = THREE.ACESFilmicToneMapping;
        gpu.toneMappingExposure = 1.0;
        gpu.outputColorSpace = THREE.SRGBColorSpace;
        const pipeline = new RenderPipeline('webgpu', gpu, options.canvas, scene, camera, quality);
        pipeline.webgpu = gpu;
        return pipeline;
      } catch (error) {
        console.warn('[GOLD RING] WebGPU unavailable, falling back to WebGL 2.', error);
      }
    }

    const renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.setPixelRatio(quality.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = quality.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = true;

    const pipeline = new RenderPipeline('webgl2', renderer, options.canvas, scene, camera, quality);
    pipeline.rebuildPostFx();
    pipeline.scope = new ScopeCamera(renderer, scene);
    pipeline.scope.attachTo(camera);
    return pipeline;
  }

  private rebuildPostFx(): void {
    if (this.backend !== 'webgl2') return;
    this.postfx?.dispose();
    this.postfx = null;
    if (!this.quality.postfx) return;
    try {
      this.postfx = new PostFx(this.renderer, this.scene, this.camera, this.quality.postfx);
      this.postfx.setSize(window.innerWidth, window.innerHeight);
    } catch (error) {
      console.warn('[GOLD RING] Post-processing unavailable, rendering without it.', error);
      this.postfx = null;
    }
  }

  get scopeCamera(): ScopeCamera | null {
    return this.scope;
  }

  get usingPostFx(): boolean {
    return this.postfx !== null;
  }

  get qualityPreset(): QualitySettings {
    return this.quality;
  }

  setQuality(preset: QualityPreset): void {
    this.quality = qualitySettings(preset, window.devicePixelRatio);
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.rebuildPostFx();
    this.resize(window.innerWidth, window.innerHeight);
  }

  /** Adaptive resolution: drop the pixel ratio when the frame time is high. */
  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
    this.postfx?.setPixelRatio(ratio);
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.postfx?.setSize(width, height);
  }

  /**
   * Render one frame.
   *
   * @param view DOF/vignette parameters
   * @param scope optional scope parameters (compound only)
   */
  render(
    dt: number,
    view: RenderView,
    scope?: { magnification: number; cantRad: number; position?: THREE.Vector3 } | null,
  ): void {
    if (scope && this.scope) {
      this.scope.setVisible(true);
      this.scope.render(this.renderer, this.scene, this.camera, scope.magnification, scope.cantRad, dt, scope.position);
    } else {
      this.scope?.setVisible(false);
    }

    if (this.postfx) {
      this.postfx.setCamera(this.camera);
      this.postfx.render(dt, view);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose(): void {
    this.postfx?.dispose();
    this.scope?.dispose();
    this.renderer.dispose();
    void this.canvas;
    void this.webgpu;
  }
}
