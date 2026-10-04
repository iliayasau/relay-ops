import express from "express";
import { resolve } from "node:path";
import { createApp } from "./app.ts";
import { openStore } from "./store.ts";
const store = openStore(process.env.DATABASE_PATH || "data/relay.sqlite");
const app = createApp(store);
if (process.argv.includes("--production")) {
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
const server = app.listen(Number(process.env.PORT || 3000), "127.0.0.1", () =>
  console.log("Relay Ops: http://127.0.0.1:" + (process.env.PORT || 3000)),
);
process.on("SIGTERM", () =>
  server.close(() => {
    store.db.close();
    process.exit(0);
  }),
);
