// Procedural stand-ins for typical 3D-print projects. Each builder returns a THREE.Group
// roughly centred at the origin, sized in "millimetres" (about 40–90 units across).
import * as THREE from 'three';

export const FILAMENT = {
  orange: 0xf08a24, cream: 0xe8dcc4, black: 0x2b2e35, silver: 0xb4b8bf, blue: 0x3b7ddd,
  green: 0x4caf6e, terracotta: 0xc7623f, purple: 0x7c5cbf, teal: 0x2aa198, white: 0xeceff3,
  red: 0xd84a3a, pink: 0xe4729b, yellow: 0xf2c33c, navy: 0x2e3a5c, lime: 0xa3d13a, grey: 0x7d838c,
};

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, flatShading: false, ...opts });
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function roundedRectPath(cx, cy, w, h, r) {
  const p = new THREE.Path();
  const x = cx - w / 2, y = cy - h / 2;
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

function circlePath(cx, cy, r) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return p;
}

function polygonPath(cx, cy, r, n, rot = 0) {
  const p = new THREE.Path();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

function polygonShape(r, n, rot = 0) {
  const s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

// Extrude a shape "upwards" (Y axis) by height h with the shape lying in the XZ plane.
function extrudeUp(shape, h, bevel = 0.6) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, 0);
  return g;
}

// ---------- builders ----------

export function gridfinityBaseplate(color = FILAMENT.orange) {
  const g = new THREE.Group();
  const cols = 4, rows = 3, cell = 42, h = 5;
  const plate = roundedRect(cols * cell, rows * cell, 4);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const cx = (i - (cols - 1) / 2) * cell, cy = (j - (rows - 1) / 2) * cell;
    plate.holes.push(roundedRectPath(cx, cy, cell - 4.5, cell - 4.5, 4));
  }
  g.add(new THREE.Mesh(extrudeUp(plate, h, 0.4), mat(color)));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(cols * cell, 1.2, rows * cell), mat(color));
  floor.position.y = 0.6;
  g.add(floor);
  // a couple of bins sitting in the plate
  const bin = roundedRect(cell - 1, cell - 1, 4);
  const binMesh = new THREE.Mesh(extrudeUp(bin, 21, 0.6), mat(FILAMENT.black));
  binMesh.position.set(cell * 1.5, 4, cell);
  g.add(binMesh);
  const bin2 = roundedRect(cell * 2 - 1, cell - 1, 4);
  const bin2Mesh = new THREE.Mesh(extrudeUp(bin2, 14, 0.6), mat(FILAMENT.black));
  bin2Mesh.position.set(-cell, 4, -cell);
  g.add(bin2Mesh);
  return g;
}

export function benchy(color = FILAMENT.orange) {
  const g = new THREE.Group();
  const hull = new THREE.Shape();
  hull.moveTo(-30, -12); hull.lineTo(10, -12);
  hull.quadraticCurveTo(26, -10, 32, 0);
  hull.quadraticCurveTo(26, 10, 10, 12);
  hull.lineTo(-30, 12); hull.quadraticCurveTo(-34, 0, -30, -12);
  const inner = new THREE.Path();
  inner.moveTo(-27, -9); inner.lineTo(8, -9); inner.quadraticCurveTo(22, -8, 27, 0);
  inner.quadraticCurveTo(22, 8, 8, 9); inner.lineTo(-27, 9); inner.quadraticCurveTo(-30, 0, -27, -9);
  hull.holes.push(inner);
  const hullMesh = new THREE.Mesh(extrudeUp(hull, 15, 0.6), mat(color));
  g.add(hullMesh);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(58, 2, 20), mat(color));
  deck.position.set(-2, 5, 0); g.add(deck);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(22, 16, 18), mat(color));
  cabin.position.set(-14, 14, 0); g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(26, 2, 22), mat(color));
  roof.position.set(-14, 23, 0); g.add(roof);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 10, 24), mat(color));
  chimney.position.set(-4, 28, 0); g.add(chimney);
  const win = new THREE.Mesh(new THREE.BoxGeometry(1, 7, 7), mat(FILAMENT.black));
  win.position.set(-2.6, 15, 0); g.add(win);
  const bow = new THREE.Mesh(new THREE.BoxGeometry(10, 1.5, 12), mat(color));
  bow.position.set(22, 6, 0); g.add(bow);
  return g;
}

