import express from "express";
import { ZodError } from "zod";
import { DomainError, openStore } from "./store.ts";
import { publicStatus } from "./public-status.ts";
import type { createDemo } from "./demo.ts";
export function createApp(
  store?: ReturnType<typeof openStore>,
  demo?: ReturnType<typeof createDemo>,
) {
  if (!store && !demo)
    throw new Error("A local store or isolated demo is required.");
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/"))
      res.locals.store = demo ? demo.resolve(req, res) : store;
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  const requestStore = (res: express.Response) =>
    res.locals.store as ReturnType<typeof openStore>;
  app.get("/api/snapshot", (_req, res) =>
    res.json({
      ...requestStore(res).snapshot(),
      ...(res.locals.demo ? { demo: res.locals.demo } : {}),
    }),
  );
  app.get("/api/public/status", (_req, res) =>
    res.json(publicStatus(requestStore(res).snapshot())),
  );
  app.post("/api/incidents", (req, res) => {
    res.status(201).json(requestStore(res).create(req.body));
  });
  app.patch("/api/incidents/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1)
      throw new DomainError(400, "Invalid incident identifier.");
    res.json(requestStore(res).update(id, req.body));
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Endpoint not found." });
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
        return;
      }
      if (error instanceof DomainError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: "Request must contain valid JSON." });
        return;
      }
      if (
        typeof error === "object" &&
        error &&
        "status" in error &&
        error.status === 413
      ) {
        res.status(413).json({ error: "Request body is too large." });
        return;
      }
      console.error(error);
      res
        .status(500)
        .json({ error: "Unable to save changes. Please try again." });
    },
  );
  return app;
}
