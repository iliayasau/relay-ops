import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../server/app.ts";
import { createDemo } from "../server/demo.ts";
import { openStore, DomainError } from "../server/store.ts";
const origin = "http://demo.test";
const incident = {
  title: "Only this visitor sees this title",
  description: "A fictional issue for an isolated demo session.",
  serviceId: "api",
  severity: "SEV2",
  assignee: "Maya Chen",
};
const update = {
  version: 1,
  status: "Resolved",
  assignee: "Theo Martin",
  note: "Recovery verified in this isolated workspace.",
};

test("visitor stores persist on reload and cannot read or modify another visitor incident", async (t) => {
  const demo = createDemo({ origin });
  t.after(() => demo.close());
  const app = createApp(undefined, demo);
  const alice = request.agent(app);
  const bob = request.agent(app);
  await alice.get("/api/snapshot").expect(200);
  const created = await alice
    .post("/api/incidents")
    .set("Origin", origin)
    .send(incident)
    .expect(201);
  assert.equal((await alice.get("/api/snapshot")).body.incidents.length, 4);
  const other = await bob.get("/api/snapshot").expect(200);
  assert.equal(other.body.incidents.length, 3);
  await bob
    .patch(`/api/incidents/${created.body.id}`)
    .set("Origin", origin)
    .send(update)
    .expect(404);
  const firstStatus = await alice.get("/api/public/status").expect(200);
  const secondStatus = await bob.get("/api/public/status").expect(200);
  assert.equal(firstStatus.body.incidents.length, 4);
  assert.equal(secondStatus.body.incidents.length, 3);
  assert.doesNotMatch(
    JSON.stringify(firstStatus.body),
    /Only this visitor|Maya Chen|version|events/,
  );
  const changed = await alice
    .patch(`/api/incidents/${created.body.id}`)
    .set("Origin", origin)
    .send(update)
    .expect(200);
  assert.equal(changed.body.status, "Resolved");
  assert.equal(
    (await alice.get("/api/snapshot")).body.incidents.find(
      (i: { id: number }) => i.id === created.body.id,
    ).status,
    "Resolved",
  );
});

test("mutations require an existing cookie, exact Origin and JSON; cross-site reads are rejected", async (t) => {
  const demo = createDemo({ origin });
  t.after(() => demo.close());
  const app = createApp(undefined, demo);
  const visitor = request.agent(app);
  await request(app)
    .post("/api/incidents")
    .set("Origin", origin)
    .send(incident)
    .expect(409);
  await visitor.get("/api/snapshot").expect(200);
  for (const malicious of ["https://evil.test", "null", origin + ".evil.test"])
    await visitor
      .post("/api/incidents")
      .set("Origin", malicious)
      .send(incident)
      .expect(403);
  await visitor.post("/api/incidents").send(incident).expect(403);
  await visitor
    .post("/api/incidents")
    .set("Origin", origin)
    .type("form")
    .send(incident)
    .expect(415);
  await visitor
    .post("/api/incidents")
    .set("Origin", origin)
    .send({ ...incident, description: "a".repeat(17000) })
    .expect(413);
  await visitor
    .get("/api/snapshot")
    .set("Sec-Fetch-Site", "cross-site")
    .expect(403);
  await visitor
    .post("/api/incidents")
    .set("Origin", origin)
    .set("Sec-Fetch-Site", "cross-site")
    .send(incident)
    .expect(403);
  assert.equal((await visitor.get("/api/snapshot")).body.incidents.length, 3);
});

test("secure cookies are opaque, host-only and short-lived; caller tokens cannot fix a session", async (t) => {
  const demo = createDemo({ origin: "https://demo.test" });
  t.after(() => demo.close());
  const app = createApp(undefined, demo);
  const forged = "a".repeat(64);
  const response = await request(app)
    .get("/api/snapshot")
    .set("Cookie", `__Host-relay_demo=${forged}`)
    .expect(200);
  const cookie = response.headers["set-cookie"][0];
  assert.match(cookie, /^__Host-relay_demo=[a-f0-9]{64};/);
  assert.doesNotMatch(cookie, new RegExp(forged));
  for (const attribute of [
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=3600",
  ])
    assert.ok(cookie.includes(attribute));
  assert.doesNotMatch(cookie, /Domain=/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.headers.vary, /Cookie/);
});

test("expired sessions fail writes explicitly and a refresh returns fresh fixtures", async (t) => {
  let now = 1000;
  const demo = createDemo({
    origin,
    now: () => now,
    ttlMs: 1000,
    maxSessions: 1,
  });
  t.after(() => demo.close());
  const app = createApp(undefined, demo);
  const visitor = request.agent(app);
  await visitor.get("/api/snapshot");
  await visitor
    .post("/api/incidents")
    .set("Origin", origin)
    .send(incident)
    .expect(201);
  await request(app).get("/api/snapshot").expect(503);
  now += 1001;
  await visitor
    .post("/api/incidents")
    .set("Origin", origin)
    .send(incident)
    .expect(409);
  const fresh = await visitor.get("/api/snapshot").expect(200);
  assert.equal(fresh.body.incidents.length, 3);
});

test("rate limits return retry guidance, reset by window and leave health checks available", async (t) => {
  let now = 1000;
  const demo = createDemo({
    origin,
    now: () => now,
    writesPerMinute: 1,
    requestsPerMinute: 5,
  });
  t.after(() => demo.close());
  const app = createApp(undefined, demo);
  const visitor = request.agent(app);
  await visitor.get("/api/snapshot").expect(200);
  await visitor
    .post("/api/incidents")
    .set("Origin", origin)
    .send(incident)
    .expect(201);
  const limited = await visitor
    .post("/api/incidents")
    .set("Origin", origin)
    .send(incident)
    .expect(429);
  assert.equal(limited.headers["retry-after"], "60");
  await visitor.get("/api/snapshot");
  await visitor.get("/api/snapshot");
  await visitor.get("/api/snapshot").expect(429);
  const health = await request(app).get("/healthz").expect(200);
  assert.equal(health.headers["set-cookie"], undefined);
  now += 60000;
  await visitor
    .post("/api/incidents")
    .set("Origin", origin)
    .send(incident)
    .expect(201);
});

test("fresh-session creation is bounded independently of session-cookie resets", async (t) => {
  const demo = createDemo({ origin, sessionsPerMinute: 1 });
  t.after(() => demo.close());
  const app = createApp(undefined, demo);
  await request(app).get("/api/snapshot").expect(200);
  await request(app).get("/api/snapshot").expect(429);
  await request(app).get("/healthz").expect(200);
});

test("storage caps reject growth atomically without extra events", () => {
  const store = openStore(":memory:", { incidents: 4, eventsPerIncident: 2 });
  try {
    const created = store.create(incident);
    assert.throws(
      () => store.create(incident),
      (e) => e instanceof DomainError && e.status === 409,
    );
    store.update(created.id, update);
    assert.throws(
      () => store.update(created.id, { ...update, version: 2 }),
      (e) => e instanceof DomainError && e.status === 409,
    );
    assert.equal(store.snapshot().incidents.length, 4);
    assert.equal(store.get(created.id).events.length, 2);
    assert.equal(store.get(created.id).version, 2);
  } finally {
    store.db.close();
  }
});
