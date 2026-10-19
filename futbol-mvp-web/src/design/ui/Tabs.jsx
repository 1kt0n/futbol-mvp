import { cn } from "../cn.js";

// Con `idBase`, cada pestaña (id `${idBase}-tab-${item.id}`) apunta a un único panel
// `${idBase}-panel` que renderiza quien usa Tabs, con role="tabpanel" y
// aria-labelledby con el id de la pestaña activa.
export function Tabs({ value, onChange, items, className = "", testId = "", label = "", idBase = "" }) {
  return (
    <div className={cn("overflow-x-auto", className)} data-testid={testId || undefined}>
      <div
        role="tablist"
        aria-label={label || undefined}
        className="inline-flex min-w-full gap-2 rounded-2xl border border-white/10 bg-black/20 p-1 md:min-w-0 md:justify-center"
      >
        {items.map((item) => {
          const active = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              id={idBase ? `${idBase}-tab-${item.id}` : undefined}
              data-testid={item.testId}
              aria-selected={active}
              aria-controls={idBase ? `${idBase}-panel` : undefined}
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
