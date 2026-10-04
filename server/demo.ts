import { randomBytes } from "node:crypto";
import { mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { DomainError, openStore } from "./store.ts";

type Store = ReturnType<typeof openStore>;
type Session = {
  store: Store;
  expires: number;
  path: string;
  reads: Budget;
  writes: Budget;
};
type Budget = { start: number; count: number };
export type DemoOptions = {
  origin: string;
  now?: () => number;
  ttlMs?: number;
  maxSessions?: number;
  requestsPerMinute?: number;
  writesPerMinute?: number;
  sessionsPerMinute?: number;
};

export function createDemo(options: DemoOptions) {
  const url = new URL(options.origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.origin !== options.origin
  )
    throw new Error(
      "PUBLIC_ORIGIN must be an exact http(s) origin, without a path or trailing slash.",
    );
  const secure = url.protocol === "https:";
  const cookieName = secure ? "__Host-relay_demo" : "relay_demo";
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? 60 * 60 * 1000;
  const folder = mkdtempSync(join(tmpdir(), "relay-demo-"));
  const sessions = new Map<string, Session>();
  const globalBudget = { start: now(), count: 0 };
  const creationBudget = { start: now(), count: 0 };
  function consume(budget: Budget, limit: number, res: Response) {
    if (now() - budget.start >= 60000) {
      budget.start = now();
      budget.count = 0;
    }
    if (budget.count >= limit) {
      res.set(
        "Retry-After",
        String(Math.max(1, Math.ceil((60000 - (now() - budget.start)) / 1000))),
      );
      throw new DomainError(
        429,
        "The demo is busy. Please wait a minute and try again.",
      );
    }
    budget.count++;
  }
  function remove(id: string, session: Session) {
    session.store.db.close();
    for (const path of [
      session.path,
      session.path + "-wal",
      session.path + "-shm",
    ]) {
      try {
        unlinkSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    sessions.delete(id);
  }
  function sweep() {
    for (const [id, session] of sessions)
      if (session.expires <= now()) remove(id, session);
  }
  const timer = setInterval(sweep, 60000);
  timer.unref();
  return {
    resolve(req: Request, res: Response): Store {
      res.vary("Cookie");
      consume(globalBudget, options.requestsPerMinute ?? 300, res);
      const mutation = req.method !== "GET" && req.method !== "HEAD";
      if (req.get("Sec-Fetch-Site") === "cross-site")
        throw new DomainError(403, "Cross-site requests are not allowed.");
      if (mutation && req.get("Origin") !== options.origin)
        throw new DomainError(
          403,
          "Open this demo in its own browser tab before saving.",
        );
      if (mutation && !req.is("application/json"))
        throw new DomainError(415, "Use application/json for demo updates.");
      sweep();
      const cookie = (req.headers.cookie ?? "")
        .split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1);
      let session =
        cookie && /^[a-f0-9]{64}$/.test(cookie)
          ? sessions.get(cookie)
          : undefined;
      if (!session) {
        if (mutation)
          throw new DomainError(
            409,
            "Your demo session expired. Refresh to start a fresh workspace.",
          );
        if (!["/api/snapshot", "/api/public/status"].includes(req.path))
          throw new DomainError(404, "Endpoint not found.");
        consume(creationBudget, options.sessionsPerMinute ?? 30, res);
        if (sessions.size >= (options.maxSessions ?? 50)) {
          res.set("Retry-After", "60");
          throw new DomainError(
            503,
            "All demo workspaces are in use. Please try again later.",
          );
        }
        const id = randomBytes(32).toString("hex");
        const path = join(folder, id + ".sqlite");
        session = {
          store: openStore(path, { incidents: 20, eventsPerIncident: 25 }),
          path,
          expires: now() + ttl,
          reads: { start: now(), count: 0 },
          writes: { start: now(), count: 0 },
        };
        sessions.set(id, session);
        res.cookie(cookieName, id, {
          httpOnly: true,
          secure,
          sameSite: "lax",
          maxAge: ttl,
          path: "/",
        });
      }
      consume(
        mutation ? session.writes : session.reads,
        mutation ? (options.writesPerMinute ?? 20) : 120,
        res,
      );
      res.locals.demo = {
        mode: "public",
        expiresAt: new Date(session.expires).toISOString(),
      };
      return session.store;
    },
    close() {
      clearInterval(timer);
      for (const [id, session] of sessions) remove(id, session);
      rmdirSync(folder);
    },
  };
}
