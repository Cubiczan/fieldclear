import { FieldConsole } from "@/components/console/field-console";
import { plannerStatus } from "@/lib/agent/mode";
import { seedAuditSnapshot } from "@/lib/data/store";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <FieldConsole initialAudit={seedAuditSnapshot()} planner={plannerStatus()} />;
}
