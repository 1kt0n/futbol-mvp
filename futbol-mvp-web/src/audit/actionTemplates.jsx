// Diccionario action -> { icon, tone, render(log) -> JSX }
// Cada template recibe el log enriquecido del backend y devuelve una frase natural.

const bold = (cls) => `font-semibold text-white ${cls || ""}`;
const ital = (cls) => `italic text-white/80 ${cls || ""}`;

const TONES = {
  success: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
  info: "bg-sky-500/20 text-sky-200 border-sky-400/30",
  warn: "bg-amber-500/20 text-amber-200 border-amber-400/30",
  danger: "bg-rose-500/20 text-rose-200 border-rose-400/30",
  neutral: "bg-white/10 text-white/80 border-white/15",
  system: "bg-violet-500/20 text-violet-200 border-violet-400/30",
};

const CATEGORY_LABEL = {
  EVENTO: "Evento",
  CANCHA: "Cancha",
  INSCRIPCION: "Inscripción",
  CAPITAN: "Capitán",
  USUARIO: "Usuario",
  NOTIFICACION: "Notificación",
  SISTEMA: "Sistema",
  OTRO: "Otro",
};

function actorOrSystem(log) {
  return <span className={bold()}>{log.actor?.name || "Sistema"}</span>;
}

function targetName(log) {
  return log.target?.player_name || "un jugador";
}