export function rippleVase(color = FILAMENT.cream) {
  const g = new THREE.Group();
  const H = 70, rings = 90, segs = 160;
  const pos = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, y = t * H;
    const base = 14 + 12 * Math.sin(t * Math.PI) - 5 * Math.pow(t, 4);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const r = base * (1 + 0.07 * Math.sin(14 * a + 5 * t));
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + segs + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, mat(color, { side: THREE.DoubleSide, roughness: 0.4 })));
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 1.5, 48), mat(color));
  bottom.position.y = 0.75; g.add(bottom);
  return g;
}

export function phoneStand(color = FILAMENT.black) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(60, 0); s.lineTo(60, 6); s.lineTo(44, 6); s.lineTo(44, 14);
  s.lineTo(38, 14); s.lineTo(38, 6); s.lineTo(16, 6); s.lineTo(4, 58); s.lineTo(-4, 58); s.lineTo(8, 0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 70, bevelEnabled: true, bevelSize: 0.8, bevelThickness: 0.8, bevelSegments: 2 });
  geo.translate(-28, 0, -35);
  g.add(new THREE.Mesh(geo, mat(color, { roughness: 0.7 })));
  // phone
  const phone = new THREE.Mesh(new THREE.BoxGeometry(2.5, 72, 36), mat(0x1a1c22, { roughness: 0.25, metalness: 0.3 }));
  phone.position.set(12, 40, 0); phone.rotation.z = -0.22;
  g.add(phone);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.4, 66, 32), mat(0x3a4a6a, { roughness: 0.15, metalness: 0.1, emissive: 0x16233b }));
  screen.position.set(13.6, 40.2, 0); screen.rotation.z = -0.22;
  g.add(screen);
  return g;
}

function gearShape(teeth, rOuter, rInner, bore) {
  const s = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = i % 4;
    const r = (k === 1 || k === 2) ? rOuter : rInner;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  s.holes.push(circlePath(0, 0, bore));
  return s;
}

export function gears(color = FILAMENT.silver) {
  const g = new THREE.Group();
  const big = gearShape(22, 34, 29, 5);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    big.holes.push(circlePath(Math.cos(a) * 17, Math.sin(a) * 17, 6));
  }
  const bigMesh = new THREE.Mesh(extrudeUp(big, 8, 0.5), mat(color, { metalness: 0.35, roughness: 0.45 }));
  bigMesh.position.set(-10, 0, 4); g.add(bigMesh);
  const small = gearShape(11, 18, 14, 4);
  const smallMesh = new THREE.Mesh(extrudeUp(small, 8, 0.5), mat(FILAMENT.orange));
  smallMesh.position.set(38, 0, -14); smallMesh.rotation.y = 0.14; g.add(smallMesh);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 14, 32), mat(color, { metalness: 0.35 }));
  hub.position.set(-10, 7, 4); g.add(hub);
  return g;
}

export function hexBitHolder(color = FILAMENT.blue) {
  const g = new THREE.Group();
  const body = roundedRect(78, 40, 5);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
    body.holes.push(polygonPath((i - 2.5) * 12, (j - 1) * 12, 4.2, 6, Math.PI / 6));
  }
  const m = new THREE.Mesh(extrudeUp(body, 14, 0.8), mat(color));
  g.add(m);
  // a few bits in the holder
  const bitMat = mat(0x9aa0a8, { metalness: 0.7, roughness: 0.3 });
  [[0, 0], [1, 1], [3, 2], [5, 0], [4, 1]].forEach(([i, j]) => {
    const bit = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 26, 6), bitMat);
    bit.position.set((i - 2.5) * 12, 18, -(j - 1) * 12);
    g.add(bit);
  });
  return g;
}

