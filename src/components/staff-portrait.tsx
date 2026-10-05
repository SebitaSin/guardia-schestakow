import { initialsOf } from "@/data/legajos";
import { cn } from "@/lib/utils";

const PALETTES = [
  ["#0b1f3a", "#1d4ed8", "#93c5fd"],
  ["#0f3d3e", "#0f766e", "#5eead4"],
  ["#3b1d0b", "#c2410c", "#fdba74"],
  ["#2e1065", "#6d28d9", "#c4b5fd"],
  ["#1e3a5f", "#0369a1", "#7dd3fc"],
  ["#3f1d2e", "#be185d", "#f9a8d4"],
  ["#14532d", "#15803d", "#86efac"],
  ["#44403c", "#78716c", "#d6d3d1"],
];

function hash(s: string) {
  let n = 0;
  for (const c of s) n = (n * 33 + c.charCodeAt(0)) >>> 0;
  return n;
}

export function StaffPortrait({
  name,
  seed,
  photo,
  size = 40,
  className,
}: {
  name: string;
  seed: string;
  photo?: string | null;
  size?: number;
  className?: string;
}) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-2xl object-cover object-top", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  const h = hash(seed);
  const [bg, mid, light] = PALETTES[h % PALETTES.length];
  const initials = initialsOf(name) || "?";
  const tilt = (h % 7) - 3;
  const id = `sp-${h.toString(16)}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      className={cn("shrink-0 rounded-2xl", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={mid} />
          <stop offset="100%" stopColor={bg} />
        </linearGradient>
      </defs>
      <rect width="80" height="80" rx="16" fill={`url(#${id}-g)`} />
      <circle cx="58" cy="14" r="18" fill={light} opacity="0.18" />
      <g transform={`rotate(${tilt} 40 46)`}>
        <ellipse cx="40" cy="72" rx="26" ry="16" fill={bg} />
        <rect x="24" y="58" width="32" height="18" rx="6" fill={light} opacity="0.85" />
        <circle cx="40" cy="36" r="16" fill="#f4efe6" />
        <ellipse cx="40" cy="40" rx="10" ry="12" fill="#f4efe6" />
        <path d="M28 32c3-8 21-8 24 0" fill="none" stroke={bg} strokeWidth="5" strokeLinecap="round" />
      </g>
      <text
        x="40"
        y="74"
        textAnchor="middle"
        fill="#fff"
        fontSize="11"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui"
      >
        {initials}
      </text>
    </svg>
  );
}
