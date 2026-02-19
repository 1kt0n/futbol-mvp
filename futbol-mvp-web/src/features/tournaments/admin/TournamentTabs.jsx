import { Tabs } from "../../../design/ui/Tabs.jsx";

const ITEMS = [
  { id: "overview", label: "Resumen", testId: "tournament-tab-overview" },
  { id: "teams", label: "Equipos", testId: "tournament-tab-teams" },
  { id: "fixture", label: "Fixture", testId: "tournament-tab-fixture" },
  { id: "standings", label: "Tabla", testId: "tournament-tab-standings" },
  { id: "share", label: "Compartir", testId: "tournament-tab-share" },
];

export default function TournamentTabs({ activeTab, onChange }) {
  return <Tabs value={activeTab} onChange={onChange} items={ITEMS} testId="tournament-tabs" />;
}

