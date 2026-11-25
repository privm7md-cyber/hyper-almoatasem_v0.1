// The R3F scene — loaded ONLY after a successful WebGL probe (see
// admin-scene.tsx), ONLY on the admin dashboard, never on the CRUD pages.
//
// The scene is the "operations station" of the admin identity: a dark
// graphite room with a jade signal band on the horizon and a rack of thin
// vertical planes receding into depth. It is deliberately abstract — it says
// "the store is live", not "here is a supermarket".
//
// Resource lifecycle: every object is declared declaratively inside <Canvas>,
// so R3F disposes geometries/materials on unmount; listeners are removed in
// effect cleanups; the render loop pauses when the tab is hidden or the
// viewport scrolls away; WebGL context loss falls back to the CSS frame.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { backdropFragment, backdropVertex, dustFragment, dustVertex } from "./shaders";

// Token-derived palette (the admin identity — graphite + jade, never the
// storefront's purple/orange). three.js cannot read CSS vars directly.
// Direction B Executive Operations palette (deep violet-obsidian + royal purple + warm orange).
const DEEP = new THREE.Color("#221242"); // deep violet-plum upper field
const DEEP2 = new THREE.Color("#0e081c"); // obsidian plum floor
const GLOW = new THREE.Color("#ff8c33"); // warm orange horizon key
const PLANE = new THREE.Color("#2b1954"); // executive signal-plane body
const FLOOR = new THREE.Color("#130a26");
const DUST = new THREE.Color("#9e86d9");
const WARM = new THREE.Color("#c4b5fd");

const DUST_COUNT = 110;
const PLANE_PER_ROW = 16;

/** Deterministic pseudo-random (stable across renders — no hydration churn). */
function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Camera: one-time easeOut dolly, then a gentle pointer parallax. */
function CameraRig() {
  const { camera } = useThree();
  const intro = useRef(0);
  const target = useMemo(() => new THREE.Vector3(), []);
  const lookAt = useMemo(() => new THREE.Vector3(0, 1.4, -9), []);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    camera.lookAt(lookAt);
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [camera, lookAt]);

  useFrame((_, delta) => {
    intro.current = Math.min(1, intro.current + delta / 1.5);
    const e = 1 - Math.pow(1 - intro.current, 3);
    target.set(pointer.current.x * 0.3 * e, 2.3 - pointer.current.y * 0.16 * e, 6.2 - 1.1 * e);
    camera.position.lerp(target, 0.06);
  });
  return null;
}

/**
 * Uniform containers live at module scope: the viewport is a singleton per
 * page, the objects' identity is stable, and mutation happens only inside
 * useFrame callbacks.
 */
const backdropUniforms = {
  uTime: { value: 0 },
  uAspect: { value: 1 },
  uDeep: { value: DEEP },
  uDeep2: { value: DEEP2 },
  uGlow: { value: GLOW },
};

const dustUniforms = {
  uTime: { value: 0 },
  uColor: { value: DUST },
  uWarm: { value: WARM },
};

/** Background plane: the procedural graphite field with the jade horizon. */
function Backdrop() {
  const { size } = useThree();
  useFrame((state) => {
    backdropUniforms.uTime.value = state.clock.elapsedTime;
    backdropUniforms.uAspect.value = Math.max(1, size.width / Math.max(1, size.height));
  });
  return (
    <mesh position={[0, 2, -34]} scale={[110, 56, 1]} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        vertexShader={backdropVertex}
        fragmentShader={backdropFragment}
        uniforms={backdropUniforms}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * The rack: thin vertical planes in a receding grid, like the signal planes
 * of an operations wall. Depth comes from the perspective, not from clutter.
 */
function SignalPlanes() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = PLANE_PER_ROW * 3;
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let row = 0; row < 3; row++) {
      for (let n = 0; n < PLANE_PER_ROW; n++) {
        const depth = n + row * 0.5;
        const z = -2.2 - depth * 2.05;
        const spread = 3.1 + row * 0.5;
        const x = (seeded(i, 1) - 0.5) * spread * 2;
        const h = 0.9 + seeded(i, 2) * 1.9;
        dummy.position.set(x, h / 2, z);
        dummy.scale.set(0.12 + seeded(i, 3) * 0.1, h, 1);
        dummy.rotation.y = 0;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} key={count}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={PLANE} roughness={0.7} metalness={0.15} />
    </instancedMesh>
  );
}

