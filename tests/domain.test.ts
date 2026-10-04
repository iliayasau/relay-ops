import { test } from "node:test";
import assert from "node:assert/strict";
import { serviceHealth, createSchema, type Incident } from "../src/domain.ts";
test("health uses the highest unresolved severity only for the matching service", () => {
  const incident = {
    serviceId: "api",
    severity: "SEV2",
    status: "Monitoring",
  } as Incident;
  assert.equal(serviceHealth("api", [incident]), "Degraded");
  assert.equal(serviceHealth("auth", [incident]), "Operational");
  assert.equal(
    serviceHealth("api", [incident, { ...incident, severity: "SEV1" }]),
    "Major outage",
  );
  assert.equal(
    serviceHealth("api", [
      { ...incident, severity: "SEV1", status: "Resolved" },
    ]),
    "Operational",
  );
});
test("input normalization trims user text and enforces size boundaries", () => {
  const data = {
    title: "  Elevated request latency  ",
    description: "  Affected requests are being investigated.  ",
    serviceId: "api",
    severity: "SEV2",
    assignee: "Unassigned",
  };
  assert.equal(createSchema.parse(data).title, "Elevated request latency");
  assert.equal(
    createSchema.safeParse({ ...data, title: "x".repeat(121) }).success,
    false,
  );
  assert.equal(
    createSchema.safeParse({ ...data, description: " ".repeat(20) }).success,
    false,
  );
});
