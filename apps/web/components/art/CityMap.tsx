"use client";

/**
 * CityMap — illustrated SVG night cityscape of Shorefront City.
 * Six clickable buildings, heat glow auras bleeding onto the street, flickering
 * windows, moon + clouds, wet-street reflections and a subtle rain layer.
 */
import { makeRng } from "@trash-wars/economy";
import type { HeatBand, JackpotState, LocationLive, Mission } from "@trash-wars/shared";
import { motion, useReducedMotion } from "framer-motion";
import React from "react";
import coords from "./buildings.json";
import { VaultWidget } from "../game/VaultWidget";
import { formatCountdown } from "../../lib/time";

const HEAT_COLOR: Record<HeatBand, string> = {
  none: "transparent",
  low: "#3DDC97",
  med: "#FFB627",
  high: "#FF8A3C",
  blazing: "#FF4D5E",
};

const HEAT_OPACITY: Record<HeatBand, number> = {
  none: 0,
  low: 0.18,
  med: 0.26,
  high: 0.34,
  blazing: 0.46,
};

interface BuildingBox {
  slug: string;
  x: number;
  y: number;
  width: number;
  height: number;
  labelX: number;
  labelY: number;
}

const BOXES: BuildingBox[] = coords.buildings;

function Windows({ x, y, w, h, cols, rows, seed, lit = 0.55, color = "#FFD56B" }: {
  x: number; y: number; w: number; h: number; cols: number; rows: number; seed: string; lit?: number; color?: string;
}) {
  const rng = makeRng(seed);
  const cells: React.ReactElement[] = [];
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = rng() < lit;
      const flickers = on && rng() < 0.25;
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={x + c * cw + cw * 0.22}
          y={y + r * ch + ch * 0.22}
          width={cw * 0.56}
          height={ch * 0.56}
          rx={1}
          fill={on ? color : "#141a26"}
          opacity={on ? 0.85 : 1}
          className={flickers ? "animate-flicker" : undefined}
          style={flickers ? { animationDelay: `${(rng() * 6).toFixed(2)}s` } : undefined}
        />,
      );
    }
  }
  return <g>{cells}</g>;
}

/* ── individual buildings (drawn in absolute map coordinates) ─────── */

function Bodega() {
  // corner-store: x 60 y 560 w 170 h 130
  return (
    <g>
      <rect x={60} y={560} width={170} height={130} fill="#1d2433" stroke="#0a0d13" strokeWidth={3} />
      <Windows x={70} y={572} w={150} h={40} cols={4} rows={1} seed="win:bodega" lit={0.7} />
      {/* striped awning */}
      <g>
        {Array.from({ length: 8 }).map((_, i) => (
          <path
            key={i}
            d={`M ${62 + i * 21} 622 L ${62 + (i + 1) * 21} 622 L ${60 + (i + 1) * 21} 642 L ${58 + i * 21} 642 Z`}
            fill={i % 2 === 0 ? "#FFB627" : "#86281f"}
          />
        ))}
        <rect x={56} y={640} width={178} height={5} rx={2} fill="#0a0d13" />
      </g>
      {/* doorway + goods window */}
      <rect x={88} y={648} width={34} height={42} fill="#0e1320" stroke="#0a0d13" strokeWidth={2} />
      <rect x={134} y={650} width={70} height={32} fill="#2c3850" stroke="#0a0d13" strokeWidth={2} />
      <rect x={138} y={668} width={62} height={4} fill="#46587c" />
      {/* neon 24H sign */}
      <g className="animate-flicker" style={{ animationDelay: "1.3s" }}>
        <rect x={158} y={606} width={52} height={20} rx={4} fill="#0c1018" stroke="#3DDC97" strokeWidth={2} />
        <text x={184} y={621} textAnchor="middle" fontSize={14} fontWeight={800} fill="#3DDC97" fontFamily="monospace">
          24H
        </text>
      </g>
      {/* trash cans — of course */}
      <rect x={66} y={668} width={14} height={20} rx={3} fill="#39424f" stroke="#0a0d13" strokeWidth={2} />
      <ellipse cx={73} cy={668} rx={8} ry={3} fill="#4a5666" stroke="#0a0d13" strokeWidth={1.5} />
    </g>
  );
}