/** A thin jade edge line running along the horizon — the "live" signal. */
function SignalLine() {
  return (
    <mesh position={[0, 1.62, -14]}>
      <planeGeometry args={[46, 0.035]} />
      <meshBasicMaterial color={GLOW} transparent opacity={0.5} />
    </mesh>
  );
}

/** Floating motes (dust) — soft round points, very slow rise. */
function DustMotes() {
  const { positions, seeds, scales } = useMemo(() => {
    const positions = new Float32Array(DUST_COUNT * 3);
    const seeds = new Float32Array(DUST_COUNT);
    const scales = new Float32Array(DUST_COUNT);
    for (let i = 0; i < DUST_COUNT; i++) {
      positions[i * 3] = (seeded(i, 3) - 0.5) * 13;
      positions[i * 3 + 1] = seeded(i, 4) * 6.5;
      positions[i * 3 + 2] = -seeded(i, 5) * 17 + 2;
      seeds[i] = seeded(i, 6);
      scales[i] = 0.5 + seeded(i, 7) * 1.3;
    }
    return { positions, seeds, scales };
  }, []);
  useFrame((state) => {
    dustUniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
        <bufferAttribute attach="attributes-aScale" args={[scales, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={dustVertex}
        fragmentShader={dustFragment}
        uniforms={dustUniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function SceneContent() {
  return (
    <>
      <CameraRig />
      <Backdrop />
      <SignalPlanes />
      <SignalLine />
      <DustMotes />
      {/* Executive cool violet ambient + warm orange key + deep plum fill. */}
      <ambientLight intensity={0.62} color={new THREE.Color("#7c62b8")} />
      <directionalLight position={[-6, 6, 4]} intensity={1.0} color={GLOW} />
      <directionalLight position={[5, 2, -3]} intensity={0.35} color={new THREE.Color("#511d9c")} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -9]}>
        <planeGeometry args={[92, 62]} />
        <meshStandardMaterial color={FLOOR} roughness={0.95} metalness={0} />
      </mesh>
    </>
  );
}

/** Canvas host: pauses the loop when hidden/offscreen, falls back on context loss. */
export default function SceneCanvas({ onContextLost }: { onContextLost: () => void }) {
  const [active, setActive] = useState(true);
  const [lostContext, setLostContext] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let onScreen = true;
    let tabVisible = !document.hidden;
    const apply = () => setActive(onScreen && tabVisible);
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            ([entry]) => {
              onScreen = entry.isIntersecting;
              apply();
            },
            { threshold: 0.02 },
          )
        : null;
    io?.observe(el);
    const onVis = () => {
      tabVisible = !document.hidden;
      apply();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (lostContext) return null; // admin-scene shows the CSS fallback frame
  return (
    <div ref={hostRef} className="adm-scene-canvas">
      <Canvas
        dpr={[1, 1.6]}
        frameloop={active ? "always" : "never"}
        camera={{ fov: 50, position: [0, 2.3, 6.2], near: 0.1, far: 90 }}
        gl={{ antialias: true, powerPreference: "low-power" }}
        onCreated={({ gl }) => {
          gl.setClearColor(DEEP2);
          gl.domElement.addEventListener(
            "webglcontextlost",
            (e) => {
              e.preventDefault();
              setLostContext(true);
              onContextLost();
            },
            { once: true },
          );
        }}
      >
        <SceneContent />
      </Canvas>
    </div>
  );
}
