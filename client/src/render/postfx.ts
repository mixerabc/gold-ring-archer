/**
 * Post-processing chain.
 *
 * Order (all linear until the OutputPass):
 *   render -> [GTAO] -> bloom -> depth of field (aim mode only) -> grade
 *          -> tone map / sRGB -> SMAA
 *
 * The depth-of-field pass is only enabled while the camera is in aim mode; in
 * third person the range stays crisp, which also keeps the frame budget for
 * the crowd and the grass.
 *
 * GTAO is expensive, so it is reserved for the Ultra preset. On High the
 * ambient occlusion is baked into the venue materials instead (see
 * `lighting.ts`), which is the closest browser equivalent to a Lumen-style
 * indirect pass.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

export interface PostFxOptions {
  bloom: boolean;
  dof: boolean;
  smaa: boolean;
  ao: boolean;
}

export interface RenderView {
  /** 0 = third person, 1 = first-person aim. */
  aimBlend: number;
  /** Distance from the camera to the focus point, metres. */
  focusDistance: number;
  /** Lens aperture for the DOF pass (bigger = shallower). */
  aperture: number;
}

/** Colour grade + vignette + film grain, applied before tone mapping. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uAim: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAim;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;

      // Gentle filmic grade: cool shadows, warm highlights, a little extra
      // saturation. Kept subtle so the target colours stay true.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, col * vec3(0.96, 1.0, 1.06), (1.0 - luma) * 0.35);
      col = mix(col, col * vec3(1.04, 1.0, 0.95), luma * 0.28);
      col = mix(vec3(luma), col, 1.06);

      // Vignette: stronger in aim mode, where the eye is on the gold.
      vec2 p = vUv - 0.5;
      float vig = smoothstep(0.28, 0.82, length(p));
      col *= 1.0 - vig * (uVignette + uAim * 0.18);

      // Film grain (animated, very fine).
      float grain = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7) - 0.5;
      col += grain * uGrain;

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `,
};

export class PostFx {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass | null = null;
  private bokehPass: BokehPass | null = null;
  private smaaPass: SMAAPass | null = null;
  private outputPass: OutputPass;
  private gradePass: ShaderPass;
  private gtaoPass: GTAOPass | null = null;
  private renderer: THREE.WebGLRenderer;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    options: PostFxOptions,
  ) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    if (options.ao) {
      // GTAO needs the depth+normal buffer; it is only used on Ultra.
      this.gtaoPass = new GTAOPass(scene, camera, 1, 1);
      this.gtaoPass.output = GTAOPass.OUTPUT.Default;
      this.composer.addPass(this.gtaoPass);
    }

    if (options.bloom) {
      // Threshold is in linear HDR: the sky is far above 1.0, so a low threshold
      // would bloom the whole frame into a white haze.
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.1, 0.3, 4.5);
      this.composer.addPass(this.bloomPass);
    }

    if (options.dof) {
      this.bokehPass = new BokehPass(scene, camera, {
        focus: 20,
        aperture: 0.0007,
        maxblur: 0.008,
      });
      this.bokehPass.enabled = false;
      this.composer.addPass(this.bokehPass);
    }

    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    if (options.smaa) {
      this.smaaPass = new SMAAPass();
      this.composer.addPass(this.smaaPass);
    }
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  setPixelRatio(ratio: number): void {
    this.composer.setPixelRatio(ratio);
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.renderPass.camera = camera;
    if (this.bokehPass) this.bokehPass.camera = camera;
    if (this.gtaoPass) this.gtaoPass.camera = camera;
  }

  render(dt: number, view: RenderView): void {
    if (this.bokehPass) {
      const aiming = view.aimBlend > 0.5;
      this.bokehPass.enabled = aiming;
      if (aiming) {
        const uniforms = this.bokehPass.uniforms as unknown as Record<string, { value: number }>;
        uniforms['focus'].value = view.focusDistance;
        uniforms['aperture'].value = view.aperture;
        uniforms['maxblur'].value = 0.006;
      }
    }
    this.gradePass.uniforms['uTime'].value += dt;
    this.gradePass.uniforms['uAim'].value = view.aimBlend;
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.bloomPass?.dispose();
    this.smaaPass?.dispose();
    this.outputPass.dispose();
    this.gradePass.dispose();
    this.gtaoPass?.dispose();
  }

  /** Exposed for the adaptive-resolution controller. */
  get passes(): number {
    return this.composer.passes.length;
  }

  get rendererRef(): THREE.WebGLRenderer {
    return this.renderer;
  }
}