function PawnShop() {
  // x 270 y 520 w 160 h 170
  return (
    <g>
      <rect x={270} y={520} width={160} height={170} fill="#242b3c" stroke="#0a0d13" strokeWidth={3} />
      <rect x={270} y={520} width={160} height={10} fill="#161c29" />
      <Windows x={280} y={540} w={140} h={70} cols={3} rows={2} seed="win:pawn" lit={0.5} />
      {/* three-ball sign */}
      <g>
        <line x1={300} y1={612} x2={300} y2={628} stroke="#5a4a23" strokeWidth={3} />
        <circle cx={288} cy={636} r={9} fill="#FFB627" className="animate-pulse-soft" />
        <circle cx={300} cy={644} r={9} fill="#FFB627" className="animate-pulse-soft" style={{ animationDelay: "0.7s" }} />
        <circle cx={312} cy={636} r={9} fill="#FFB627" className="animate-pulse-soft" style={{ animationDelay: "1.4s" }} />
      </g>
      <rect x={330} y={618} width={90} height={26} rx={3} fill="#0c1018" stroke="#FFB627" strokeWidth={1.5} />
      <text x={375} y={636} textAnchor="middle" fontSize={13} fontWeight={700} fill="#FFD56B" fontFamily="monospace">
        PAWN
      </text>
      {/* barred storefront */}
      <rect x={286} y={652} width={128} height={38} fill="#19202e" stroke="#0a0d13" strokeWidth={2} />
      {Array.from({ length: 7 }).map((_, i) => (
        <line key={i} x1={294 + i * 17} y1={652} x2={294 + i * 17} y2={690} stroke="#0a0d13" strokeWidth={2.5} />
      ))}
    </g>
  );
}

function Jewelry() {
  // x 470 y 480 w 180 h 210 — art deco
  return (
    <g>
      <rect x={470} y={480} width={180} height={210} fill="#2a3147" stroke="#0a0d13" strokeWidth={3} />
      {/* deco stepped crown */}
      <rect x={500} y={462} width={120} height={20} fill="#323a55" stroke="#0a0d13" strokeWidth={2.5} />
      <rect x={530} y={448} width={60} height={16} fill="#3a4365" stroke="#0a0d13" strokeWidth={2.5} />
      {/* deco fins */}
      {Array.from({ length: 4 }).map((_, i) => (
        <rect key={i} x={486 + i * 42} y={488} width={6} height={160} fill="#3c466b" />
      ))}
      <Windows x={496} y={496} w={130} h={120} cols={3} rows={4} seed="win:jewel" lit={0.45} color="#C7DBFF" />
      {/* storefront with gem glints */}
      <rect x={486} y={636} width={148} height={54} fill="#101626" stroke="#0a0d13" strokeWidth={2} />
      <rect x={494} y={646} width={56} height={34} fill="#1b2742" />
      <rect x={570} y={646} width={56} height={34} fill="#1b2742" />
      {[
        [512, 660], [536, 670], [586, 656], [606, 668], [560, 624],
      ].map(([gx, gy], i) => (
        <g key={i} className="animate-pulse-soft" style={{ animationDelay: `${i * 0.9}s` }}>
          <path d={`M ${gx} ${gy! - 6} L ${gx! + 2} ${gy! - 2} L ${gx! + 6} ${gy} L ${gx! + 2} ${gy! + 2} L ${gx} ${gy! + 6} L ${gx! - 2} ${gy! + 2} L ${gx! - 6} ${gy} L ${gx! - 2} ${gy! - 2} Z`} fill="#E2F0FF" />
        </g>
      ))}
      <text x={560} y={630} textAnchor="middle" fontSize={12} fontWeight={700} fill="#C7DBFF" fontFamily="monospace" letterSpacing={3}>
        GEMS
      </text>
    </g>
  );
}

