"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Html, QuadraticBezierLine } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EXAMPLE_MEMBERS, EXAMPLE_PAIRWISE, EXAMPLE_SIMPLIFIED } from "./example-ledger";

/**
 * Member orbs linked by glowing MUSD debt threads. Every 9 seconds the tangle of recorded debts
 * (pairwise) dissolves into the few transfers that settle everyone (simplified) — Feature 9, live.
 */

const CYCLE = 9;
type Phase = "tangled" | "simplifying" | "simplified";

function phaseAt(t: number): { phase: Phase; k: number } {
  const x = t % CYCLE;
  if (x < 3.6) return { phase: "tangled", k: 0 };
  if (x < 5.2) return { phase: "simplifying", k: (x - 3.6) / 1.6 };
  if (x < 8.4) return { phase: "simplified", k: 1 };
  return { phase: "simplifying", k: 1 - (x - 8.4) / 0.6 };
}

const ease = (k: number) => k * k * (3 - 2 * k);

function useNodePositions() {
  return useMemo(() => {
    const m = new Map<string, THREE.Vector3>();
    const n = EXAMPLE_MEMBERS.length;
    EXAMPLE_MEMBERS.forEach((name, i) => {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const y = Math.sin(i * 1.7) * 0.55;
      m.set(name, new THREE.Vector3(Math.cos(a) * 2.35, y, Math.sin(a) * 1.55));
    });
    return m;
  }, []);
}

