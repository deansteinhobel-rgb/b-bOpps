import { cn } from "@/lib/utils"

/**
 * A floating glass of Sauvignon Blanc being poured. `progress` (0..1) sets how full it is, so the
 * glass fills with the real work. Animations live in globals.css (wine-*) and stop for reduced motion.
 * `hoverPour`: resting glass; when a parent with `group/pour` is hovered, the bottle tips in and
 * pours a little more.
 */
export function WinePour({ progress, pouring = true, hoverPour = false, overflow, className }: { progress: number; pouring?: boolean; hoverPour?: boolean; overflow?: number; className?: string }) {
  const p = Math.max(0, Math.min(1, progress))
  // `overflow` (0..1): the glass is brimming and wine runs down the outside to a puddle at the base.
  // When it's set, the caller drives the level (no CSS hover rise).
  const o = overflow === undefined ? 0 : Math.max(0, Math.min(1, overflow))
  const driven = overflow !== undefined
  // The bowl's inside runs from y=162 (bottom) to y=72 (rim); a glass is served about two-thirds full.
  const level = o > 0 ? 72 : 162 - p * (driven ? 90 : 62)
  return (
    <svg viewBox="0 -75 240 335" className={cn("wine-float overflow-visible", className)} role="img" aria-label={`Glass ${Math.round(p * 100)}% poured`}>
      <defs>
        <clipPath id="wine-bowl">
          <path d="M62 72 C62 132 76 160 100 164 C124 160 138 132 138 72 Z" />
        </clipPath>
        <linearGradient id="wine-liquid" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f6f0b4" />
          <stop offset="1" stopColor="#d9cf6e" />
        </linearGradient>
        <linearGradient id="wine-glass" x1="0" x2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.03" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
        </linearGradient>
      </defs>

      {/* The bottle, tipped over the glass */}
      <g
        className={cn(
          "transition-[translate,opacity] duration-500",
          hoverPour ? "-translate-y-4 translate-x-6 opacity-0 group-hover/pour:translate-x-0 group-hover/pour:translate-y-0 group-hover/pour:opacity-100" : pouring ? "" : "-translate-y-4 translate-x-6 opacity-0",
        )}
      >
        <g transform="translate(104 8) rotate(-38)">
          <path d="M0 -4 L24 -4 C30 -4 32 -15 40 -15 L122 -15 Q126 -15 126 -11 L126 11 Q126 15 122 15 L40 15 C32 15 30 4 24 4 L0 4 Z" fill="#1d3a28" stroke="#2f5a3f" strokeWidth="1" />
          <rect x="62" y="-15" width="38" height="30" fill="#e4ff1a" opacity="0.9" />
          <text x="81" y="3" textAnchor="middle" fontSize="9" fontFamily="Georgia, serif" fill="#0a0a0a">
            &amp;
          </text>
          <path d="M44 -12 L118 -12" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" strokeLinecap="round" />
        </g>
      </g>

      {/* The pour */}
      {((pouring && p < 1) || hoverPour) && (
        <line
          className={cn("wine-stream", hoverPour && "opacity-0 transition-opacity duration-300 group-hover/pour:opacity-100 group-hover/pour:delay-300")}
          x1="104"
          y1="10"
          x2="104"
          y2={level}
          stroke="#efe59a"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="10 6"
        />
      )}

      {/* Wine */}
      <g clipPath="url(#wine-bowl)">
        <g className={cn(hoverPour && !driven && "transition-[translate] delay-300 duration-[1400ms] ease-out group-hover/pour:-translate-y-[18px]")}>
        <rect x="50" y={level} width="100" height={200 - level} fill="url(#wine-liquid)" className="transition-all duration-700" style={{ transitionProperty: "y, height" }} />
        <path className="wine-wave" d={`M20 ${level} q 10 -3 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 V ${level + 6} H 20 Z`} fill="#fbf7d2" opacity="0.8" />
        {p > 0.05 &&
          [72, 88, 101, 114, 126].map((x, i) => <circle key={x} className="wine-bubble" cx={x} cy={160} r={1.2 + (i % 2) * 0.6} fill="#fff" opacity="0.7" style={{ animationDelay: `${i * 0.55}s` }} />)}
        </g>
      </g>

      {/* Spilling over: a brimming cap, runs down both sides of the bowl and the stem, a puddle */}
      {o > 0 && (
        <g fill="none" stroke="#efe59a" strokeLinecap="round" opacity="0.95">
          <ellipse cx="100" cy="72" rx={34 + 5 * o} ry={1.5 + 2.5 * o} fill="#f6f0b4" stroke="none" />
          <path d="M138 72 C143 102 141 134 129 152 C121 161 109 166 102 168 L101 229" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - o} strokeWidth="3.5" />
          <path d="M62 72 C57 104 60 132 70 148" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - Math.min(1, o * 1.4)} strokeWidth="3" />
          <ellipse cx="100" cy="231" rx={6 + 34 * o} ry={1.5 + 3 * o} fill="#efe59a" stroke="none" opacity={Math.min(1, o * 1.6)} />
        </g>
      )}

      {/* Glass */}
      <path d="M62 72 C62 132 76 160 100 164 C124 160 138 132 138 72 Z" fill="url(#wine-glass)" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />
      <path d="M72 84 C71 118 78 142 90 152" stroke="#fff" strokeOpacity="0.35" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M100 164 L100 226" stroke="currentColor" strokeOpacity="0.55" strokeWidth="2" />
      <ellipse cx="100" cy="229" rx="30" ry="5" fill="url(#wine-glass)" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />
    </svg>
  )
}
