/**
 * Lighting and sky.
 *
 * A physically-plausible outdoor setup: a Sky shader for the atmosphere, a
 * PMREM-filtered environment for image-based lighting, a two-cascade sun (near
 * lane + far butts) and a hemisphere fill.
 *
 * Browser reality check: Lumen/Nanite-style fully dynamic GI is not available
 * in WebGL 2. The closest equivalents used here are:
 *   - IBL from a PMREM-filtered sky (indirect diffuse/specular),
 *   - baked ambient occlusion in the venue materials (vertex colours),
 *   - a two-cascade shadow map instead of a single huge frustum,
 *   - contact shadows under the archer, butts and stands.
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export type TimeOfDay = 'morning' | 'noon' | 'golden' | 'overcast';
export type Weather = 'clear' | 'cloudy' | 'lightRain' | 'windy' | 'overcast';

export interface LightingPreset {
  sunElevation: number;
  sunAzimuth: number;
  turbidity: number;
  rayleigh: number;
  exposure: number;
  sunIntensity: number;
  hemiIntensity: number;
  fogColor: number;
  fogDensity: number;
  groundColor: number;
}

const PRESETS: Record<TimeOfDay, LightingPreset> = {
  morning: {
    sunElevation: 22,
    sunAzimuth: 108,
    turbidity: 5,
    rayleigh: 1.4,
    exposure: 0.95,
    sunIntensity: 3.1,
    hemiIntensity: 0.55,
    fogColor: 0xcfe0ea,
    fogDensity: 0.0024,
    groundColor: 0x6d7a52,
  },
  noon: {
    sunElevation: 58,
    sunAzimuth: 175,
    turbidity: 4,
    rayleigh: 0.9,
    exposure: 0.72,
    sunIntensity: 2.8,
    hemiIntensity: 0.35,
    fogColor: 0xd6e5f0,
    fogDensity: 0.0016,
    groundColor: 0x77854f,
  },
  golden: {
    sunElevation: 9,
    sunAzimuth: 252,
    turbidity: 7,
    rayleigh: 2.6,
    exposure: 1.05,
    sunIntensity: 2.6,
    hemiIntensity: 0.45,
    fogColor: 0xe8c9a8,
    fogDensity: 0.003,
    groundColor: 0x6a6a3f,
  },
  overcast: {
    sunElevation: 42,
    sunAzimuth: 140,
    turbidity: 12,
    rayleigh: 0.4,
    exposure: 0.9,
    sunIntensity: 1.1,
    hemiIntensity: 1.15,
    fogColor: 0xa9b4bd,
    fogDensity: 0.004,
    groundColor: 0x5f6a4b,
  },
};

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  /** Second, wider shadow cascade for the target butts. */
  readonly sunFar: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: Sky;
  readonly fog: THREE.FogExp2;
  private pmrem: THREE.PMREMGenerator;
  private envTexture: THREE.Texture | null = null;
  private sunDirection = new THREE.Vector3(0.4, 0.8, -0.3);
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;

    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    this.sky.name = 'sky';
    scene.add(this.sky);

    this.fog = new THREE.FogExp2(0xcfe0ea, 0.0022);
    scene.fog = this.fog;

    this.sun = new THREE.DirectionalLight(0xfff2dd, 3.2);
    this.sun.name = 'sun';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 90;
    this.sun.shadow.camera.left = -16;
    this.sun.shadow.camera.right = 16;
    this.sun.shadow.camera.top = 16;
    this.sun.shadow.camera.bottom = -16;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.sunFar = new THREE.DirectionalLight(0xfff2dd, 1.15);
    this.sunFar.name = 'sun-far';
    this.sunFar.castShadow = true;
    this.sunFar.shadow.mapSize.set(1024, 1024);
    this.sunFar.shadow.camera.near = 30;
    this.sunFar.shadow.camera.far = 140;
    this.sunFar.shadow.camera.left = -22;
    this.sunFar.shadow.camera.right = 22;
    this.sunFar.shadow.camera.top = 18;
    this.sunFar.shadow.camera.bottom = -8;
    this.sunFar.shadow.bias = -0.0008;
    this.sunFar.shadow.normalBias = 0.05;
    scene.add(this.sunFar);
    scene.add(this.sunFar.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x55603c, 0.6);
    scene.add(this.hemi);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /** Apply a time-of-day + weather preset and rebuild the environment map. */
  apply(timeOfDay: TimeOfDay, weather: Weather): LightingPreset {
    const preset = { ...PRESETS[timeOfDay] };

    if (weather === 'overcast') {
      preset.sunIntensity *= 0.35;
      preset.hemiIntensity *= 1.8;
      preset.turbidity = 14;
      preset.rayleigh = 0.3;
      preset.exposure *= 0.95;
    } else if (weather === 'cloudy') {
      preset.sunIntensity *= 0.65;
      preset.hemiIntensity *= 1.35;
      preset.turbidity = 9;
    } else if (weather === 'lightRain') {
      preset.sunIntensity *= 0.45;
      preset.hemiIntensity *= 1.5;
      preset.turbidity = 16;
      preset.fogDensity *= 1.8;
      preset.exposure *= 0.92;
    } else if (weather === 'windy') {
      preset.turbidity += 2;
      preset.fogDensity *= 0.9;
    }

    const phi = THREE.MathUtils.degToRad(90 - preset.sunElevation);
    const theta = THREE.MathUtils.degToRad(preset.sunAzimuth);
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    const uniforms = this.sky.material.uniforms;
    uniforms['turbidity'].value = preset.turbidity;
    uniforms['rayleigh'].value = preset.rayleigh;
    uniforms['mieCoefficient'].value = 0.005;
    uniforms['mieDirectionalG'].value = 0.8;
    uniforms['sunPosition'].value.copy(sunPosition);

    this.sun.position.copy(sunPosition).multiplyScalar(80);
    this.sun.target.position.set(0, 0, 35);
    this.sun.intensity = preset.sunIntensity;
    this.sun.color.setHex(weather === 'lightRain' || weather === 'overcast' ? 0xdfe7ee : 0xfff2dd);
    this.sunDirection.copy(sunPosition).normalize();

    this.sunFar.position.copy(sunPosition).multiplyScalar(110);
    this.sunFar.target.position.set(0, 0, 55);
    this.sunFar.intensity = preset.sunIntensity * 0.35;

    this.hemi.intensity = preset.hemiIntensity;
    this.hemi.color.setHex(weather === 'overcast' ? 0xc6d0da : 0xbfd8ff);
    this.hemi.groundColor.setHex(preset.groundColor);

    this.fog.color.setHex(preset.fogColor);
    this.fog.density = preset.fogDensity;
    this.renderer.toneMappingExposure = preset.exposure;

    this.rebuildEnvironment();
    return preset;
  }

  /**
   * PMREM the sky into an environment map. This is what gives the carbon
   * risers, the anodised sights and the wet grass their reflections.
   */
  private rebuildEnvironment(): void {
    try {
      const envScene = new THREE.Scene();
      const skyClone = new Sky();
      skyClone.scale.setScalar(10000);
      const src = this.sky.material.uniforms;
      const dst = skyClone.material.uniforms;
      for (const key of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) {
        dst[key].value = src[key].value;
      }
      dst['sunPosition'].value.copy(src['sunPosition'].value);
      envScene.add(skyClone);

      const target = this.pmrem.fromScene(envScene, 0.02, 1, 50000);
      if (this.envTexture) this.envTexture.dispose();
      this.envTexture = target.texture;
      this.scene.environment = target.texture;
      this.scene.environmentIntensity = 0.35;

      skyClone.geometry.dispose();
      (skyClone.material as THREE.Material).dispose();
    } catch (error) {
      // Environment lighting is a bonus: a broken PMREM must never stop the game.
      console.warn('[GOLD RING] Environment map generation failed; using analytic lights only.', error);
    }
  }

  /** Keep the near shadow cascade centred on the archer. */
  followArcher(x: number, z: number): void {
    this.sun.position.set(x + this.sunDirection.x * 80, this.sunDirection.y * 80, z + this.sunDirection.z * 80);
    this.sun.target.position.set(x, 0, z + 10);
    this.sun.target.updateMatrixWorld();
    this.sunFar.position.set(x + this.sunDirection.x * 110, this.sunDirection.y * 110, z + this.sunDirection.z * 110);
    this.sunFar.target.position.set(x, 0, z + 45);
    this.sunFar.target.updateMatrixWorld();
  }

  dispose(): void {
    this.pmrem.dispose();
    this.envTexture?.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
  }
}