function Thread({
  from,
  to,
  amount,
  kind,
  maxAmount,
}: {
  from: THREE.Vector3;
  to: THREE.Vector3;
  amount: bigint;
  kind: "pairwise" | "simplified";
  maxAmount: bigint;
}) {
  const ref = useRef<{ material: THREE.Material & { opacity: number; dashOffset: number; linewidth: number } } | null>(null);
  const packet = useRef<THREE.Mesh>(null);
  const mid = useMemo(() => {
    const m = from.clone().add(to).multiplyScalar(0.5);
    m.y += kind === "simplified" ? 0.9 : 0.35 + ((from.x * 7 + to.z * 3) % 0.5);
    return m;
  }, [from, to, kind]);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(from, mid, to), [from, mid, to]);
  const weight = 0.6 + Number((amount * 100n) / maxAmount) / 100;

  useFrame(({ clock }, delta) => {
    const { k } = phaseAt(clock.elapsedTime);
    const e = ease(k);
    const visible = kind === "pairwise" ? 1 - e : e;
    if (ref.current) {
      ref.current.material.opacity = visible * (kind === "pairwise" ? 0.55 : 0.95);
      ref.current.material.dashOffset -= delta * (kind === "simplified" ? 0.9 : 0.4);
    }
    if (packet.current) {
      const p = (clock.elapsedTime * 0.35 + (from.x + to.z) * 0.1) % 1;
      packet.current.position.copy(curve.getPoint(p));
      packet.current.visible = kind === "simplified" && visible > 0.6;
      const s = 0.06 + 0.03 * weight;
      packet.current.scale.setScalar(s);
    }
  });

  return (
    <group>
      <QuadraticBezierLine
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={ref as any}
        start={from}
        end={to}
        mid={mid}
        color={kind === "simplified" ? "#46ddeb" : "#8a6cff"}
        lineWidth={kind === "simplified" ? 1.6 + weight * 1.6 : 0.8 + weight * 0.6}
        dashed
        dashScale={kind === "simplified" ? 6 : 10}
        dashSize={kind === "simplified" ? 1.4 : 0.6}
        gapSize={kind === "simplified" ? 0.5 : 0.5}
        transparent
        opacity={kind === "pairwise" ? 0.55 : 0}
        depthWrite={false}
        toneMapped={false}
      />
      {kind === "simplified" && (
        <mesh ref={packet}>
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial color="#c9f8fd" toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function Orb({ name, position, showLabels }: { name: string; position: THREE.Vector3; showLabels: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Sprite>(null);
  const seed = name.charCodeAt(0) * 0.37;
  const glowTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(166,143,255,0.85)");
    grd.addColorStop(0.35, "rgba(138,108,255,0.28)");
    grd.addColorStop(1, "rgba(138,108,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return t;
  }, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ref.current) ref.current.position.y = position.y + Math.sin(t * 0.8 + seed) * 0.07;
    if (halo.current) {
      halo.current.position.y = ref.current?.position.y ?? position.y;
      const { k } = phaseAt(t);
      halo.current.material.opacity = 0.55 + 0.35 * ease(k);
    }
  });
  return (
    <group position={[position.x, 0, position.z]}>
      <sprite ref={halo} scale={[1.25, 1.25, 1]} position={[0, position.y, 0]}>
        <spriteMaterial map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <mesh ref={ref} position={[0, position.y, 0]}>
        <sphereGeometry args={[0.2, 32, 32]} />
        <meshStandardMaterial color="#8a6cff" emissive="#5a3dd6" emissiveIntensity={0.9} roughness={0.25} metalness={0.2} />
        {showLabels && (
          <Html center distanceFactor={7} position={[0, -0.42, 0]} style={{ pointerEvents: "none" }}>
            <span className="rounded-full bg-ink-950/70 px-2 py-0.5 font-sans text-[11px] whitespace-nowrap text-fg-muted">{name}</span>
          </Html>
        )}
      </mesh>
    </group>
  );
}

function Scene({ onPhase, showLabels }: { onPhase: (p: Phase) => void; showLabels: boolean }) {
  const pos = useNodePositions();
  const group = useRef<THREE.Group>(null);
  const last = useRef<Phase | null>(null);
  const maxAmount = useMemo(() => {
    let m = 1n;
    for (const t of [...EXAMPLE_PAIRWISE, ...EXAMPLE_SIMPLIFIED]) if (t.amount > m) m = t.amount;
    return m;
  }, []);
  useFrame(({ clock, pointer }, delta) => {
    if (group.current) {
      group.current.rotation.y += delta * 0.08;
      group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, 0.28 + pointer.y * 0.08, 0.05);
    }
    const { phase } = phaseAt(clock.elapsedTime);
    if (phase !== last.current) {
      last.current = phase;
      onPhase(phase);
    }
  });
  return (
    <group ref={group} rotation={[0.28, 0, 0]}>
      {EXAMPLE_PAIRWISE.map((t) => (
        <Thread key={`p-${t.from}-${t.to}`} from={pos.get(t.from)!} to={pos.get(t.to)!} amount={t.amount} kind="pairwise" maxAmount={maxAmount} />
      ))}
      {EXAMPLE_SIMPLIFIED.map((t) => (
        <Thread key={`s-${t.from}-${t.to}`} from={pos.get(t.from)!} to={pos.get(t.to)!} amount={t.amount} kind="simplified" maxAmount={maxAmount} />
      ))}
      {EXAMPLE_MEMBERS.map((m) => (
        <Orb key={m} name={m} position={pos.get(m)!} showLabels={showLabels} />
      ))}
    </group>
  );
}

export default function DebtConstellation({ onPhase }: { onPhase?: (p: Phase) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let onScreen = true;
    const update = () => setActive(onScreen && document.visibilityState === "visible");
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      update();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    setSmall(window.innerWidth < 768);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return (
    <div ref={wrap} className="absolute inset-0">
      <Canvas
        dpr={[1, small ? 1.25 : 1.75]}
        frameloop={active ? "always" : "never"}
        camera={{ position: [0, 1.4, 6.2], fov: 42 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        aria-hidden="true"
      >
        <ambientLight intensity={0.5} />
        <pointLight position={[3, 4, 4]} intensity={30} color="#c4b5ff" />
        <pointLight position={[-4, -2, -3]} intensity={18} color="#46ddeb" />
        <Scene onPhase={(p) => onPhase?.(p)} showLabels={!small} />
      </Canvas>
    </div>
  );
}
