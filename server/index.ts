import express from "express";
import { resolve } from "node:path";
import { createApp } from "./app.ts";
import { openStore } from "./store.ts";
import { createDemo } from "./demo.ts";
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be between 1 and 65535.");
const publicDemo = process.env.DEMO_MODE === "public";
if (!publicDemo && !["127.0.0.1", "localhost", "::1"].includes(host))
  throw new Error("External binding requires DEMO_MODE=public.");
const origin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
if (publicDemo && !origin)
  throw new Error("Public demo requires PUBLIC_ORIGIN or RENDER_EXTERNAL_URL.");
const demo = publicDemo ? createDemo({ origin: origin! }) : undefined;
const store = publicDemo
  ? undefined
  : openStore(process.env.DATABASE_PATH || "data/relay.sqlite");
const app = createApp(store, demo);
if (process.argv.includes("--production")) {
  app.use((_req, res, next) => {
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    next();
  });
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, host, () =>
  console.log(
    `Relay Ops: http://${host}:${port} (${publicDemo ? "isolated public demo" : "local workspace"})`,
  ),
);
const shutdown = () =>
  server.close(() => {
    demo?.close();
    store?.db.close();
    process.exit(0);
  });
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
