import type { Incident } from "./domain";

export type PublicStatus = {
  services: {
    id: string;
    name: string;
    health: "Operational" | "Degraded" | "Major outage";
  }[];
  incidents: {
    id: number;
    serviceId: string;
    title: string;
    status: Incident["status"];
    summary: string;
    updatedAt: string;
  }[];
};
