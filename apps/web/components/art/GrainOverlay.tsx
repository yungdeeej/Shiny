export function GrainOverlay() {
  return (
    <svg
      className="pointer-events-none fixed inset-0 z-[90] h-full w-full opacity-[0.05] mix-blend-overlay"
      aria-hidden
    >
      <filter id="tw-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#tw-grain)" />
    </svg>
  );
}
