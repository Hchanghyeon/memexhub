/**
 * The memexhub mark: a lowercase m whose three feet are notes, joined by the links between them.
 * Drawn in currentColor on the primary color, so it follows light and dark mode.
 */
export const Mark = ({ className = "size-6" }: { className?: string }) => (
  <svg viewBox="0 0 64 64" className={className} aria-hidden>
    <path d="M17 45V31a7.5 7.5 0 0 1 15 0v14M32 31a7.5 7.5 0 0 1 15 0v14" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    <circle cx="17" cy="45" r="4.6" fill="currentColor" />
    <circle cx="32" cy="45" r="4.6" fill="currentColor" />
    <circle cx="47" cy="45" r="4.6" fill="currentColor" />
  </svg>
);

export const Brand = ({ size = "sm" }: { size?: "sm" | "lg" }) => (
  <span className={size === "lg" ? "bg-primary text-primary-foreground grid size-10 place-items-center rounded-xl" : "bg-primary text-primary-foreground grid size-6 place-items-center rounded-md"} aria-hidden>
    <Mark className={size === "lg" ? "size-9" : "size-[1.4rem]"} />
  </span>
);
