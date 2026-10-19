// Barra de navegación inferior (rediseño UX, iteración 1b).
// Partido · Calendario · Avisos · Gestión (solo con permisos de panel) · Perfil.
// Va fija abajo, respeta el safe-area del iPhone y queda debajo de hojas,
// diálogos y toasts (z-tabbar en la escala de src/design/tokens.css).

import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "../design/cn.js";

const ICONS = {
  ball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5l3.8 2.8-1.5 4.4H9.7l-1.5-4.4z" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.8" />
      <rect x="13" y="4" width="7" height="7" rx="1.8" />
      <rect x="4" y="13" width="7" height="7" rx="1.8" />
      <rect x="13" y="13" width="7" height="7" rx="1.8" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
};

function NavIcon({ name, className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

export default function BottomNav({ isAdmin = false, avisos = 0, gestion = 0 }) {
  const { pathname } = useLocation();
  const items = [
    // La pantalla del partido (/p/:id) también es la pestaña Partido.
    { to: "/", label: "Partido", icon: "ball", end: true, alsoActive: "/p/", testid: "nav-partido" },
    { to: "/calendar", label: "Calendario", icon: "calendar", testid: "open-calendar" },
    { to: "/avisos", label: "Avisos", icon: "bell", badge: avisos, srBadge: "sin leer", testid: "nav-avisos" },
    ...(isAdmin
      ? [{ to: "/admin", label: "Gestión", icon: "grid", badge: gestion, srBadge: "pendientes", testid: "open-admin-panel" }]
      : []),
    { to: "/profile", label: "Perfil", icon: "user", testid: "nav-perfil" },
  ];

  // Con la barra a la vista, los toasts suben para no taparla (--toast-bottom).
  useEffect(() => {
    document.documentElement.setAttribute("data-tabbar", "");
    return () => document.documentElement.removeAttribute("data-tabbar");
  }, []);

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-tabbar border-t border-white/10 bg-zinc-950/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((it) => {
          // Mismo criterio que NavLink (end = ruta exacta), más alsoActive.
          const isActive =
            (it.end ? pathname === it.to : pathname === it.to || pathname.startsWith(`${it.to}/`)) ||
            Boolean(it.alsoActive && pathname.startsWith(it.alsoActive));
          return (
            <li key={it.to} className="flex-1">
              <Link
                to={it.to}
                data-testid={it.testid}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "focus-ring flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 pb-1 pt-1.5 text-[11px] font-medium transition-colors",
                  isActive ? "text-white" : "text-white/55 hover:text-white/80"
                )}
              >
                <span className="relative">
                  <NavIcon name={it.icon} className={cn("h-6 w-6", isActive && "text-emerald-400")} />
                  {it.badge > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-2.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white"
                    >
                      {it.badge > 99 ? "99+" : it.badge}
                    </span>
                  )}
                </span>
                <span>
                  {it.label}
                  {it.badge > 0 && <span className="sr-only">{`, ${it.badge} ${it.srBadge}`}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
