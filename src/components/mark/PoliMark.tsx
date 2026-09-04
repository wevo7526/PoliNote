type PoliMarkProps = {
  className?: string;
  animated?: boolean;
};

/** Branching folio mark — notebook spine meeting an argument tree. */
export function PoliMark({ className, animated = false }: PoliMarkProps) {
  return (
    <svg
      viewBox="0 0 240 240"
      className={className}
      aria-hidden
      role="img"
    >
      <defs>
        <radialGradient id="pn-glow" cx="50%" cy="48%" r="52%">
          <stop offset="0%" stopColor="#d4b483" stopOpacity="0.28" />
          <stop offset="55%" stopColor="#d4b483" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#d4b483" stopOpacity="0" />
        </radialGradient>
        <filter id="pn-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle cx="120" cy="120" r="108" fill="url(#pn-glow)" />
      <circle
        className={animated ? "pn-ring pn-ring-a" : undefined}
        cx="120"
        cy="120"
        r="96"
        fill="none"
        stroke="rgba(243,238,228,0.14)"
        strokeWidth="0.75"
      />
      <circle
        className={animated ? "pn-ring pn-ring-b" : undefined}
        cx="120"
        cy="120"
        r="78"
        fill="none"
        stroke="rgba(212,180,131,0.28)"
        strokeWidth="0.6"
        strokeDasharray="3 7"
      />

      <g
        filter="url(#pn-soft)"
        fill="none"
        stroke="#d4b483"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          className={animated ? "pn-draw pn-d1" : undefined}
          d="M92 58 V182"
        />
        <path
          className={animated ? "pn-draw pn-d2" : undefined}
          d="M92 70 H148 C162 70 170 78 170 92 V150 C170 164 162 172 148 172 H92"
        />
        <path
          className={animated ? "pn-draw pn-d3" : undefined}
          d="M108 94 H152 M108 114 H146 M108 134 H140"
          stroke="rgba(243,238,228,0.45)"
          strokeWidth="1"
        />
        <path
          className={animated ? "pn-draw pn-d4" : undefined}
          d="M170 102 C188 96 198 88 206 74"
        />
        <path
          className={animated ? "pn-draw pn-d5" : undefined}
          d="M170 128 C192 132 204 148 210 168"
        />
        <path
          className={animated ? "pn-draw pn-d6" : undefined}
          d="M92 120 C70 116 54 102 46 84"
        />
        <path
          className={animated ? "pn-draw pn-d7" : undefined}
          d="M92 148 C68 156 52 170 44 188"
        />
      </g>

      <g fill="#f3eee4">
        <circle className={animated ? "pn-node n1" : undefined} cx="92" cy="58" r="3.2" />
        <circle className={animated ? "pn-node n2" : undefined} cx="170" cy="102" r="3.4" fill="#d4b483" />
        <circle className={animated ? "pn-node n3" : undefined} cx="206" cy="74" r="2.6" />
        <circle className={animated ? "pn-node n4" : undefined} cx="210" cy="168" r="2.8" fill="#d4b483" />
        <circle className={animated ? "pn-node n5" : undefined} cx="46" cy="84" r="2.6" />
        <circle className={animated ? "pn-node n6" : undefined} cx="44" cy="188" r="2.8" />
        <circle className={animated ? "pn-node n7" : undefined} cx="148" cy="172" r="3" />
      </g>
    </svg>
  );
}
