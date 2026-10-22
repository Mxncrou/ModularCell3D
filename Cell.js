const CELL_SIZE = 1.5;
const CELL_HEIGHT = 0.75;
const HALF_SIZE = CELL_SIZE / 2;
const GRID = 0.75;

const LOCAL_NODES = [];

for (let k = 0; k < 4; k++) {
  const angle = k * Math.PI / 2;
  LOCAL_NODES.push([
    HALF_SIZE + HALF_SIZE * Math.cos(angle),
    HALF_SIZE + HALF_SIZE * Math.sin(angle),
    0,
  ]);
}

for (let k = 0; k < 4; k++) {
  const angle = Math.PI / 4 + k * Math.PI / 2;
  const radius = HALF_SIZE * Math.SQRT2;
  LOCAL_NODES.push([
    HALF_SIZE + radius * Math.cos(angle),
    HALF_SIZE + radius * Math.sin(angle),
    CELL_HEIGHT,
  ]);
}

// Index of the top-ring node sitting at the given angle, in degrees.
function topNodeAt(degrees) {
  const normalized = (((degrees - 45) % 360) + 360) % 360;
  return 4 + Math.round(normalized / 90);
}

// Each strut links a bottom node to the opposite top corner.
const STRUTS = [0, 1, 2, 3].map(k => [k, topNodeAt(90 * k + 225)]);

// Cables: bottom ring, top ring, and one diagonal from each bottom node.
const CABLES = [0, 1, 2, 3].flatMap(k => [
  [k, (k + 1) % 4],
  [4 + k, 4 + (k + 1) % 4],
  [k, topNodeAt(90 * k + 315)],
]);

// ---------------------------------------------------------------------------
// Orientations
// ---------------------------------------------------------------------------

const ORIENTATIONS = [
  // Flat: square ring on the ground, diamond ring on top.
  { name: 'flat',          size: [1.5, 0.75, 1.5], map: ([x, y, z]) => [x, CELL_HEIGHT - z, y] },
  { name: 'wall facing x', size: [0.75, 1.5, 1.5], map: ([x, y, z]) => [z, x, y] },
  { name: 'wall facing z', size: [1.5, 1.5, 0.75], map: ([x, y, z]) => [x, y, z] },
];

// Flipping turns the cell over (180° about its local x axis): square and diamond faces swap sides.
function cellPoints(cell) {
  const orientation = ORIENTATIONS[cell.orientation];
  return LOCAL_NODES.map(([x, y, z]) => {
    const local = cell.flipped ? [x, CELL_SIZE - y, CELL_HEIGHT - z] : [x, y, z];
    return new THREE.Vector3(...orientation.map(local));
  });
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const canvas = document.getElementById('view');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
camera.position.set(4.2, 3.6, 5.2);

const controls = new THREE.OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.4, 0);
controls.maxPolarAngle = Math.PI / 2 - 0.05;

scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 0.95));

const sun = new THREE.DirectionalLight(0xffffff, 0.55);
sun.position.set(4, 8, 6);
scene.add(sun);

const grid = new THREE.GridHelper(12, 16);
grid.material.vertexColors = false;
scene.add(grid);

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const strutMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 });
const hubMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 });
const jointMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 });
const cableMaterial = new THREE.LineBasicMaterial();
const outlineMaterial = new THREE.LineBasicMaterial();
const invalidMaterial = new THREE.LineBasicMaterial();
const pickMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

const strutGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 12);
const hubGeometry = new THREE.SphereGeometry(0.05, 14, 10);
const jointGeometry = new THREE.SphereGeometry(0.075, 14, 10);
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

const cells = [];
let selected = null;

