import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { getMigrations } from "better-auth/db/migration";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "node:path";
import { auth } from "./auth.ts";
import {
  GUEST_COOLDOWN_MS,
  GUEST_LIMIT,
  GUEST_ROOM,
  GUEST_TTL_MS,
  GUEST_WINDOW_MS,
  openDb,
  type Message,
} from "./db.ts";

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const ORIGINS = (
  process.env.CORS_ORIGIN ?? "https://chat.jdump.com,http://localhost:5173,http://127.0.0.1:5173"
)
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
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`[API] ${c.req.method} ${c.req.path} → ${c.res.status} (${Date.now() - start}ms)`);
});
app.use(
  "/api/*",
  cors({
    origin: ORIGINS,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get("/api/health", (c) => c.json({ ok: true, origin: "vps" }));

app.get("/api/me", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const nick = db.getNick(session.user.id) || session.user.name?.trim().slice(0, 24) || "";
  return c.json({ nick, name: session.user.name });
});

app.post("/api/nick", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  let body: { nick?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const nick = (body.nick ?? "").trim().slice(0, 24);
  if (!nick) return c.json({ error: "nick required" }, 400);
  db.setNick(session.user.id, nick);
  return c.json({ nick });
});

app.get("/api/messages", (c) => c.json({ messages: db.history(GUEST_ROOM) }));

app.post("/api/messages", async (c) => {
  const start = performance.now();
  let body: { sender?: string; body?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  console.log(`[API] JSON parsed: ${(performance.now() - start).toFixed(1)}ms`);

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const sender = ((session ? db.getNick(session.user.id) || session.user.name : body.sender) || "")
    .trim()
    .slice(0, 24);
  const text = (body.body ?? "").trim().slice(0, 2000);
  if (!sender || !text) return c.json({ error: "sender and body required" }, 400);

  let left = -1;
  if (!session) {
    const quotaStart = performance.now();
    const quota = db.consumeGuest(clientIp(c));
    console.log(`[API] quota: ${(performance.now() - quotaStart).toFixed(1)}ms`);
    if (!quota.ok) {
      if (quota.reason === "cooldown") {
        return c.json({ error: "slow down", retryAfterMs: quota.retryAfterMs }, 429);
      }
      const mins = Math.ceil(quota.retryAfterMs / 60000);
      return c.json(
        { error: `guest limit: wait ${mins} min`, retryAfterMs: quota.retryAfterMs },
        429,
      );
    }
    left = quota.left;
  }

  const msg: Message = {
    id: crypto.randomUUID(),
    roomId: GUEST_ROOM,
    sender,
    body: text,
    createdAt: Date.now(),
  };
  const dbStart = performance.now();
  db.add(msg);
  console.log(`[API] db.add: ${(performance.now() - dbStart).toFixed(1)}ms`);

  const broadcastStart = performance.now();
  broadcast(msg);
  console.log(`[API] broadcast: ${(performance.now() - broadcastStart).toFixed(1)}ms`);
  console.log(`[API] total: ${(performance.now() - start).toFixed(1)}ms`);
  return c.json({ message: msg, left }, 201);
});

app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_evt, ws) {
      sockets.add(ws);
      console.log(`[WS] connected (active: ${sockets.size})`);
      ws.send(JSON.stringify({ type: "history", messages: db.history(GUEST_ROOM) }));
    },
    onClose(_evt, ws) {
      sockets.delete(ws);
      console.log(`[WS] disconnected (active: ${sockets.size})`);
    },
    onError(evt, ws) {
      sockets.delete(ws);
      console.error(`[WS] error (active: ${sockets.size})`, evt);
    },
  })),
);

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
injectWebSocket(server);
console.log(
  `api on :${PORT}  data=${DATA_DIR}  guest=${GUEST_LIMIT}/${GUEST_WINDOW_MS / 60000}min  cd=${GUEST_COOLDOWN_MS / 1000}s  ttl=${GUEST_TTL_MS / 3600000}h`,
);
