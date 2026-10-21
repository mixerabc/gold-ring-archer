/**
 * Instanced grass.
 *
 * A single InstancedMesh of blade quads, swayed in the vertex shader by the
 * same wind strength that drives the arrow. Density is a quality preset, and
 * the field is skipped entirely on the Low preset.
 */

import * as THREE from 'three';
import { mulberry32 } from '@shared/math/random';

export class GrassField {
  readonly mesh: THREE.InstancedMesh;
  private uniforms = { uTime: { value: 0 }, uStrength: { value: 0.12 }, uWindX: { value: 0 }, uWindZ: { value: 0 } };
  private geometry: THREE.PlaneGeometry;
  private material: THREE.MeshStandardMaterial;

  constructor(count: number, area = 150, seed = 4711) {
    const geo = new THREE.PlaneGeometry(0.03, 0.24, 1, 3);
    geo.translate(0, 0.12, 0);
    this.geometry = geo;

    const mat = new THREE.MeshStandardMaterial({
      color: 0x3d5a2a,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.material = mat;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = this.uniforms.uTime;
      shader.uniforms['uStrength'] = this.uniforms.uStrength;
      shader.uniforms['uWindX'] = this.uniforms.uWindX;
      shader.uniforms['uWindZ'] = this.uniforms.uWindZ;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           uniform float uStrength;
           uniform float uWindX;
           uniform float uWindZ;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec3 iPos = instanceMatrix[3].xyz;
           float bend = pow(clamp(position.y / 0.24, 0.0, 1.0), 1.6);
           float phase = iPos.x * 0.45 + iPos.z * 0.32;
           transformed.x += (sin(uTime * 1.7 + phase) * 0.6 + uWindX * 0.5) * uStrength * bend;
           transformed.z += (cos(uTime * 1.3 + phase * 0.8) * 0.5 + uWindZ * 0.5) * uStrength * bend * 0.6;`,
        );
    };

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = 'grass';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.mesh = mesh;

    const rand = mulberry32(seed);
    const dummy = new THREE.Object3D();
    const half = area / 2;
    for (let i = 0; i < count; i++) {
      let x = (rand() - 0.5) * area;
      let z = (rand() - 0.5) * area;
      // Keep the shooting line and the immediate lane clear.
      if (Math.abs(z) < 2.2 && Math.abs(x) < 12) {
        z += z >= 0 ? 3 : -3;
      }
      const scale = 0.6 + rand() * 0.9;
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, (rand() - 0.5) * 0.12);
      dummy.scale.set(0.7 + rand() * 0.7, scale, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // Slight colour variation per blade.
      const tint = 0.75 + rand() * 0.4;
      mesh.setColorAt(i, new THREE.Color(0x3d5a2a).multiplyScalar(tint));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    void half;
  }

  update(time: number, windX: number, windZ: number, strength: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uWindX.value = windX;
    this.uniforms.uWindZ.value = windZ;
    this.uniforms.uStrength.value = strength;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
