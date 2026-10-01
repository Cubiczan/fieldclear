import { cn } from "cn";

export type OrbState = "idle" | "listening" | "running" | "speaking";

const sizes = {
  sm: { box: "size-8", core: "size-2.5" },
  lg: { box: "size-28", core: "size-10" },
} as const;

export function AlexaOrb({
  state,
  size = "lg",
  className,
}: {
  state: OrbState;
  size?: "sm" | "lg";
  className?: string;
}) {
  const scale = size === "sm" ? sizes.sm : sizes.lg;
  return (
    <div
      className={cn("orb", scale.box, className)}
      data-state={state}
      aria-hidden
    >
      <div className="orb-spin" />
      <div className={cn("orb-core", scale.core)} />
    </div>
  );
}