function buildCell(cell) {
  const group = cell.group;
  while (group.children.length) {
    group.remove(group.children[0]);
  }

  const points = cellPoints(cell);
  const size = ORIENTATIONS[cell.orientation].size;

  for (const [a, b] of STRUTS) {
    const direction = points[b].clone().sub(points[a]);
    const strut = new THREE.Mesh(strutGeometry, strutMaterial);
    strut.position.copy(points[a]).add(points[b]).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
    strut.scale.y = direction.length();
    group.add(strut);
  }

  const cablePoints = [];
  for (const [a, b] of CABLES) {
    cablePoints.push(points[a], points[b]);
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cablePoints), cableMaterial));

  cell.hubs = points.map(point => {
    const hub = new THREE.Mesh(hubGeometry, hubMaterial);
    hub.position.copy(point);
    group.add(hub);
    return hub;
  });

  // Invisible box used for picking and as a face to snap other cells against.
  const box = new THREE.BoxGeometry(...size);
  cell.pick = new THREE.Mesh(box, pickMaterial);
  cell.pick.position.set(size[0] / 2, size[1] / 2, size[2] / 2);
  cell.pick.userData.cell = cell;
  group.add(cell.pick);

  cell.outline = new THREE.LineSegments(new THREE.EdgesGeometry(box), outlineMaterial);
  cell.outline.position.copy(cell.pick.position);
  cell.outline.visible = cell === selected;
  group.add(cell.outline);
}

function addCell(corner, orientation = 0, flipped = false) {
  const cell = { corner: corner.clone(), orientation, flipped, group: new THREE.Group(), bornAt: performance.now() };
  buildCell(cell);
  scene.add(cell.group);
  cells.push(cell);
  return cell;
}

function removeCell(cell) {
  scene.remove(cell.group);
  cells.splice(cells.indexOf(cell), 1);
}

function boxOf(cell, corner = cell.corner) {
  const size = ORIENTATIONS[cell.orientation].size;
  return { min: corner, max: corner.clone().add(new THREE.Vector3(...size)) };
}

// True if `cell`, placed at `corner`, would intersect another cell.
function overlaps(cell, corner = cell.corner) {
  const a = boxOf(cell, corner);
  const eps = 1e-6;
  return cells.some(other => {
    if (other === cell) {
      return false;
    }
    const b = boxOf(other);
    return ['x', 'y', 'z'].every(k => a.min[k] < b.max[k] - eps && b.min[k] < a.max[k] - eps);
  });
}

