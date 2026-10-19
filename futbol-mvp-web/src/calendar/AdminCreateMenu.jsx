import { useNavigate } from "react-router-dom";
import { ActionSheet } from "../design/ui/overlay/index.js";

export default function AdminCreateMenu({ open, onClose, onCreateAnnouncement }) {
  const navigate = useNavigate();

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Agregar al calendario"
      description="Elegí qué querés crear."
      testId="calendar-create-menu"
      items={[
        {
          label: "Anuncio informativo",
          hint: "Fechas importantes, cierres de inscripción, recordatorios. No requiere anotarse.",
          icon: "📢",
          testId: "calendar-create-announcement",
          onSelect: () => onCreateAnnouncement?.(),
        },
        {
          label: "Evento de cancha",
          hint: "Creás un evento con canchas y cupos. Después marcalo como visible para todos.",
          icon: "⚽",
          testId: "calendar-create-event",
          onSelect: () => navigate("/admin?focus=eventos&create=1"),
        },
      ]}
    />
  );
}
