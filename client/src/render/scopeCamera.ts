/**
 * Compound scope camera.
 *
 * A second PerspectiveCamera renders the magnified target into a render target,
 * which is then sampled by a small lens plane attached to the first-person
 * camera. The lens shows the reticle, the spirit level bubble, a vignette and
 * a little chromatic aberration.
 *
 * Cost control: the target is only rendered while the player is actually
 * looking through the scope (compound + first person + aiming), and the render
 * target is sized to the lens on screen, not to the window.
 */

import * as THREE from 'three';
import scopeShader from './scopeShader.glsl?raw';

export class ScopeCamera {
  readonly target: THREE.WebGLRenderTarget;
  readonly camera: THREE.PerspectiveCamera;
  readonly lens: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private enabled = false;
  private baseFov = 42;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    const size = 512;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      samples: 2,
    });

    this.camera = new THREE.PerspectiveCamera(10, 1, 0.05, 500);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uMagnification: { value: 4 },
        uCant: { value: 0 },
        uBubbleOffset: { value: 0 },
        uReticleColor: { value: new THREE.Color('#ff5a3c') },
        uTime: { value: 0 },
        uLensRadius: { value: 0.94 },
        uShowReticle: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: scopeShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    // A 13 cm disc, 28 cm in front of the eye: about the size a scope housing
    // covers in a real sight picture.
    this.lens = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), this.material);
    this.lens.position.set(0, -0.005, -0.28);
    this.lens.renderOrder = 9999;
    this.lens.frustumCulled = false;
    this.lens.visible = false;
    this.lens.matrixAutoUpdate = true;

    // Keep a reference so TypeScript knows the scene is used by `render`.
    void scene;
    void renderer;
  }

  /** Add the lens to the first-person camera rig. */
  attachTo(camera: THREE.Camera): void {
    camera.add(this.lens);
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    this.lens.visible = visible;
  }

  /**
   * Render the magnified view.
   *
   * @param renderer WebGL renderer
   * @param scene scene to render (the lens itself is hidden during the pass)
   * @param eye the first-person camera the scope follows
   * @param magnification scope magnification (4x / 6x)
   * @param cantRad bow cant, radians
   */
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    eye: THREE.PerspectiveCamera,
    magnification: number,
    cantRad: number,
    dt: number,
    scopeWorld?: THREE.Vector3,
  ): void {
    if (!this.enabled) return;

    this.baseFov = eye.fov;
    eye.updateMatrixWorld();
    // The scope camera sits at the eyepiece, not at the eye: otherwise the
    // riser fills the magnified view. Orientation follows the aim.
    const position = scopeWorld ? scopeWorld.clone() : eye.position.clone();
    this.camera.position.copy(position);
    this.camera.quaternion.copy(eye.quaternion);
    // Keep the lens plane glued to the eyepiece on screen.
    const local = eye.worldToLocal(position.clone());
    if (local.z < -0.05) {
      this.lens.position.set(local.x, local.y, local.z);
    } else {
      this.lens.position.set(0, -0.005, -0.28);
    }
    this.camera.aspect = eye.aspect;
    this.camera.near = eye.near;
    this.camera.far = eye.far;
    // Magnification divides the field of view.
    this.camera.fov = Math.max(1.2, this.baseFov / Math.max(1, magnification));
    this.camera.updateProjectionMatrix();

    this.material.uniforms['uMagnification'].value = 1; // the scope camera already magnifies
    this.material.uniforms['uCant'].value = cantRad;
    this.material.uniforms['uBubbleOffset'].value = Math.sin(cantRad) * 0.9;
    this.material.uniforms['uTime'].value += dt;

    this.lens.visible = false;
    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    this.lens.visible = true;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.lens.geometry.dispose();
  }
}