// Highlight hubs that coincide with a hub of another cell.
function updateJoints() {
  const key = p => [p.x, p.y, p.z].map(v => Math.round(v * 1000)).join(',');
  const counts = new Map();
  const worldHubs = cells.map(cell => cellPoints(cell).map(p => key(p.add(cell.corner))));

  for (const keys of worldHubs) {
    for (const k of keys) {
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }

  cells.forEach((cell, i) => {
    worldHubs[i].forEach((k, h) => {
      const joined = counts.get(k) > 1;
      cell.hubs[h].material = joined ? jointMaterial : hubMaterial;
      cell.hubs[h].geometry = joined ? jointGeometry : hubGeometry;
    });
  });

  const shared = [...counts.values()].filter(n => n > 1).length;
  const cellText = cells.length === 1 ? '1 cell' : `${cells.length} cells`;
  label.value = `${cellText} · ${shared} shared hub${shared === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Selection and toolbar
// ---------------------------------------------------------------------------

const label = document.getElementById('label');
const addButton = document.getElementById('add');
const rotateButton = document.getElementById('rotate');
const flipButton = document.getElementById('flip');
const deleteButton = document.getElementById('delete');

function select(cell) {
  selected = cell;
  for (const c of cells) {
    c.outline.visible = c === selected;
    c.outline.material = outlineMaterial;
  }
  for (const button of [rotateButton, flipButton, deleteButton]) {
    button.disabled = !selected;
  }
}

// Lift a cell until it no longer overlaps anything (used after a rotation).
function liftUntilFree(cell) {
  while (overlaps(cell)) {
    cell.corner.y += GRID;
  }
}

// First free flat spot on the ground, spiralling out from the centre.
function freeSpot() {
  const probe = { orientation: 0 };
  for (let ring = 0; ring < 10; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) {
          continue;
        }
        const corner = new THREE.Vector3(i * CELL_SIZE - HALF_SIZE, 0, j * CELL_SIZE - HALF_SIZE);
        if (!overlaps(probe, corner)) {
          return corner;
        }
      }
    }
  }
  return new THREE.Vector3(-HALF_SIZE, 0, -HALF_SIZE);
}

function addAction() {
  select(addCell(freeSpot()));
  updateJoints();
}

function rotateAction() {
  if (!selected) return;
  selected.orientation = (selected.orientation + 1) % ORIENTATIONS.length;
  liftUntilFree(selected);
  buildCell(selected);
  updateJoints();
}

function flipAction() {
  if (!selected) return;
  selected.flipped = !selected.flipped;
  buildCell(selected);
  updateJoints();
}

function deleteAction() {
  if (!selected) return;
  removeCell(selected);
  select(null);
  updateJoints();
}

addButton.addEventListener('click', addAction);
rotateButton.addEventListener('click', rotateAction);
flipButton.addEventListener('click', flipAction);
deleteButton.addEventListener('click', deleteAction);

addEventListener('keydown', event => {
  if (event.target.closest && event.target.closest('input, textarea')) return;
  const key = event.key.toLowerCase();
  if (key === 'r') rotateAction();
  else if (key === 'f') flipAction();
  else if (key === 'a') addAction();
  else if (key === 'delete' || key === 'backspace') deleteAction();
  else if (key === 'escape') select(null);
});

// ---------------------------------------------------------------------------
// Dragging
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let drag = null;

function setRay(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
}

const snap = (value, size) => Math.round((value - size / 2) / GRID) * GRID;

function candidateCorner(cell, event) {
  setRay(event);
  const size = ORIENTATIONS[cell.orientation].size;
  const others = cells.filter(c => c !== cell).map(c => c.pick);
  const hit = raycaster.intersectObjects(others)[0];

  if (hit) {
    const other = hit.object.userData.cell;
    const otherBox = boxOf(other);
    const corner = [0, 1, 2].map(k => snap(hit.point.getComponent(k), size[k]));

    // Along the face normal, sit flush against the other cell's box.
    [0, 1, 2].forEach(k => {
      const n = hit.face.normal.getComponent(k);
      if (n > 0.5) corner[k] = otherBox.max.getComponent(k);
      if (n < -0.5) corner[k] = otherBox.min.getComponent(k) - size[k];
    });

    corner[1] = Math.max(0, corner[1]);
    return new THREE.Vector3(...corner);
  }

  const point = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(GROUND, point)) {
    return new THREE.Vector3(snap(point.x, size[0]), 0, snap(point.z, size[2]));
  }
  return null;
}

// Capture phase, so this runs before OrbitControls and can stop it from orbiting.
addEventListener('pointerdown', event => {
  if (event.target !== canvas || event.button !== 0) return;

  setRay(event);
  const hit = raycaster.intersectObjects(cells.map(c => c.pick))[0];
  if (!hit) {
    select(null);
    return;
  }

  const cell = hit.object.userData.cell;
  select(cell);
  controls.enabled = false;
  drag = { cell, start: cell.corner.clone(), valid: true };
}, { capture: true });

addEventListener('pointermove', event => {
  if (!drag) return;
  const corner = candidateCorner(drag.cell, event);
  if (!corner) return;

  drag.valid = !overlaps(drag.cell, corner);
  drag.cell.corner.copy(corner);
  drag.cell.outline.material = drag.valid ? outlineMaterial : invalidMaterial;
});

function endDrag() {
  if (!drag) return;
  if (!drag.valid) {
    drag.cell.corner.copy(drag.start);
  }
  drag.cell.outline.material = outlineMaterial;
  drag = null;
  controls.enabled = true;
  updateJoints();
}

addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------------------
// Theme, resizing and render loop
// ---------------------------------------------------------------------------

function applyTheme() {
  scene.background = new THREE.Color(cssVar('--bg'));
  strutMaterial.color.set(cssVar('--strut'));
  hubMaterial.color.set(cssVar('--hub'));
  jointMaterial.color.set(cssVar('--joint'));
  cableMaterial.color.set(cssVar('--cable'));
  outlineMaterial.color.set(cssVar('--accent'));
  invalidMaterial.color.set(cssVar('--invalid'));
  grid.material.color.set(cssVar('--rule'));
}

function resize() {
  const width = innerWidth;
  const height = innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

addEventListener('resize', resize);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

applyTheme();
resize();
addAction();

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DROP_DURATION = 350;
const DROP_HEIGHT = 1.2;

function renderLoop(now = 0) {
  // New cells drop into place (ease-out); every cell otherwise sits at its corner.
  for (const cell of cells) {
    const t = reduceMotion ? 1 : Math.min(1, (now - cell.bornAt) / DROP_DURATION);
    cell.group.position.copy(cell.corner);
    cell.group.position.y += (1 - t) * (1 - t) * DROP_HEIGHT;
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}

renderLoop();
