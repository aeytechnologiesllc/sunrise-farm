import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { Engine } from './engine/Engine'

// Boot scene: proves the pipeline (renderer, camera, light, shadows, loop)
// while the design lands. The real farm replaces this wholesale.

const renderer = new WebGLRenderer({ antialias: true })
renderer.toneMapping = ACESFilmicToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFSoftShadowMap
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

const scene = new Scene()
scene.background = new Color('#aee2f7')
scene.fog = new Fog('#aee2f7', 60, 140)

const camera = new PerspectiveCamera(35, innerWidth / innerHeight, 0.5, 300)
camera.position.set(16, 18, 16)
camera.lookAt(0, 0, 0)

const sun = new DirectionalLight('#fff4d6', 2.6)
sun.position.set(14, 24, 8)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
const cam = sun.shadow.camera
cam.left = cam.bottom = -30
cam.right = cam.top = 30
scene.add(sun, new AmbientLight('#cfe8ff', 0.9))

// the meadow
const ground = new Mesh(
  new PlaneGeometry(200, 200),
  new MeshStandardMaterial({ color: '#87b86a', roughness: 1 }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// placeholder barn — the first thing the player will ever see
const barn = new Mesh(new BoxGeometry(5, 3.4, 4), new MeshStandardMaterial({ color: '#c8553d' }))
barn.position.set(-4, 1.7, -3)
barn.castShadow = true
const roof = new Mesh(new ConeGeometry(3.9, 2.2, 4), new MeshStandardMaterial({ color: '#8a3a2a' }))
roof.position.set(-4, 4.5, -3)
roof.rotation.y = Math.PI / 4
roof.castShadow = true
const silo = new Mesh(
  new CylinderGeometry(1.1, 1.1, 5, 12),
  new MeshStandardMaterial({ color: '#e8e3d8' }),
)
silo.position.set(0.5, 2.5, -4.5)
silo.castShadow = true
scene.add(barn, roof, silo)

const engine = new Engine(() => renderer.render(scene, camera))
engine.onFrame((dt) => {
  // gentle idle drift so the boot scene is visibly alive
  const t = engine.uTime.value
  camera.position.x = 16 + Math.sin(t * 0.1) * 0.6
  camera.lookAt(new Vector3(0, 0.5, 0))
  void dt
})

function resize(): void {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
}
addEventListener('resize', resize)
resize()
engine.start()
