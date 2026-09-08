import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "node:path";
import { GUEST_ROOM, openDb, type Message } from "./db.ts";

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const ORIGINS = (process.env.CORS_ORIGIN ?? "https://chat.jdump.com,http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((s) => s.trim());
const db = openDb(DATA_DIR);

const sockets = new Set<{ send: (data: string) => void }>();

function clientIp(c: { req: { header: (n: string) => string | undefined } }) {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "local"
  );
}

function broadcast(msg: Message) {
  const payload = JSON.stringify({ type: "message", message: msg });
  for (const ws of sockets) {
    try {
      ws.send(payload);
    } catch {
      sockets.delete(ws);
    }
  }
}

const app = new Hono();
app.use("/api/*", cors({ origin: ORIGINS, allowMethods: ["GET", "POST"] }));
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/api/health", (c) => c.json({ ok: true, origin: "vps" }));

app.get("/api/messages", (c) => c.json({ messages: db.history(GUEST_ROOM) }));

app.post("/api/messages", async (c) => {
  let body: { sender?: string; body?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const sender = (body.sender ?? "").trim().slice(0, 24);
  const text = (body.body ?? "").trim().slice(0, 2000);
  if (!sender || !text) return c.json({ error: "sender and body required" }, 400);

  const quota = db.consumeGuest(clientIp(c));
  if (!quota.ok) {
    const mins = Math.ceil(quota.retryAfterMs / 60000);
    return c.json({ error: `guest limit: wait ${mins} min`, retryAfterMs: quota.retryAfterMs }, 429);
  }

  const msg: Message = {
    id: crypto.randomUUID(),
    roomId: GUEST_ROOM,
    sender,
    body: text,
    createdAt: Date.now(),
  };
  db.add(msg);
  broadcast(msg);
  return c.json({ message: msg, left: quota.left }, 201);
});

app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_evt, ws) {
      sockets.add(ws);
      ws.send(JSON.stringify({ type: "history", messages: db.history(GUEST_ROOM) }));
    },
    onClose(_evt, ws) {
      sockets.delete(ws);
    },
    onError(_evt, ws) {
      sockets.delete(ws);
    },
  })),
);

const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
injectWebSocket(server);
console.log(`api on :${PORT}  data=${DATA_DIR}`);
