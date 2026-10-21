// Camera framing for thumbnails: the model's bounding box is projected into the frustum and
// the camera moved back until every corner fits, with a small margin. A fixed multiple of
// the bounding-sphere radius (the old approach) cuts wide or flat parts off at the edges,
// because the sphere says nothing about where the extent actually is relative to the view.
import * as THREE from 'three';

export const THUMB_FOV = 32;
/** Three-quarter view from front-right, slightly above (Z is up for printing models). */
export const VIEW_DIR = new THREE.Vector3(0.62, -0.66, 0.42).normalize();
const UP = new THREE.Vector3(0, 0, 1);

/**
 * Distance from the box centre along `dir` at which all eight corners fit a frustum with
 * the given vertical field of view and aspect ratio. `margin` scales the corners' projected
 * offsets so the model does not touch the frame.
 */
export function fitDistance(box: THREE.Box3, dir: THREE.Vector3, fovDeg = THUMB_FOV, aspect = 1, margin = 1.08): number {
  const forward = dir.clone().negate().normalize();
  const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  const center = box.getCenter(new THREE.Vector3());
  const c = new THREE.Vector3();
  let need = 0;
  for (let i = 0; i < 8; i++) {
    c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    const toward = c.dot(dir); // how far this corner sits in front of the centre, towards the camera
    need = Math.max(need, (Math.abs(c.dot(right)) * margin) / tanH + toward, (Math.abs(c.dot(up)) * margin) / tanV + toward);
  }
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  return Math.max(need, radius * 1.2, 0.01);
}