export function planter(color = FILAMENT.terracotta) {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(16 + 18 * t - 4 * t * t, t * 48)); }
  const outer = new THREE.LatheGeometry(pts, 10);
  outer.computeVertexNormals();
  g.add(new THREE.Mesh(outer, mat(color, { flatShading: true, roughness: 0.8 })));
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(31, 31, 3, 10), mat(color, { flatShading: true }));
  rim.position.y = 47; g.add(rim);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(27, 27, 1, 10), mat(0x3a2b22, { roughness: 1 }));
  soil.position.y = 44; g.add(soil);
  // a simple succulent
  const leafMat = mat(0x6aa36b, { roughness: 0.6 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const leaf = new THREE.Mesh(new THREE.CapsuleGeometry(4, 10, 4, 10), leafMat);
    leaf.position.set(Math.cos(a) * 9, 51, Math.sin(a) * 9);
    leaf.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
    g.add(leaf);
  }
  const top = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), leafMat); top.position.y = 54; g.add(top);
  return g;
}

export function articulatedSnake(color = FILAMENT.purple) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.45 });
  const n = 16;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = -45 + t * 90, z = Math.sin(t * Math.PI * 2.2) * 14;
    const r = 7 - t * 4;
    const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m);
    seg.scale.set(1, 0.8, 1); seg.position.set(x, r * 0.8, z);
    g.add(seg);
    if (i < n - 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.9, 1.4, 10, 28), mat(FILAMENT.yellow));
      ring.position.set(x + 2.6, r * 0.8, z); ring.rotation.y = Math.PI / 2 + Math.cos(t * Math.PI * 2.2) * 0.6;
      g.add(ring);
    }
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(8.5, 24, 16), m);
  head.scale.set(1.3, 0.85, 1); head.position.set(-52, 6.5, 0); g.add(head);
  [[-56, 9.5, 4], [-56, 9.5, -4]].forEach(p => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), mat(FILAMENT.white)); eye.position.set(...p); g.add(eye);
  });
  return g;
}

export function storageBox(color = FILAMENT.teal) {
  const g = new THREE.Group();
  const outer = roundedRect(70, 50, 5);
  outer.holes.push(roundedRectPath(0, 0, 66, 46, 4));
  g.add(new THREE.Mesh(extrudeUp(outer, 36, 0.6), mat(color)));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(70, 1.5, 50), mat(color)); floor.position.y = 0.75; g.add(floor);
  const lid = new THREE.Mesh(extrudeUp(roundedRect(72, 52, 6), 5, 0.6), mat(FILAMENT.cream));
  lid.position.set(10, 42, -34); lid.rotation.x = -0.35; lid.rotation.y = 0.15;
  g.add(lid);
  const label = new THREE.Mesh(new THREE.BoxGeometry(32, 14, 0.6), mat(FILAMENT.white));
  label.position.set(0, 20, 25.4); g.add(label);
  return g;
}

export function lampShade(color = FILAMENT.white) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.35, transparent: true, opacity: 0.92 });
  const H = 60;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8; const r = 22 + 10 * Math.sin(t * Math.PI);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 1.3, 10, 48), m);
    ring.rotation.x = Math.PI / 2; ring.position.y = t * H + 1.3; g.add(ring);
  }
  const curve = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; curve.push(new THREE.Vector3(22 + 10 * Math.sin(t * Math.PI), t * H + 1.3, 0)); }
  for (let k = 0; k < 18; k++) {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curve), 24, 1.1, 8, false), m);
    tube.rotation.y = (k / 18) * Math.PI * 2 + 0.15 * (k % 2);
    g.add(tube);
  }
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), mat(0xfff1c7, { emissive: 0xffd27a, emissiveIntensity: 0.9 }));
  bulb.position.y = 30; g.add(bulb);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 8, 24), mat(FILAMENT.black)); socket.position.y = 60; g.add(socket);
  return g;
}

export function helmet(color = FILAMENT.grey) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.35, metalness: 0.25 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(32, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.62), m);
  dome.position.y = 20; g.add(dome);
  const back = new THREE.Mesh(new THREE.SphereGeometry(32, 48, 32, Math.PI * 0.75, Math.PI * 1.5, Math.PI * 0.62, Math.PI * 0.25), m);
  back.position.y = 20; g.add(back);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(31.2, 48, 24, -Math.PI * 0.22, Math.PI * 0.44, Math.PI * 0.42, Math.PI * 0.22),
    mat(0x202a3a, { roughness: 0.1, metalness: 0.6 }));
  visor.position.y = 20; g.add(visor);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(31.5, 48, 24, -Math.PI * 0.3, Math.PI * 0.6, Math.PI * 0.64, Math.PI * 0.22), m);
  jaw.position.y = 20; g.add(jaw);
  const crest = new THREE.Mesh(new THREE.BoxGeometry(44, 4, 3), mat(FILAMENT.red, { roughness: 0.4 }));
  crest.position.set(-2, 52, 0); g.add(crest);
  return g;
}

