<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  FACES,
  captureView,
  faceletPosition,
  moveRotation,
  type Face,
  type Sticker,
} from '../lib/cube';
import { usePalette } from '../lib/usePalette';
const { colors: COLORS } = usePalette();
const props = defineProps<{
  state: string;
  nextMove?: string;
  selectedFace?: Face;
  selectable?: boolean;
}>();
const emit = defineEmits<{ selectFace: [face: Face] }>();
const host = ref<HTMLDivElement>();
const error = ref('');
let renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls;
let observer: ResizeObserver,
  frame = 0,
  cubeGroup = new THREE.Group(),
  arrowGroup = new THREE.Group();
let floor: THREE.Mesh | undefined;
let pointer: { id: number; x: number; y: number; moved: boolean } | null = null;
const raycaster = new THREE.Raycaster();
const selection = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints(
    [
      [-1.51, -1.51],
      [1.51, -1.51],
      [1.51, 1.51],
      [-1.51, 1.51],
    ].map(([x, y]) => new THREE.Vector3(x, y, 0)),
  ),
  new THREE.LineBasicMaterial({ color: '#ef7853' }),
);
selection.visible = false;
let animating = false,
  disposed = false,
  needsRender = true;
let animation: {
  start: number;
  duration: number;
  pivot: THREE.Group;
  axis: 'x' | 'y' | 'z';
  angle: number;
  done: () => void;
} | null = null;
const bodyGeometry = new RoundedBoxGeometry(0.968, 0.968, 0.968, 3, 0.075);
const stickerGeometry = new RoundedBoxGeometry(0.806, 0.806, 0.032, 3, 0.065);
const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#222832', roughness: 0.43 });
const materials = Object.fromEntries(
  Object.entries(COLORS.value).map(([key, value]) => [
    key,
    new THREE.MeshStandardMaterial({ color: value, roughness: 0.31, metalness: 0.02 }),
  ]),
) as Record<Sticker, THREE.MeshStandardMaterial>;
const unknownCanvas = document.createElement('canvas');
unknownCanvas.width = unknownCanvas.height = 128;
const unknownContext = unknownCanvas.getContext('2d')!;
unknownContext.fillStyle = '#ffffff';
unknownContext.fillRect(0, 0, 128, 128);
unknownContext.fillStyle = '#6b7789';
unknownContext.font = '600 76px sans-serif';
unknownContext.textAlign = 'center';
unknownContext.textBaseline = 'middle';
unknownContext.fillText('?', 64, 69);
const unknownTexture = new THREE.CanvasTexture(unknownCanvas);
unknownTexture.colorSpace = THREE.SRGBColorSpace;
materials['?'].map = unknownTexture;
watch(COLORS, (colors) => {
  for (const sticker of Object.keys(colors) as Sticker[])
    materials[sticker].color.set(colors[sticker]);
  needsRender = true;
});
const normals: Record<Face, THREE.Vector3> = {
  U: new THREE.Vector3(0, 1, 0),
  R: new THREE.Vector3(1, 0, 0),
  F: new THREE.Vector3(0, 0, 1),
  D: new THREE.Vector3(0, -1, 0),
  L: new THREE.Vector3(-1, 0, 0),
  B: new THREE.Vector3(0, 0, -1),
};
function build(state: string) {
  needsRender = true;
  cubeGroup.clear();
  const cubies = new Map<string, THREE.Group>();
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        if (!x && !y && !z) continue;
        const group = new THREE.Group();
        group.position.set(x, y, z);
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        cubeGroup.add(group);
        cubies.set(`${x},${y},${z}`, group);
      }
  FACES.forEach((face, f) => {
    for (let i = 0; i < 9; i++) {
      const sticker = new THREE.Mesh(
        stickerGeometry,
        materials[(state[f * 9 + i] || '?') as Sticker],
      );
      sticker.position.copy(normals[face]).multiplyScalar(0.484);
      sticker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normals[face]);
      sticker.castShadow = true;
      sticker.userData.face = face;
      cubies.get(faceletPosition(face, i).join(','))!.add(sticker);
    }
  });
}
function updateSelection() {
  selection.visible = !!props.selectedFace && !animating;
  if (props.selectedFace) {
    selection.position.copy(normals[props.selectedFace]).multiplyScalar(1.52);
    selection.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normals[props.selectedFace],
    );
  }
  if (floor) floor.visible = !props.selectedFace;
  needsRender = true;
}
function pointerDown(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0) {
    pointer = null;
    return;
  }
  pointer =
    props.selectable && !animating
      ? { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
      : null;
}
function pointerMove(event: PointerEvent) {
  if (
    pointer &&
    pointer.id === event.pointerId &&
    Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6
  )
    pointer.moved = true;
}
function pointerCancel() {
  pointer = null;
}
function pointerUp(event: PointerEvent) {
  const start = pointer;
  pointer = null;
  if (
    !start ||
    start.id !== event.pointerId ||
    start.moved ||
    !props.selectable ||
    animating ||
    Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6
  )
    return;
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  camera.updateMatrixWorld();
  cubeGroup.updateMatrixWorld(true);
  raycaster.setFromCamera(
    new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    ),
    camera,
  );
  // The nearest surface must be a sticker; gaps must not select a hidden face.
  const hit = raycaster.intersectObjects(cubeGroup.children, true)[0];
  const face = hit?.object.userData.face as Face | undefined;
  if (face && FACES.includes(face)) emit('selectFace', face);
}
function clearArrow() {
  needsRender = true;
  arrowGroup.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
  arrowGroup.clear();
}
function showArrow(move?: string) {
  clearArrow();
  if (!move || animating) return;
  const { axis, layer, angle } = moveRotation(move);
  const points: THREE.Vector3[] = [];
  const direction = Math.sign(angle);
  // A short arc outside the turning layer, transformed from the XY plane.
  const normal = new THREE.Vector3();
  normal[axis] = 1;
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  for (let i = 0; i <= 36; i++) {
    const a = 0.25 + ((direction * i) / 36) * 1.6;
    points.push(
      new THREE.Vector3(Math.cos(a) * 1.92, Math.sin(a) * 1.92, layer * 1.08).applyQuaternion(
        rotation,
      ),
    );
  }
  const material = new THREE.MeshBasicMaterial({
    color: '#ef7853',
    depthTest: false,
    transparent: true,
    opacity: 0.85,
  });
  const curve = new THREE.CatmullRomCurve3(points);
  const arc = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.027, 6, false), material);
  arc.renderOrder = 10;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.25, 12), material.clone());
  tip.position.copy(points.at(-1)!);
  tip.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    points.at(-1)!.clone().sub(points.at(-2)!).normalize(),
  );
  tip.renderOrder = 10;
  arrowGroup.add(arc, tip);
}
function configureControls() {
  // OrbitControls caches the camera's up axis, so recreate it when the scan orientation changes.
  controls?.dispose();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 17;
  controls.addEventListener('change', () => {
    needsRender = true;
  });
  controls.update();
  needsRender = true;
}
function resetView() {
  if (!camera || animating) return;
  camera.position.set(6.2, 4.6, 7.2);
  camera.up.set(0, 1, 0);
  configureControls();
}
function focusFace(face: Face) {
  if (!camera || animating || !FACES.includes(face)) return;
  const view = captureView(face);
  camera.position.set(...view.position);
  camera.up.set(...view.up);
  configureControls();
}
function turn(move: string, nextState: string, duration = 700): Promise<void> {
  if (!renderer || disposed) return Promise.resolve();
  if (animating) return Promise.reject(new Error('动画尚未完成。'));
  animating = true;
  updateSelection();
  clearArrow();
  const { axis, layer, angle } = moveRotation(move);
  const pivot = new THREE.Group();
  cubeGroup.add(pivot);
  cubeGroup.updateMatrixWorld(true);
  [...cubeGroup.children]
    .filter((c) => c !== pivot && Math.round(c.position[axis]) === layer)
    .forEach((c) => pivot.attach(c));
  return new Promise((resolve) => {
    animation = {
      start: performance.now(),
      duration,
      pivot,
      axis,
      angle,
      done: () => {
        animating = false;
        updateSelection();
        build(nextState);
        showArrow(props.nextMove);
        resolve();
      },
    };
  });
}
watch(
  () => props.state,
  (state) => {
    if (renderer && !animating) build(state);
  },
);
watch(
  () => props.nextMove,
  (move) => {
    if (renderer) showArrow(move);
  },
);
watch(() => props.selectedFace, updateSelection);
onMounted(() => {
  try {
    scene = new THREE.Scene();
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', '可拖动旋转的三阶魔方 3D 视图');
    host.value!.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerCancel);
    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    resetView();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x929daf, 2.8));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(-3, 8, 6);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.normalBias = 0.025;
    Object.assign(light.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
    scene.add(light);
    const fill = new THREE.DirectionalLight(0xffffff, 1.2);
    fill.position.set(5, 2, -3);
    scene.add(fill);
    floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.13 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.62;
    floor.receiveShadow = true;
    scene.add(floor);
    scene.add(cubeGroup, arrowGroup, selection);
    updateSelection();
    build(props.state);
    showArrow(props.nextMove);
    observer = new ResizeObserver(() => {
      if (!host.value) return;
      const { width, height } = host.value.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      needsRender = true;
    });
    observer.observe(host.value!);
    const tick = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(tick);
      if (animation) {
        needsRender = true;
        const t = Math.min(1, (now - animation.start) / animation.duration);
        animation.pivot.rotation[animation.axis] = animation.angle * (t * t * (3 - 2 * t));
        if (t === 1) {
          const done = animation.done;
          animation = null;
          done();
        }
      }
      controls.update();
      if (needsRender) {
        renderer.render(scene, camera);
        needsRender = false;
      }
    };
    frame = requestAnimationFrame(tick);
  } catch {
    error.value = '无法启用 3D 视图，请使用支持 WebGL 2 的浏览器并开启硬件加速。';
  }
});
onBeforeUnmount(() => {
  disposed = true;
  cancelAnimationFrame(frame);
  observer?.disconnect();
  controls?.dispose();
  renderer?.domElement.removeEventListener('pointerdown', pointerDown);
  renderer?.domElement.removeEventListener('pointermove', pointerMove);
  renderer?.domElement.removeEventListener('pointerup', pointerUp);
  renderer?.domElement.removeEventListener('pointercancel', pointerCancel);
  if (animation) {
    animation.done();
    animation = null;
  }
  clearArrow();
  bodyGeometry.dispose();
  stickerGeometry.dispose();
  bodyMaterial.dispose();
  unknownTexture.dispose();
  selection.geometry.dispose();
  selection.material.dispose();
  Object.values(materials).forEach((m) => m.dispose());
  scene?.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      ![bodyGeometry, stickerGeometry].includes(object.geometry as RoundedBoxGeometry)
    ) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  });
  renderer?.dispose();
});
defineExpose({ turn, resetView, focusFace });
</script>
<template>
  <div ref="host" class="cube-scene">
    <div v-if="error" class="scene-error">{{ error }}</div>
  </div>
</template>