function TruckDepot() {
  // x 690 y 545 w 200 h 145
  return (
    <g>
      <rect x={690} y={545} width={200} height={145} fill="#202737" stroke="#0a0d13" strokeWidth={3} />
      {/* corrugated roof */}
      <path d="M 682 545 L 898 545 L 890 528 L 690 528 Z" fill="#2b3447" stroke="#0a0d13" strokeWidth={2.5} />
      {Array.from({ length: 10 }).map((_, i) => (
        <line key={i} x1={696 + i * 20} y1={529} x2={694 + i * 20} y2={544} stroke="#1a2130" strokeWidth={3} />
      ))}
      <text x={790} y={566} textAnchor="middle" fontSize={12} fontWeight={700} fill="#8A94A6" fontFamily="monospace" letterSpacing={2}>
        SHOREFRONT ARMORED CO.
      </text>
      {/* roller door */}
      <rect x={706} y={578} width={92} height={112} fill="#171d2a" stroke="#0a0d13" strokeWidth={2} />
      {Array.from({ length: 7 }).map((_, i) => (
        <line key={i} x1={706} y1={592 + i * 15} x2={798} y2={592 + i * 15} stroke="#0e131d" strokeWidth={2.5} />
      ))}
      {/* truck silhouette */}
      <g>
        <rect x={806} y={618} width={64} height={42} rx={5} fill="#39455c" stroke="#0a0d13" strokeWidth={2.5} />
        <rect x={852} y={632} width={26} height={28} rx={4} fill="#2e394e" stroke="#0a0d13" strokeWidth={2.5} />
        <rect x={856} y={638} width={14} height={10} rx={2} fill="#FFD56B" opacity={0.8} />
        <circle cx={822} cy={664} r={9} fill="#10141d" stroke="#0a0d13" strokeWidth={2.5} />
        <circle cx={858} cy={664} r={9} fill="#10141d" stroke="#0a0d13" strokeWidth={2.5} />
        <circle cx={822} cy={664} r={3.5} fill="#39455c" />
        <circle cx={858} cy={664} r={3.5} fill="#39455c" />
        {/* armored slats */}
        <line x1={812} y1={628} x2={864} y2={628} stroke="#0a0d13" strokeWidth={2} />
        <line x1={812} y1={640} x2={864} y2={640} stroke="#0a0d13" strokeWidth={2} />
      </g>
      <Windows x={812} y={584} w={66} h={22} cols={3} rows={1} seed="win:truck" lit={0.6} />
    </g>
  );
}

function FirstNational() {
  // x 925 y 440 w 215 h 250 — columned bank
  return (
    <g>
      <rect x={925} y={500} width={215} height={190} fill="#262e42" stroke="#0a0d13" strokeWidth={3} />
      {/* pediment */}
      <path d="M 915 500 L 1032 446 L 1150 500 Z" fill="#313a55" stroke="#0a0d13" strokeWidth={3} />
      <path d="M 940 498 L 1032 458 L 1125 498 Z" fill="#1c2335" />
      <text x={1032} y={492} textAnchor="middle" fontSize={13} fontWeight={800} fill="#FFD56B" fontFamily="monospace" letterSpacing={2}>
        FIRST NATIONAL
      </text>
      {/* columns */}
      {Array.from({ length: 6 }).map((_, i) => (
        <g key={i}>
          <rect x={941 + i * 34} y={512} width={16} height={158} fill="#3a445f" stroke="#0a0d13" strokeWidth={2} />
          <rect x={937 + i * 34} y={506} width={24} height={8} fill="#46527a" stroke="#0a0d13" strokeWidth={1.5} />
          <rect x={937 + i * 34} y={668} width={24} height={8} fill="#46527a" stroke="#0a0d13" strokeWidth={1.5} />
        </g>
      ))}
      {/* vault door entrance */}
      <rect x={1006} y={600} width={52} height={90} fill="#11161f" stroke="#0a0d13" strokeWidth={2.5} />
      <circle cx={1032} cy={636} r={14} fill="none" stroke="#FFB627" strokeWidth={2.5} opacity={0.7} />
      <circle cx={1032} cy={636} r={5} fill="#FFB627" opacity={0.5} />
      {/* steps */}
      <rect x={930} y={676} width={205} height={7} fill="#1a2130" stroke="#0a0d13" strokeWidth={1.5} />
      <rect x={936} y={683} width={193} height={7} fill="#161c29" stroke="#0a0d13" strokeWidth={1.5} />
    </g>
  );
}