const TEMPLATES = {
  // ============ EVENTO ============
  CREATE_EVENT: {
    icon: "🆕", tone: "success",
    render: (log) => (
      <>{actorOrSystem(log)} creó el evento <span className={ital()}>{log.event?.title}</span></>
    ),
  },
  CLOSE_EVENT: {
    icon: "🔒", tone: "warn",
    render: (log) => (
      <>{actorOrSystem(log)} cerró el evento <span className={ital()}>{log.event?.title}</span></>
    ),
  },
  REOPEN_EVENT: {
    icon: "🔓", tone: "info",
    render: (log) => (
      <>{actorOrSystem(log)} reabrió el evento <span className={ital()}>{log.event?.title}</span></>
    ),
  },
  FINALIZE_EVENT: {
    icon: "🗄️", tone: "neutral",
    render: (log) => (
      <>{actorOrSystem(log)} finalizó el evento <span className={ital()}>{log.event?.title}</span></>
    ),
  },
  UPDATE_EVENT_VISIBILITY: {
    icon: "🌐", tone: "info",
    render: (log) => (
      <>
        {actorOrSystem(log)} cambió la visibilidad de{" "}
        <span className={ital()}>{log.event?.title}</span>:{" "}
        <span className={bold()}>{log.context.previous_status || "PRIVATE"}</span> →{" "}
        <span className={bold()}>{log.context.next_status || "GLOBAL"}</span>
      </>
    ),
  },
  AUTO_CLOSE_EVENT: {
    icon: "🤖", tone: "system",
    render: (log) => (
      <>
        Sistema cerró automáticamente el evento{" "}
        <span className={ital()}>{log.event?.title}</span> (todas las canchas llenas)
      </>
    ),
  },

  // ============ CANCHA ============
  CREATE_COURT: {
    icon: "🏟️", tone: "success",
    render: (log) => (
      <>
        {actorOrSystem(log)} creó la cancha <span className={ital()}>{log.context.court_name}</span>
        {log.event?.title && <> en <span className={ital()}>{log.event.title}</span></>}
        {log.context.capacity ? <> · {log.context.capacity} cupos</> : null}
      </>
    ),
  },
  UPDATE_COURT: {
    icon: "✏️", tone: "info",
    render: (log) => (
      <>
        {actorOrSystem(log)} editó la cancha{" "}
        <span className={ital()}>{log.context.court_name || "—"}</span>
        {log.event?.title && <> en <span className={ital()}>{log.event.title}</span></>}
      </>
    ),
  },
  DELETE_COURT: {
    icon: "🗑️", tone: "danger",
    render: (log) => (
      <>
        {actorOrSystem(log)} eliminó la cancha{" "}
        <span className={ital()}>{log.context.court_name || "—"}</span>
      </>
    ),
  },
  OPEN_COURT: {
    icon: "🔓", tone: "success",
    render: (log) => (
      <>
        {actorOrSystem(log)} abrió la cancha{" "}
        <span className={ital()}>{log.context.court_name || "—"}</span>
      </>
    ),
  },
  CLOSE_COURT: {
    icon: "🔒", tone: "warn",
    render: (log) => (
      <>
        {actorOrSystem(log)} cerró la cancha{" "}
        <span className={ital()}>{log.context.court_name || "—"}</span>
      </>
    ),
  },
  AUTO_CLOSE_COURT: {
    icon: "🤖", tone: "system",
    render: (log) => (
      <>
        Sistema cerró la cancha{" "}
        <span className={ital()}>{log.context.court_name || "—"}</span> por cupo lleno
      </>
    ),
  },

  // ============ INSCRIPCION ============
  REGISTER_USER: {
    icon: "✅", tone: "success",
    render: (log) => (
      <>
        {actorOrSystem(log)} anotó a <span className={bold()}>{targetName(log)}</span>
        {log.target?.court_name && <> en <span className={ital()}>{log.target.court_name}</span></>}
      </>
    ),
  },
  REGISTER_GUEST: {
    icon: "✅", tone: "success",
    render: (log) => (
      <>
        {actorOrSystem(log)} anotó al invitado <span className={bold()}>{targetName(log)}</span>
        {log.target?.court_name && <> en <span className={ital()}>{log.target.court_name}</span></>}
      </>
    ),
  },
  CANCEL_REGISTRATION: {
    icon: "❌", tone: "danger",
    render: (log) => (
      <>
        {actorOrSystem(log)} dio de baja a <span className={bold()}>{targetName(log)}</span>
        {log.target?.court_name && <> de <span className={ital()}>{log.target.court_name}</span></>}
      </>
    ),
  },
  MOVE_REGISTRATION: {
    icon: "↔️", tone: "info",
    render: (log) => (
      <>
        {actorOrSystem(log)} movió a <span className={bold()}>{targetName(log)}</span>{" "}
        {log.context.from_court_name && (
          <>desde <span className={ital()}>{log.context.from_court_name}</span></>
        )}{" "}
        {log.context.to_court_name && (
          <>a <span className={ital()}>{log.context.to_court_name}</span></>
        )}
      </>
    ),
  },
  PROMOTE_WAITLIST: {
    icon: "⬆️", tone: "system",
    render: (log) => (
      <>
        Sistema promovió a <span className={bold()}>{targetName(log)}</span> desde la lista de espera
        {log.target?.court_name && <> a <span className={ital()}>{log.target.court_name}</span></>}
      </>
    ),
  },

  // ============ CAPITAN ============
  ASSIGN_CAPTAIN: {
    icon: "🎖️", tone: "success",
    render: (log) => (
      <>
        {actorOrSystem(log)} asignó capitán a{" "}
        <span className={bold()}>{log.context.captain_name || "un jugador"}</span>
        {log.context.court_name && <> en <span className={ital()}>{log.context.court_name}</span></>}
      </>
    ),
  },
  REMOVE_CAPTAIN: {
    icon: "🚫", tone: "warn",
    render: (log) => (
      <>
        {actorOrSystem(log)} quitó a{" "}
        <span className={bold()}>{log.context.captain_name || "un jugador"}</span> como capitán
        {log.context.court_name && <> de <span className={ital()}>{log.context.court_name}</span></>}
      </>
    ),
  },

  // ============ USUARIO ============
  CREATE_USER_MANUAL: {
    icon: "👤", tone: "success",
    render: (log) => <>{actorOrSystem(log)} creó un usuario nuevo</>,
  },
  UPDATE_USER_STATUS: {
    icon: "🔁", tone: "info",
    render: (log) => (
      <>
        {actorOrSystem(log)} cambió el estado del usuario:{" "}
        <span className={bold()}>{String(log.context.previous_status ?? "—")}</span> →{" "}
        <span className={bold()}>{String(log.context.next_status ?? "—")}</span>
      </>
    ),
  },
  UPDATE_USER_ROLES: {
    icon: "🛡️", tone: "info",
    render: (log) => <>{actorOrSystem(log)} cambió los roles de un usuario</>,
  },

  // ============ NOTIFICACION ============
  CREATE_NOTIFICATION: {
    icon: "📣", tone: "info",
    render: (log) => (
      <>
        {actorOrSystem(log)} publicó una notificación
        {log.context.expires_in_days ? <> (vence en {log.context.expires_in_days} días)</> : null}
      </>
    ),
  },
  DEACTIVATE_NOTIFICATION: {
    icon: "🔕", tone: "neutral",
    render: (log) => <>{actorOrSystem(log)} desactivó una notificación</>,
  },
};

const DEFAULT_TEMPLATE = {
  icon: "•", tone: "neutral",
  render: (log) => (
    <>
      {actorOrSystem(log)} ejecutó{" "}
      <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs">{log.action}</code>
    </>
  ),
};

export function getTemplate(action) {
  return TEMPLATES[action] || DEFAULT_TEMPLATE;
}

export function toneClass(tone) {
  return TONES[tone] || TONES.neutral;
}

export function categoryLabel(cat) {
  return CATEGORY_LABEL[cat] || cat;
}

export const CATEGORIES = [
  "EVENTO",
  "CANCHA",
  "INSCRIPCION",
  "CAPITAN",
  "USUARIO",
  "NOTIFICACION",
];