export function knob(color = FILAMENT.red) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(22, 24, 16, 48), m); body.position.y = 8; g.add(body);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(3, 16, 3), m);
    ridge.position.set(Math.cos(a) * 23.5, 8, Math.sin(a) * 23.5); ridge.rotation.y = -a; g.add(ridge);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(19, 22, 5, 48), m); cap.position.y = 18.5; g.add(cap);
  const pointer = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 3), mat(FILAMENT.white)); pointer.position.set(10, 21.5, 0); g.add(pointer);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 2, 6), mat(0x8a8f99, { metalness: 0.8, roughness: 0.3 })); nut.position.y = 21.5; g.add(nut);
  const knob2 = new THREE.Mesh(new THREE.CylinderGeometry(12, 13, 12, 10), mat(FILAMENT.black)); knob2.position.set(44, 6, -18); g.add(knob2);
  return g;
}

export function fidgetKnot(color = FILAMENT.pink) {
  const g = new THREE.Group();
  const geo = new THREE.TorusKnotGeometry(20, 6, 220, 24, 2, 3);
  const mesh = new THREE.Mesh(geo, mat(color, { roughness: 0.4 }));
  mesh.position.y = 28; mesh.rotation.x = 0.4; g.add(mesh);
  return g;
}

export function keychain(color = FILAMENT.yellow) {
  const g = new THREE.Group();
  const tag = roundedRect(60, 26, 8);
  tag.holes.push(circlePath(-22, 0, 4));
  const mesh = new THREE.Mesh(extrudeUp(tag, 3, 0.5), mat(color, { roughness: 0.5 }));
  mesh.rotation.y = 0.3; g.add(mesh);
  const text = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 10), mat(FILAMENT.black)); text.position.set(6, 3.6, 0); text.rotation.y = 0.3; g.add(text);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 1.2, 10, 40), mat(0xb0b4bb, { metalness: 0.85, roughness: 0.25 }));
  ring.position.set(-30, 1.5, 9); ring.rotation.x = Math.PI / 2; ring.rotation.z = 0.3; g.add(ring);
  const tag2 = new THREE.Mesh(extrudeUp(roundedRect(50, 22, 7), 3, 0.5), mat(FILAMENT.teal));
  tag2.position.set(18, 0, 30); tag2.rotation.y = -0.5; g.add(tag2);
  return g;
}

export function miniature(color = 0xb9bcc4) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(16, 17, 3, 48), mat(0x3b3f47)); base.position.y = 1.5; g.add(base);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(6, 14, 6, 16), m); body.position.y = 17; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(4.5, 20, 14), m); head.position.y = 31; g.add(head);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), m); helm.position.y = 31.5; g.add(helm);
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 1.2, 24), m); shield.position.set(-8, 17, 3); shield.rotation.z = Math.PI / 2; shield.rotation.y = 0.5; g.add(shield);
  const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 42, 8), m); spear.position.set(8, 23, 0); g.add(spear);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(1.8, 6, 8), m); tip.position.set(8, 47, 0); g.add(tip);
  const cape = new THREE.Mesh(new THREE.ConeGeometry(9, 22, 16, 1, true, Math.PI * 0.5, Math.PI), mat(color, { side: THREE.DoubleSide }));
  cape.position.set(0, 17, -2); g.add(cape);
  return g;
}

