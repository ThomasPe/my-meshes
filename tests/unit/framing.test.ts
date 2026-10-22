import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fitDistance, THUMB_FOV, VIEW_DIR } from '@/lib/thumbs/framing';

/** Largest |ndc| over the box corners for a camera at `distance` along VIEW_DIR. */
function worstNdc(box: THREE.Box3, distance: number): number {
  const camera = new THREE.PerspectiveCamera(THUMB_FOV, 1, 0.01, 1e6);
  camera.up.set(0, 0, 1);
  camera.position.copy(VIEW_DIR).multiplyScalar(distance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const center = box.getCenter(new THREE.Vector3());
  let worst = 0;
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center).project(camera);
    worst = Math.max(worst, Math.abs(c.x), Math.abs(c.y));
  }
  return worst;
}

describe('thumbnail framing', () => {
  const boxes = {
    cube: new THREE.Box3(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(10, 10, 20)),
    tray: new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(200, 120, 15)), // screws organizer
    tower: new THREE.Box3(new THREE.Vector3(100, 100, 100), new THREE.Vector3(120, 130, 300)), // off-origin
  };
  it('keeps every corner inside the frame, with a visible margin', () => {
    for (const box of Object.values(boxes)) {
      const d = fitDistance(box, VIEW_DIR);
      const worst = worstNdc(box, d);
      expect(worst).toBeLessThan(1);
      expect(worst).toBeGreaterThan(0.85); // tight, not a tiny model in a big frame
    }
  });
  it('stays close to the sphere rule for compact parts and backs off for flat ones', () => {
    const r = (b: THREE.Box3) => b.getSize(new THREE.Vector3()).length() / 2;
    // a sphere of radius r fits the 32° frustum from 3.63·r; the box corners need about that
    expect(fitDistance(boxes.cube, VIEW_DIR)).toBeLessThan(r(boxes.cube) * 3.63 * 1.1);
    // the old fixed 3.1·radius cut the tray off at the sides
    expect(worstNdc(boxes.tray, r(boxes.tray) * 3.1)).toBeGreaterThan(1);
  });
});
