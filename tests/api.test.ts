import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { openStore } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { serviceHealth } from "../src/domain.ts";
const valid = {
  title: "Uploads returning errors",
  description: "Upload requests return an unexpected gateway response.",
  serviceId: "storage",
  severity: "SEV1",
  assignee: "Maya Chen",
};
test("public status is an exact allowlist without operator content or internal fields", async () => {
  const store = openStore(":memory:");
  const app = createApp(store);
  try {
    const incident = store.create({
      ...valid,
      title: "Private internal title marker",
      description: "Private infrastructure description marker",
    });
    store.update(incident.id, {
      version: 1,
      status: "Monitoring",
      assignee: "Theo Martin",
      note: "Private operator timeline marker",
    });
    const { body, headers } = await request(app)
      .get("/api/public/status")
      .expect(200);
    assert.deepEqual(Object.keys(body).sort(), ["incidents", "services"]);
    for (const service of body.services)
      assert.deepEqual(Object.keys(service).sort(), ["health", "id", "name"]);
    for (const row of body.incidents)
      assert.deepEqual(Object.keys(row).sort(), [
        "id",
        "serviceId",
        "status",
        "summary",
        "title",
        "updatedAt",
      ]);
    const publicIncident = body.incidents.find(
      (row: { id: number }) => row.id === incident.id,
    );
    assert.equal(publicIncident.title, "Object storage incident");
    assert.equal(publicIncident.status, "Monitoring");
    assert.equal(
      publicIncident.summary,
      "A recovery is being monitored before the incident is closed.",
    );
    assert.equal(
      body.services.find((row: { id: string }) => row.id === "storage").health,
      "Major outage",
    );
    assert.doesNotMatch(
      JSON.stringify(body),
      /Private|Maya Chen|Theo Martin|Alex Rivera|assignee|description|version|events|team|region|createdAt/,
    );
    assert.equal(headers["cache-control"], "no-store");
    const internal = await request(app).get("/api/snapshot").expect(200);
    assert.match(
      JSON.stringify(internal.body),
      /Private operator timeline marker/,
    );
  } finally {
    store.db.close();
  }
});
test("create, update, timeline and derived health persist across database reopen", async () => {
  const folder = mkdtempSync(join(tmpdir(), "relay-test-"));
  const path = join(folder, "test.sqlite");
  const store = openStore(path);
  const app = createApp(store);
  try {
    const created = await request(app)
      .post("/api/incidents")
      .send(valid)
      .expect(201);
    assert.equal(
      serviceHealth("storage", store.snapshot().incidents),
      "Major outage",
    );
    const update = {
      version: 1,
      status: "Resolved",
      assignee: "Theo Martin",
      note: "Rollback verified and uploads are responding normally.",
    };
    const changed = await request(app)
      .patch(`/api/incidents/${created.body.id}`)
      .send(update)
      .expect(200);
    assert.equal(changed.body.version, 2);
    assert.equal(changed.body.events.length, 2);
    assert.match(changed.body.events[0].body, /Assigned to Theo Martin/);
    assert.equal(
      serviceHealth("storage", store.snapshot().incidents),
      "Operational",
    );
    await request(app)
      .patch(`/api/incidents/${created.body.id}`)
      .send(update)
      .expect(409);
    assert.equal(store.get(created.body.id).events.length, 2);
    store.db.close();
    const reopened = openStore(path);
    assert.equal(reopened.get(created.body.id).status, "Resolved");
    assert.equal(reopened.get(created.body.id).events.length, 2);
    reopened.db.close();
  } finally {
    try {
      store.db.close();
    } catch {
      /* already closed */
    }
    rmSync(folder, { recursive: true, force: true });
  }
});
test("server rejects invalid payloads, unknown references and malformed JSON without writes", async () => {
  const store = openStore(":memory:");
  const app = createApp(store);
  const count = store.snapshot().incidents.length;
  try {
    for (const patch of [
      { title: " " },
      { severity: "SEV0" },
      { serviceId: "missing" },
      { assignee: "unknown" },
      { extra: "field" },
      { description: "short" },
    ])
      await request(app)
        .post("/api/incidents")
        .send({ ...valid, ...patch })
        .expect(400);
    await request(app)
      .post("/api/incidents")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);
    await request(app)
      .patch("/api/incidents/9999")
      .send({
        version: 1,
        status: "Resolved",
        assignee: "Maya Chen",
        note: "Verified recovery",
      })
      .expect(404);
    await request(app).patch("/api/incidents/nope").send({}).expect(400);
    assert.equal(store.snapshot().incidents.length, count);
  } finally {
    store.db.close();
  }
});
test("concurrent editors cannot overwrite a newer response", async () => {
  const store = openStore(":memory:");
  const app = createApp(store);
  try {
    const id = store.create(valid).id;
    const responses = await Promise.all(
      ["Maya Chen", "Theo Martin"].map((assignee) =>
        request(app).patch(`/api/incidents/${id}`).send({
          version: 1,
          status: "Identified",
          assignee,
          note: "Investigating the root cause.",
        }),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(store.get(id).events.length, 2);
  } finally {
    store.db.close();
  }
});
