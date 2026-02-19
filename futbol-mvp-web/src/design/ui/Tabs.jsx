import { cn } from "../cn.js";

export function Tabs({ value, onChange, items, className = "", testId = "" }) {
  return (
    <div className={cn("overflow-x-auto", className)} data-testid={testId || undefined}>
      <div className="inline-flex min-w-full gap-2 rounded-2xl border border-white/10 bg-black/20 p-1 md:min-w-0 md:justify-center">
        {items.map((item) => {
          const active = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={item.testId}
              aria-selected={active}
              role="tab"
              onClick={() => onChange(item.id)}
              className={cn(
                "focus-ring whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition",
                active
                  ? "bg-white text-black"
                  : "text-white/75 hover:bg-white/10 hover:text-white"
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