export function piCase(color = FILAMENT.black) {
  const g = new THREE.Group();
  const body = roundedRect(92, 62, 5);
  body.holes.push(roundedRectPath(0, 0, 88, 58, 4));
  g.add(new THREE.Mesh(extrudeUp(body, 24, 0.6), mat(color, { roughness: 0.65 })));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(92, 1.5, 62), mat(color)); floor.position.y = 0.75; g.add(floor);
  const lid = roundedRect(92, 62, 5);
  for (let i = 0; i < 9; i++) lid.holes.push(roundedRectPath(0, (i - 4) * 5, 50, 2.2, 1));
  const lidMesh = new THREE.Mesh(extrudeUp(lid, 2.5, 0.4), mat(FILAMENT.teal, { roughness: 0.6 })); lidMesh.position.y = 24; g.add(lidMesh);
  // ports
  [[-46.5, 7, 12], [-46.5, 7, -8]].forEach(p => { const port = new THREE.Mesh(new THREE.BoxGeometry(2, 10, 14), mat(0x8a8f99, { metalness: 0.7 })); port.position.set(...p); g.add(port); });
  const led = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), mat(0x6cf08a, { emissive: 0x33ff66, emissiveIntensity: 1 })); led.position.set(36, 27, 24); g.add(led);
  return g;
}

export function spoolHolder(color = FILAMENT.grey) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(extrudeUp(roundedRect(110, 60, 6), 5, 0.6), mat(color)); g.add(base);
  const m = mat(color, { roughness: 0.6 });
  [-30, 30].forEach(x => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(8, 48, 30), m); arm.position.set(x, 29, 0); g.add(arm);
  });
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 76, 32), mat(0x9aa0a8, { metalness: 0.6, roughness: 0.3 }));
  axle.rotation.z = Math.PI / 2; axle.position.y = 48; g.add(axle);
  const spoolMat = mat(FILAMENT.orange, { roughness: 0.6 });
  const spool = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 40, 48), spoolMat); spool.rotation.z = Math.PI / 2; spool.position.y = 48; g.add(spool);
  [-21, 21].forEach(x => { const flange = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 2, 48), mat(0x1b1d22)); flange.rotation.z = Math.PI / 2; flange.position.set(x, 48, 0); g.add(flange); });
  return g;
}

export function wallHook(color = FILAMENT.green) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(6, 0); s.lineTo(6, 36); s.lineTo(30, 36); s.quadraticCurveTo(44, 36, 44, 50);
  s.lineTo(44, 60); s.lineTo(38, 60); s.lineTo(38, 50); s.quadraticCurveTo(38, 42, 30, 42); s.lineTo(0, 42);
  s.closePath();
  s.holes.push(circlePath(3, 10, 2), circlePath(3, 30, 2));
  const geo = new THREE.ExtrudeGeometry(s, { depth: 24, bevelEnabled: true, bevelSize: 0.8, bevelThickness: 0.8, bevelSegments: 2 });
  geo.translate(-20, 0, -12);
  g.add(new THREE.Mesh(geo, mat(color, { roughness: 0.5 })));
  const hook2 = new THREE.Mesh(geo.clone(), mat(FILAMENT.cream)); hook2.position.set(48, 0, 8); hook2.scale.set(0.7, 0.7, 0.7); g.add(hook2);
  return g;
}

export function dice(color = FILAMENT.purple) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.25, metalness: 0.1, flatShading: true });
  const d20 = new THREE.Mesh(new THREE.IcosahedronGeometry(22, 0), m); d20.position.set(-8, 22, 0); d20.rotation.set(0.3, 0.5, 0.1); g.add(d20);
  const d12 = new THREE.Mesh(new THREE.DodecahedronGeometry(15, 0), mat(FILAMENT.teal, { roughness: 0.25, flatShading: true })); d12.position.set(30, 15, 16); d12.rotation.set(0.6, 0.2, 0.3); g.add(d12);
  const d6 = new THREE.Mesh(new THREE.BoxGeometry(18, 18, 18), mat(FILAMENT.orange, { roughness: 0.3 })); d6.position.set(24, 9, -24); d6.rotation.y = 0.5; g.add(d6);
  const d8 = new THREE.Mesh(new THREE.OctahedronGeometry(12, 0), mat(FILAMENT.cream, { roughness: 0.3, flatShading: true })); d8.position.set(-40, 12, 20); d8.rotation.set(0.2, 0.9, 0.1); g.add(d8);
  return g;
}

