import { cn } from "~/lib/utils";

type Status = "idle" | "busy" | "ok" | "error";

// The VOSS lockup is a wordmark plus an orange square, so it is reproduced in
// type rather than shipped as an SVG — one less asset to load on the one page
// that must render on a bad campus connection.
//
// The square doubles as the status light. It is the only element that changes
// colour anywhere in the flow, which is what makes it readable at a glance.
export function VossMark({
  status = "idle",
  className,
}: {
  status?: Status;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline gap-[5px]", className)}>
      <span className="text-[28px] leading-none font-black tracking-[-0.03em] select-none">
        VOSS
      </span>
      <span
        aria-hidden
        className={cn(
          "size-[10px] shrink-0 transition-colors duration-300",
          status === "idle" && "bg-primary",
          status === "busy" && "bg-primary animate-pulse",
          status === "ok" && "bg-emerald-500",
          status === "error" && "bg-destructive"
        )}
      />
    </div>
  );
}
