import { serviceHealth, type Snapshot } from "../src/domain.ts";
import type { PublicStatus } from "../src/public-status.ts";

const summaries = {
  Investigating: "We are investigating a service disruption.",
  Identified: "The cause has been identified. Recovery work is in progress.",
  Monitoring: "A recovery is being monitored before the incident is closed.",
  Resolved: "The incident has been resolved.",
} as const;

// Construct an explicit allowlist. Operator-authored text never crosses this boundary.
export function publicStatus(snapshot: Snapshot): PublicStatus {
  return {
    services: snapshot.services.map((service) => ({
      id: service.id,
      name: service.name,
      health: serviceHealth(service.id, snapshot.incidents),
    })),
    incidents: snapshot.incidents.map((incident) => ({
      id: incident.id,
      serviceId: incident.serviceId,
      title: `${snapshot.services.find((service) => service.id === incident.serviceId)?.name ?? "Service"} incident`,
      status: incident.status,
      summary: summaries[incident.status],
      updatedAt: incident.updatedAt,
    })),
  };
}
