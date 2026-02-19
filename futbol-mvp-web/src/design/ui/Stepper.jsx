import { cn } from "../cn.js";

export default function Stepper({ steps, activeStep, completedSet = new Set(), testId = "" }) {
  return (
    <div className="overflow-x-auto" data-testid={testId || undefined}>
      <ol className="flex min-w-max items-center gap-3">
        {steps.map((step, idx) => {
          const completed = completedSet.has(step.key);
          const active = step.key === activeStep;
          return (
            <li key={step.key} className="flex items-center gap-3">
              <div
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold",
                  completed && "border-emerald-300/50 bg-emerald-500/20 text-emerald-200",
                  active && "border-amber-300/60 bg-amber-500/20 text-amber-200",
                  !completed && !active && "border-white/20 bg-white/5 text-white/60"
                )}
              >
                {idx + 1}
              </div>
              <span className={cn("text-sm", active ? "text-white" : "text-white/70")}>{step.label}</span>
              {idx !== steps.length - 1 && <span className="h-px w-8 bg-white/15" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