export function headphoneStand(color = FILAMENT.black) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.7 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(34, 36, 4, 48), m); base.position.y = 2; g.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 70, 32), m); post.position.y = 39; g.add(post);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(26, 7, 16, 48, Math.PI), m); arc.position.y = 74; arc.rotation.z = 0; g.add(arc);
  // headphones
  const hm = mat(0x3a3f4a, { roughness: 0.5 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(34, 3.5, 16, 48, Math.PI), hm); band.position.y = 76; g.add(band);
  [-34, 34].forEach(x => { const cup = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 10, 32), hm); cup.rotation.z = Math.PI / 2; cup.position.set(x, 62, 0); g.add(cup); });
  [-40, 40].forEach(x => { const pad = new THREE.Mesh(new THREE.TorusGeometry(11, 4, 12, 32), mat(FILAMENT.orange)); pad.rotation.y = Math.PI / 2; pad.position.set(x, 62, 0); g.add(pad); });
  return g;
}

export function cableClip(color = FILAMENT.lime) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const clip = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(22, 3, 14), m); base.position.y = 1.5; clip.add(base);
    const c = new THREE.Mesh(new THREE.TorusGeometry(7, 2.2, 12, 32, Math.PI * 1.55), m); c.position.y = 9; c.rotation.y = Math.PI / 2; c.rotation.x = Math.PI * 0.72; clip.add(c);
    clip.position.set(-30 + i * 30, 0, (i - 1) * -10); clip.rotation.y = i * 0.3;
    g.add(clip);
  }
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-70, 9, 20), new THREE.Vector3(-30, 9, 10), new THREE.Vector3(0, 9, 0), new THREE.Vector3(30, 9, -10), new THREE.Vector3(70, 9, -20)]), 32, 2.6, 10, false),
    mat(0x1f2228, { roughness: 0.4 }));
  g.add(cable);
  return g;
}

export const MODELS = [
  { id: 'gridfinity-baseplate', build: gridfinityBaseplate, cam: [1.0, 0.95, 1.1], zoom: 1.3 },
  { id: 'benchy', build: benchy, cam: [1.2, 0.7, 1.0], zoom: 1.2 },
  { id: 'ripple-vase', build: rippleVase, cam: [1.0, 0.55, 1.2], zoom: 1.0 },
  { id: 'phone-stand', build: phoneStand, cam: [1.2, 0.6, 1.0], zoom: 1.0 },
  { id: 'gears', build: gears, cam: [0.6, 1.1, 1.0], zoom: 1.15 },
  { id: 'hex-bit-holder', build: hexBitHolder, cam: [1.0, 0.9, 1.1], zoom: 1.15 },
  { id: 'planter', build: planter, cam: [1.0, 0.6, 1.2], zoom: 1.0 },
  { id: 'articulated-snake', build: articulatedSnake, cam: [0.5, 1.0, 1.1], zoom: 1.5 },
  { id: 'storage-box', build: storageBox, cam: [1.0, 0.8, 1.2], zoom: 1.0 },
  { id: 'lamp-shade', build: lampShade, cam: [1.0, 0.5, 1.2], zoom: 1.0 },
  { id: 'helmet', build: helmet, cam: [0.45, 0.35, 1.2], zoom: 1.15 },
  { id: 'knob', build: knob, cam: [1.0, 0.9, 1.1], zoom: 1.0 },
  { id: 'fidget-knot', build: fidgetKnot, cam: [1.0, 0.6, 1.2], zoom: 1.0 },
  { id: 'keychain', build: keychain, cam: [0.6, 1.1, 1.0], zoom: 1.2 },
  { id: 'miniature', build: miniature, cam: [1.0, 0.5, 1.3], zoom: 1.0 },
  { id: 'pi-case', build: piCase, cam: [1.0, 0.9, 1.1], zoom: 1.1 },
  { id: 'spool-holder', build: spoolHolder, cam: [1.0, 0.6, 1.2], zoom: 1.1 },
  { id: 'wall-hook', build: wallHook, cam: [1.1, 0.6, 1.1], zoom: 1.15 },
  { id: 'dice', build: dice, cam: [1.0, 0.8, 1.2], zoom: 1.0 },
  { id: 'headphone-stand', build: headphoneStand, cam: [1.0, 0.5, 1.3], zoom: 1.0 },
  { id: 'cable-clip', build: cableClip, cam: [0.8, 1.0, 1.1], zoom: 1.5 },
];