function MintTower({ reduced, boarded }: { reduced: boolean; boarded: boolean }) {
  // x 720 y 150 w 150 h 330 — monumental background tower
  return (
    <g>
      {/* purple jackpot glow */}
      <ellipse cx={795} cy={300} rx={130} ry={190} fill="#C792EA" opacity={0.1} />
      <rect x={730} y={210} width={130} height={270} fill="#1c2233" stroke="#0a0d13" strokeWidth={3} />
      <rect x={748} y={170} width={94} height={44} fill="#222a40" stroke="#0a0d13" strokeWidth={3} />
      <rect x={770} y={142} width={50} height={32} fill="#2a3450" stroke="#0a0d13" strokeWidth={3} />
      {/* crown beacon */}
      <circle cx={795} cy={134} r={7} fill={boarded ? "#5a4a23" : "#C792EA"} className="animate-pulse-soft" />
      <Windows x={742} y={224} w={106} h={210} cols={4} rows={7} seed="win:mint" lit={boarded ? 0.12 : 0.4} color="#D9B8FF" />
      <text x={795} y={200} textAnchor="middle" fontSize={13} fontWeight={800} fill="#C792EA" fontFamily="monospace" letterSpacing={4}>
        THE MINT
      </text>
      {/* boarded-up pre-winnable (specs/03) — amber leaks through the cracks */}
      {boarded && (
        <g>
          {[
            [732, 300, -7], [732, 360, 5], [732, 420, -4],
          ].map(([x, y, r], i) => (
            <g key={i} transform={`rotate(${r} ${(x as number) + 63} ${(y as number) + 9})`}>
              <rect x={x} y={y} width={126} height={18} fill="#3a3220" stroke="#0a0d13" strokeWidth={2} />
              <circle cx={(x as number) + 12} cy={(y as number) + 9} r={2} fill="#0a0d13" />
              <circle cx={(x as number) + 114} cy={(y as number) + 9} r={2} fill="#0a0d13" />
            </g>
          ))}
          {/* greed through the cracks */}
          <rect x={742} y={330} width={106} height={6} fill="#FFB627" opacity={0.5} className="animate-pulse-soft" />
          <rect x={742} y={392} width={106} height={5} fill="#FFB627" opacity={0.35} className="animate-pulse-soft" style={{ animationDelay: "1.1s" }} />
          <g transform="rotate(-3 795 252)">
            <rect x={744} y={240} width={102} height={24} rx={3} fill="#0c1018" stroke="#FFB627" strokeWidth={1.5} />
            <text x={795} y={256} textAnchor="middle" fontSize={10.5} fontWeight={800} fill="#FFB627" fontFamily="monospace">
              OPENING SOON
            </text>
          </g>
        </g>
      )}
      {/* searchlights */}
      {!reduced && (
        <g opacity={0.35}>
          <motion.path
            d="M 795 150 L 700 20 L 760 20 Z"
            fill="#C792EA"
            opacity={0.25}
            animate={{ rotate: [-14, 16, -14] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
            style={{ originX: "795px", originY: "150px" }}
          />
          <motion.path
            d="M 795 150 L 850 15 L 905 25 Z"
            fill="#E2D2FF"
            opacity={0.18}
            animate={{ rotate: [12, -18, 12] }}
            transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
            style={{ originX: "795px", originY: "150px" }}
          />
        </g>
      )}
    </g>
  );
}

/**
 * The Penthouse (Kingpin-only, specs/01) — a discreet glass crown atop the
 * background tower beside First National, gold "K" beacon. Locked silhouette
 * for everyone below Kingpin.
 */
function Penthouse({ unlocked, onSelect }: { unlocked: boolean; onSelect: (slug: string) => void }) {
  return (
    <motion.g
      onClick={unlocked ? () => onSelect("the-penthouse") : undefined}
      whileHover={unlocked ? { y: -3, filter: "brightness(1.2)" } : undefined}
      style={{ cursor: unlocked ? "pointer" : "default" }}
      role={unlocked ? "button" : undefined}
      aria-label={unlocked ? "The Penthouse Job — Kingpin access" : "The Penthouse — Kingpin only"}
      tabIndex={unlocked ? 0 : undefined}
      onKeyDown={(e) => {
        if (unlocked && (e.key === "Enter" || e.key === " ")) onSelect("the-penthouse");
      }}
      opacity={unlocked ? 1 : 0.8}
    >
      {unlocked && <ellipse cx={945} cy={222} rx={70} ry={36} fill="#FFB627" opacity={0.12} />}
      {/* glass crown atop the 900–990 background tower */}
      <rect x={903} y={214} width={84} height={38} fill="#141b2c" stroke="#0a0d13" strokeWidth={2.5} />
      <rect x={909} y={220} width={72} height={20} fill={unlocked ? "#2b2410" : "#10141f"} stroke="#0a0d13" strokeWidth={1.5} />
      {unlocked && (
        <g>
          {[914, 932, 950, 968].map((wx, i) => (
            <rect key={wx} x={wx} y={223} width={12} height={14} fill="#FFD56B" opacity={0.75} className={i === 2 ? "animate-flicker" : undefined} />
          ))}
        </g>
      )}
      <rect x={918} y={202} width={54} height={12} fill="#1a2235" stroke="#0a0d13" strokeWidth={2} />
      {/* gold K beacon */}
      <circle cx={945} cy={194} r={9} fill="#0c1018" stroke="#FFB627" strokeWidth={1.8} opacity={unlocked ? 1 : 0.55} />
      <text x={945} y={198.5} textAnchor="middle" fontSize={11} fontWeight={900} fill="#FFB627" fontFamily="monospace" opacity={unlocked ? 1 : 0.6}>
        K
      </text>
      {!unlocked && (
        <text x={945} y={266} textAnchor="middle" fontSize={9} fontWeight={700} fill="#8A94A6" fontFamily="monospace" letterSpacing={1}>
          🔒 KINGPIN
        </text>
      )}
    </motion.g>
  );
}

const BUILDING_ART: Record<string, (reduced: boolean, opts?: { mintBoarded?: boolean }) => React.ReactElement> = {
  "corner-store": () => <Bodega />,
  "pawn-shop": () => <PawnShop />,
  "jewelry-district": () => <Jewelry />,
  "armored-truck": () => <TruckDepot />,
  "first-national": () => <FirstNational />,
  "the-mint": (reduced, opts) => <MintTower reduced={reduced} boarded={opts?.mintBoarded ?? false} />,
};

export interface CityMapProps {
  locations: LocationLive[];
  activeMissions: Mission[];
  now: number;
  onSelect: (slug: string) => void;
  /** v1.1 — public jackpot pool (drives the VaultWidget + boarded Mint). */
  jackpot?: JackpotState | null;
}

export function CityMap({ locations, activeMissions, now, onSelect, jackpot }: CityMapProps) {
  const reduced = useReducedMotion() ?? false;
  const penthouseUnlocked = locations.some((l) => l.slug === "the-penthouse");
  const mintBoarded = jackpot ? !jackpot.winnable : false;

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-line bg-[#0a0e16]">
      <svg viewBox="0 0 1200 800" className="block w-full" role="group" aria-label="Shorefront City map">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a0f1c" />
            <stop offset="55%" stopColor="#0d1322" />
            <stop offset="100%" stopColor="#131a2c" />
          </linearGradient>
          <linearGradient id="street" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#141a28" />
            <stop offset="100%" stopColor="#0a0d15" />
          </linearGradient>
          <linearGradient id="reflectionFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <filter id="blurSm">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <mask id="reflectionMask">
            <rect x="0" y="690" width="1200" height="110" fill="url(#reflectionFade)" />
          </mask>
        </defs>

        <rect width="1200" height="800" fill="url(#sky)" />

        {/* moon + clouds */}
        <circle cx="190" cy="120" r="46" fill="#E8ECF4" opacity="0.85" />
        <circle cx="206" cy="108" r="42" fill="#0d1322" opacity="0.55" />
        <ellipse cx="380" cy="90" rx="120" ry="16" fill="#1a2235" opacity="0.7" />
        <ellipse cx="980" cy="140" rx="150" ry="18" fill="#1a2235" opacity="0.6" />
        <ellipse cx="620" cy="60" rx="90" ry="12" fill="#161e30" opacity="0.8" />

        {/* skyline depth layers */}
        <g fill="#10172a" opacity="0.9">
          <rect x="0" y="320" width="70" height="370" /><rect x="80" y="260" width="90" height="430" />
          <rect x="180" y="350" width="60" height="340" /><rect x="250" y="290" width="110" height="400" />
          <rect x="380" y="240" width="80" height="450" /><rect x="470" y="330" width="100" height="360" />
          <rect x="590" y="280" width="70" height="410" /><rect x="900" y="250" width="90" height="440" />
          <rect x="1000" y="320" width="110" height="370" /><rect x="1120" y="270" width="80" height="420" />
        </g>
        <g fill="#0c1220">
          <rect x="30" y="420" width="120" height="270" /><rect x="170" y="470" width="100" height="220" />
          <rect x="300" y="430" width="140" height="260" /><rect x="450" y="400" width="90" height="290" />
          <rect x="560" y="450" width="120" height="240" /><rect x="880" y="410" width="130" height="280" />
          <rect x="1030" y="450" width="140" height="240" />
        </g>
        {/* sparse distant lit windows */}
        <Windows x={86} y={280} w={80} h={120} cols={3} rows={5} seed="win:bg1" lit={0.2} color="#7d8db0" />
        <Windows x={390} y={260} w={62} h={120} cols={2} rows={5} seed="win:bg2" lit={0.2} color="#7d8db0" />
        <Windows x={910} y={270} w={70} h={120} cols={3} rows={5} seed="win:bg3" lit={0.18} color="#7d8db0" />

        {/* street */}
        <rect x="0" y="690" width="1200" height="110" fill="url(#street)" />
        <line x1="0" y1="690" x2="1200" y2="690" stroke="#0a0d13" strokeWidth="3" />
        <g stroke="#2a3346" strokeWidth="3" strokeDasharray="26 30" opacity="0.5">
          <line x1="0" y1="748" x2="1200" y2="748" />
        </g>

        {/* wet-street reflections (flipped silhouettes) */}
        <g mask="url(#reflectionMask)" filter="url(#blurSm)" opacity={0.8}>
          {BOXES.map((b) => {
            const loc = locations.find((l) => l.slug === b.slug);
            const heat = loc?.heat ?? "none";
            return (
              <g key={b.slug} transform={`translate(0 ${2 * 690}) scale(1 -1)`}>
                <rect x={b.x} y={690 - Math.min(b.height, 80)} width={b.width} height={Math.min(b.height, 80)} fill="#2a3550" />
                {heat !== "none" && (
                  <rect x={b.x} y={690 - 40} width={b.width} height={40} fill={HEAT_COLOR[heat]} opacity={HEAT_OPACITY[heat]} />
                )}
              </g>
            );
          })}
        </g>

        {/* the penthouse — Kingpin-only, atop the tower beside First National */}
        <Penthouse unlocked={penthouseUnlocked} onSelect={onSelect} />

        {/* buildings */}
        {BOXES.map((b) => {
          const loc = locations.find((l) => l.slug === b.slug);
          const heat = loc?.heat ?? "none";
          const art = BUILDING_ART[b.slug];
          const missionsHere = activeMissions.filter((m) => m.locationSlug === b.slug);
          const nextResolve = missionsHere.length
            ? Math.min(...missionsHere.map((m) => Date.parse(m.resolvesAt)))
            : null;
          const isTower = b.slug === "the-mint";
          return (
            <motion.g
              key={b.slug}
              onClick={() => onSelect(b.slug)}
              whileHover={reduced ? undefined : { y: -5, filter: "brightness(1.18)" }}
              whileTap={reduced ? undefined : { scale: 0.995 }}
              style={{ cursor: "pointer" }}
              role="button"
              aria-label={`${loc?.name ?? b.slug} — heat ${heat}`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect(b.slug);
              }}
            >
              {/* heat aura bleeding onto the street */}
              {heat !== "none" && (
                <>
                  <ellipse
                    cx={b.x + b.width / 2}
                    cy={isTower ? b.y + b.height / 2 : 688}
                    rx={b.width * 0.85}
                    ry={isTower ? b.height * 0.6 : 46}
                    fill={HEAT_COLOR[heat]}
                    opacity={HEAT_OPACITY[heat]}
                    className={heat === "blazing" ? "animate-pulse-soft" : undefined}
                  />
                  <rect
                    x={b.x - 8} y={b.y - 8} width={b.width + 16} height={b.height + 16}
                    rx={10} fill="none" stroke={HEAT_COLOR[heat]} strokeWidth={2}
                    opacity={HEAT_OPACITY[heat] + 0.12}
                  />
                </>
              )}
              {art ? art(reduced, { mintBoarded }) : null}
              {/* name plate */}
              <g transform={`translate(${b.labelX} ${b.labelY})`}>
                <rect x={-62} y={-14} width={124} height={22} rx={11} fill="#0c1018" stroke="#1F2735" strokeWidth={1.5} />
                <text textAnchor="middle" y={2} fontSize={12} fontWeight={700} fill="#E8ECF4" fontFamily="Inter, system-ui, sans-serif">
                  {loc?.name ?? b.slug}
                </text>
                {/* playersActive pill */}
                <g transform="translate(0 24)">
                  <rect x={-34} y={-11} width={68} height={18} rx={9} fill="#131822" stroke="#1F2735" strokeWidth={1.5} />
                  <circle cx={-22} cy={-2} r={3.5} fill="#3DDC97" className="animate-pulse-soft" />
                  <text textAnchor="middle" x={5} y={2} fontSize={11} fill="#8A94A6" fontFamily="Inter, system-ui, sans-serif">
                    {loc?.playersActive ?? 0} in
                  </text>
                </g>
              </g>
              {/* active mission chip floating over the building */}
              {nextResolve !== null && (
                <g transform={`translate(${b.x + b.width / 2} ${b.y - 22})`}>
                  <rect x={-52} y={-13} width={104} height={24} rx={12} fill="#FFB627" />
                  <text textAnchor="middle" y={4} fontSize={12.5} fontWeight={800} fill="#131822" fontFamily="Inter, system-ui, sans-serif">
                    🦝 {formatCountdown(nextResolve - now)}
                  </text>
                </g>
              )}
            </motion.g>
          );
        })}
      </svg>

      {/* v1.1 — the jackpot counter floats over The Mint */}
      {jackpot && (
        <div className="absolute left-[47%] top-[2%] w-[30%] min-w-[210px] max-w-[300px]">
          <VaultWidget
            pool={jackpot.pool}
            winnable={jackpot.winnable}
            winnableAt={jackpot.winnableAt}
            now={now}
          />
        </div>
      )}

      {/* ambient rain layers (city map only) */}
      <div className="rain-layer animate-rain" aria-hidden />
      <div className="rain-layer l2 animate-rain-slow" aria-hidden />
      <div className="rain-layer l3 animate-rain" style={{ animationDelay: "0.4s" }} aria-hidden />
    </div>
  );
}
