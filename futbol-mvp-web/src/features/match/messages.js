// Mensajes de WhatsApp de la pantalla del partido (rediseño UX §7.7). Sin emojis:
// si quien organiza quiere, los suma en WhatsApp. Los *asteriscos* son la negrita
// de WhatsApp. La clave nunca va en el texto, y el link va al final para que
// WhatsApp arme la vista previa.

import { countedCourts } from "./matchLogic.js";
import { clock, shortDate, slotTitle, spotsLeft } from "./format.js";

export function matchUrl(eventId, origin = window.location.origin) {
  return `${origin}/p/${eventId}`;
}

export function whatsAppHref(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Compartir: lugares por cancha y el link de la app (pide iniciar sesión). */
export function shareMessage(event, courts, link) {
  const title = `*${slotTitle(event.starts_at)}*`;
  const head = event.location_name ? `${title} · ${event.location_name}` : title;
  const lines = [head, `${shortDate(event.starts_at)} · ${clock(event.starts_at)}`];
  const counted = countedCourts(courts);
  const free = counted.filter((c) => c.is_open).reduce((n, c) => n + c.available, 0);
  if (free === 0) {
    lines.push(`Partido completo, anotate en la espera: ${link}`);
    return lines.join("\n");
  }
  if (counted.length) {
    lines.push(
      counted
        .map((c) => `${c.name}: ${c.is_open && c.available > 0 ? spotsLeft(c.available) : "completa"}`)
        .join(" · ")
    );
  }
  lines.push(`Anotate desde la app: ${link}`);
  return lines.join("\n");
}

/** Baja a menos de 24 h: dice quién entra desde la espera, o que se liberó un lugar. */
export function lateDropMessage(event, link, takerName) {
  const title = `Me bajo del *${slotTitle(event.starts_at)}*.`;
  return takerName
    ? `${title} Entra ${takerName} desde la espera: ${link}`
    : `${title} Se liberó un lugar: ${link}`;
}
