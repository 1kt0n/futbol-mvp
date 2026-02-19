import Stepper from "../../../design/ui/Stepper.jsx";

const steps = [
  { key: "config", label: "Configuracion" },
  { key: "teams", label: "Equipos" },
  { key: "fixture", label: "Fixture" },
  { key: "publish", label: "Publicar" },
];

export default function TournamentDraftStepper({ visible, stage }) {
  if (!visible) return null;

  const completedSet = new Set();
  if (["teams", "fixture", "publish"].includes(stage)) completedSet.add("config");
  if (["fixture", "publish"].includes(stage)) completedSet.add("teams");
  if (["publish"].includes(stage)) completedSet.add("fixture");

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3" data-testid="tournament-draft-stepper">
      <Stepper steps={steps} activeStep={stage} completedSet={completedSet} />
    </div>
  );
}

