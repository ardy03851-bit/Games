/**
 * Terrain mesh: converts the heightfield + painted colours into one geometry.
 * A skirt is welded around the border so the camera can never see underneath
 * the world, and the whole thing is displaced into place once at load.
 */
import * as THREE from 'three';
import { createTerrainMaterial } from './materials.js';
import { groundTexture } from './textures.js';

export function buildTerrainMesh(world) {
  const N = world.grid;
  const half = world.size / 2;
  const cell = world.cell;

  const positions = new Float32Array(N * N * 3);
  const colors = new Float32Array(N * N * 3);
  const aos = new Float32Array(N * N);

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      positions[i * 3] = -half + x * cell;
      positions[i * 3 + 1] = world.height[i];
      positions[i * 3 + 2] = -half + z * cell;
      colors[i * 3] = world.colors[i * 3];
      colors[i * 3 + 1] = world.colors[i * 3 + 1];
      colors[i * 3 + 2] = world.colors[i * 3 + 2];
      aos[i] = world.ao[i];
    }
  }

  const indices = new Uint32Array((N - 1) * (N - 1) * 6);
  let ii = 0;
  for (let z = 0; z < N - 1; z++) {
    for (let x = 0; x < N - 1; x++) {
      const a = z * N + x;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      // alternate the diagonal for a less regular triangulation
      if ((x + z) & 1) {
        indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
        indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
      } else {
        indices[ii++] = a; indices[ii++] = c; indices[ii++] = d;
        indices[ii++] = a; indices[ii++] = d; indices[ii++] = b;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aAO', new THREE.BufferAttribute(aos, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = createTerrainMaterial();
  mat.uniforms.uGround.value = groundTexture();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  // ---- skirt: a wall dropped from the border so no gaps show at the edges
  const skirtPositions = [];
  const border = [];
  for (let x = 0; x < N; x++) border.push([x, 0]);
  for (let z = 1; z < N; z++) border.push([N - 1, z]);
  for (let x = N - 2; x >= 0; x--) border.push([x, N - 1]);
  for (let z = N - 2; z >= 1; z--) border.push([0, z]);

  for (let i = 0; i < border.length; i++) {
    const [x, z] = border[i];
    const [nx, nz] = border[(i + 1) % border.length];
    const i0 = z * N + x;
    const i1 = nz * N + nx;
    const p0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
    const p1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
    const drop = 26;
    skirtPositions.push(
      p0[0], p0[1], p0[2], p0[0], p0[1] - drop, p0[2], p1[0], p1[1], p1[2],
      p1[0], p1[1], p1[2], p0[0], p0[1] - drop, p0[2], p1[0], p1[1] - drop, p1[2],
    );
  }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPositions, 3));
  const skirtColors = new Float32Array(skirtPositions.length);
  for (let i = 0; i < skirtColors.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      skirtColors[i + k * 3] = 0.15;
      skirtColors[i + k * 3 + 1] = 0.18;
      skirtColors[i + k * 3 + 2] = 0.14;
    }
  }
  skirtGeo.setAttribute('aColor', new THREE.BufferAttribute(skirtColors, 3));
  skirtGeo.setAttribute('aAO', new THREE.BufferAttribute(new Float32Array(skirtPositions.length / 3).fill(0.35), 1));
  skirtGeo.computeVertexNormals();
  const skirt = new THREE.Mesh(skirtGeo, mat);
  skirt.frustumCulled = false;

  const group = new THREE.Group();
  group.add(mesh, skirt);
  return group;
}
