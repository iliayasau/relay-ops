import { z } from "zod";
export const statuses = [
  "Investigating",
  "Identified",
  "Monitoring",
  "Resolved",
] as const;
export const severities = ["SEV1", "SEV2", "SEV3"] as const;
export const people = [
  "Unassigned",
  "Maya Chen",
  "Theo Martin",
  "Alex Rivera",
] as const;
export const createSchema = z
  .object({
    title: z.string().trim().min(8).max(120),
    description: z.string().trim().min(15).max(2000),
    serviceId: z.string().min(1),
    severity: z.enum(severities),
    assignee: z.enum(people),
  })
  .strict();
export const updateSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(statuses),
    assignee: z.enum(people),
    note: z.string().trim().min(5).max(2000),
  })
  .strict();
export type Service = {
  id: string;
  name: string;
  description: string;
  team: string;
  region: string;
};
export type Event = {
  id: number;
  incidentId: number;
  body: string;
  createdAt: string;
};
export type Incident = z.infer<typeof createSchema> & {
  id: number;
  status: (typeof statuses)[number];
  version: number;
  createdAt: string;
  updatedAt: string;
  events: Event[];
};
export type Snapshot = {
  services: Service[];
  incidents: Incident[];
  demo?: { mode: "public"; expiresAt: string };
};
export function serviceHealth(id: string, incidents: Incident[]) {
  const active = incidents.filter(
    (i) => i.serviceId === id && i.status !== "Resolved",
  );
  return active.some((i) => i.severity === "SEV1")
    ? "Major outage"
    : active.length
      ? "Degraded"
      : "Operational";
}
