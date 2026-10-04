import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Incident, Service, Event } from "../src/domain.ts";
import { createSchema, updateSchema, people } from "../src/domain.ts";

export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function openStore(
  path: string,
  limits = { incidents: 1000, eventsPerIncident: 1000 },
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, team TEXT NOT NULL, region TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS incidents(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL, serviceId TEXT NOT NULL REFERENCES services(id), severity TEXT NOT NULL, assignee TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, incidentId INTEGER NOT NULL REFERENCES incidents(id), body TEXT NOT NULL, createdAt TEXT NOT NULL);`);
  const transaction = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const event = (id: number, body: string, date: string) =>
    db
      .prepare("INSERT INTO events(incidentId,body,createdAt) VALUES(?,?,?)")
      .run(id, body, date);
  if (
    !(db.prepare("SELECT count(*) AS n FROM services").get() as { n: number }).n
  )
    transaction(() => {
      const insert = db.prepare("INSERT INTO services VALUES(?,?,?,?,?)");
      [
        [
          "api",
          "Core API",
          "Request routing and application endpoints",
          "Platform",
          "Multi-region",
        ],
        [
          "auth",
          "Identity",
          "Sessions, access tokens and sign-in",
          "Platform",
          "EU / US",
        ],
        [
          "queue",
          "Event pipeline",
          "Asynchronous jobs and event delivery",
          "Infrastructure",
          "EU West",
        ],
        [
          "storage",
          "Object storage",
          "File uploads and media delivery",
          "Infrastructure",
          "US East",
        ],
        [
          "web",
          "Web application",
          "Customer-facing application shell",
          "Experience",
          "Global edge",
        ],
        [
          "notify",
          "Notifications",
          "Transactional message delivery",
          "Experience",
          "EU West",
        ],
      ].forEach((s) => insert.run(...s));
      const now = Date.now();
      const rows = [
        [
          "Elevated latency on core endpoints",
          "P95 response times increased after a connection pool saturation. Traffic is being shifted to healthy replicas.",
          "api",
          "SEV2",
          "Maya Chen",
          "Investigating",
          48,
        ],
        [
          "Delayed event processing",
          "Consumer lag exceeded the demo threshold. Additional workers are online and the backlog is draining.",
          "queue",
          "SEV3",
          "Theo Martin",
          "Monitoring",
          126,
        ],
        [
          "Intermittent sign-in errors",
          "Token refresh requests returned errors after a configuration change. The configuration was rolled back and verified.",
          "auth",
          "SEV2",
          "Alex Rivera",
          "Resolved",
          1440,
        ],
      ] as const;
      rows.forEach(
        ([
          title,
          description,
          serviceId,
          severity,
          assignee,
          status,
          minutes,
        ]) => {
          const date = new Date(now - minutes * 60000).toISOString();
          const result = db
            .prepare(
              "INSERT INTO incidents(title,description,serviceId,severity,assignee,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              title,
              description,
              serviceId,
              severity,
              assignee,
              status,
              date,
              date,
            );
          event(
            Number(result.lastInsertRowid),
            "Incident opened. " + description,
            date,
          );
          if (status !== "Investigating")
            event(
              Number(result.lastInsertRowid),
              `Status changed to ${status}. ${status === "Resolved" ? "Recovery verified; no further errors observed in the demo window." : "Workers scaled up. Watching queue depth before closing."}`,
              new Date(
                now - (status === "Resolved" ? 1380 : 20) * 60000,
              ).toISOString(),
            );
        },
      );
    });
  function get(id: number): Incident {
    const row = db.prepare("SELECT * FROM incidents WHERE id=?").get(id) as
      Omit<Incident, "events"> | undefined;
    if (!row) throw new DomainError(404, "Incident not found.");
    return {
      ...row,
      events: db
        .prepare("SELECT * FROM events WHERE incidentId=? ORDER BY id DESC")
        .all(id) as Event[],
    };
  }
  return {
    db,
    get,
    snapshot: () => ({
      services: db
        .prepare("SELECT * FROM services ORDER BY rowid")
        .all() as Service[],
      incidents: (
        db.prepare("SELECT id FROM incidents ORDER BY id DESC").all() as {
          id: number;
        }[]
      ).map((row) => get(row.id)),
    }),
    create(input: unknown) {
      const value = createSchema.parse(input);
      return transaction(() => {
        const count = db
          .prepare("SELECT count(*) AS n FROM incidents")
          .get() as { n: number };
        if (count.n >= limits.incidents)
          throw new DomainError(
            409,
            "This demo workspace has reached its incident limit.",
          );
        if (
          !db.prepare("SELECT id FROM services WHERE id=?").get(value.serviceId)
        )
          throw new DomainError(400, "Choose an existing service.");
        const date = new Date().toISOString();
        const result = db
          .prepare(
            "INSERT INTO incidents(title,description,serviceId,severity,assignee,status,createdAt,updatedAt) VALUES(?,?,?,?,?,'Investigating',?,?)",
          )
          .run(
            value.title,
            value.description,
            value.serviceId,
            value.severity,
            value.assignee,
            date,
            date,
          );
        const id = Number(result.lastInsertRowid);
        event(
          id,
          `Incident opened · ${value.severity} · ${value.assignee}. ${value.description}`,
          date,
        );
        return get(id);
      });
    },
    update(id: number, input: unknown) {
      const value = updateSchema.parse(input);
      return transaction(() => {
        const previous = get(id);
        if (previous.events.length >= limits.eventsPerIncident)
          throw new DomainError(
            409,
            "This demo incident has reached its update limit.",
          );
        if (previous.version !== value.version)
          throw new DomainError(
            409,
            "This incident changed in another session. Refresh before saving.",
          );
        const date = new Date().toISOString();
        db.prepare(
          "UPDATE incidents SET status=?,assignee=?,version=version+1,updatedAt=? WHERE id=?",
        ).run(value.status, value.assignee, date, id);
        const changes = [
          previous.status !== value.status
            ? `Status: ${previous.status} → ${value.status}.`
            : "",
          previous.assignee !== value.assignee
            ? `Assigned to ${value.assignee}.`
            : "",
          value.note,
        ]
          .filter(Boolean)
          .join(" ");
        event(id, changes, date);
        return get(id);
      });
    },
    people,
  };
}
