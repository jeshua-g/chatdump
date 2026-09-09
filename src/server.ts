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

const sockets = new Map<{ send: (data: string) => void }, { room: string | null; nick: string }>();

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
  for (const [ws, meta] of sockets) {
    if (meta.room !== msg.roomId) continue;
    try {
      ws.send(payload);
    } catch {
      sockets.delete(ws);
    }
  }
}

function namesIn(room: string) {
  const names: string[] = [];
  for (const meta of sockets.values()) {
    if (meta.room === room && meta.nick) names.push(meta.nick);
  }
  return [...new Set(names)];
}

function presence(room: string | null) {
  if (!room) return;
  const payload = JSON.stringify({ type: "presence", names: namesIn(room) });
  for (const [ws, meta] of sockets) {
    if (meta.room !== room) continue;
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

app.get("/api/rooms", (c) =>
  c.json({
    rooms: [
      { id: GUEST_ROOM, access: "public", info: "public guest room  ·  messages expire ~24h" },
      ...db.listRooms().map((r) => ({
        id: r.id,
        access: r.access,
        info:
          r.access === "password"
            ? "private (password)"
            : r.access === "invite"
              ? "private (invite)"
              : r.owner || "room",
      })),
    ],
  }),
);

app.post("/api/rooms", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  let body: { id?: string; access?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const access = body.access === "password" || body.access === "invite" ? body.access : "public";
  const made = db.createRoom(body.id ?? "", session.user.id, access, body.password);
  if (!made.ok) {
    if (made.reason === "invalid") return c.json({ error: "bad room name" }, 400);
    return c.json({ error: "file exists" }, 409);
  }
  return c.json({ id: made.id, access, token: made.token }, 201);
});

app.get("/api/my-rooms", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  return c.json({ rooms: db.listMine(session.user.id) });
});

app.post("/api/rooms/:id/delete", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const result = db.deleteRoom(c.req.param("id").toLowerCase(), session.user.id);
  if (!result.ok) {
    if (result.reason === "missing") return c.json({ error: "no such room" }, 404);
    return c.json({ error: "permission denied" }, 403);
  }
  return c.json({ ok: true });
});

app.get("/api/rooms/:id/link", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const result = db.inviteLink(c.req.param("id").toLowerCase(), session.user.id);
  if (!result.ok) {
    if (result.reason === "not-invite") return c.json({ error: "not an invite room" }, 400);
    return c.json({ error: "permission denied" }, 403);
  }
  return c.json({ token: result.token });
});

app.post("/api/rooms/:id/invite", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  let body: { nick?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const nick = (body.nick ?? "").trim();
  if (!nick) return c.json({ error: "nick required" }, 400);
  const id = c.req.param("id").toLowerCase();
  const result = db.invite(id, session.user.id, nick);
  if (!result.ok) {
    if (result.reason === "nouser") return c.json({ error: "no such user" }, 404);
    if (result.reason === "not-invite") return c.json({ error: "not an invite room" }, 400);
    return c.json({ error: "permission denied" }, 403);
  }
  const room = db.getRoom(id);
  return c.json({ ok: true, token: room?.inviteToken || undefined });
});

app.get("/api/messages", (c) => c.json({ messages: db.history(GUEST_ROOM) }));

app.post("/api/messages", async (c) => {
  const start = performance.now();
  let body: { sender?: string; body?: string; room?: string; password?: string; token?: string };
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
  const roomId = (body.room ?? "").trim().toLowerCase();
  if (!sender || !text) return c.json({ error: "sender and body required" }, 400);
  const enter = db.canEnter(roomId, session?.user.id ?? null, body.password, body.token);
  if (!enter.ok) {
    if (enter.reason === "missing") return c.json({ error: "no such room" }, 404);
    return c.json({ error: "permission denied" }, 403);
  }

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
    roomId,
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
  upgradeWebSocket((c) => {
    const headers = c.req.raw.headers;
    return {
      onOpen(_evt, ws) {
        sockets.set(ws, { room: null, nick: "" });
        console.log(`[WS] connected (active: ${sockets.size})`);
      },
      onMessage(evt, ws) {
        void (async () => {
          let data: { type?: string; room?: string; password?: string; nick?: string; token?: string };
          try {
            data = JSON.parse(String(evt.data)) as {
              type?: string;
              room?: string;
              password?: string;
              nick?: string;
              token?: string;
            };
          } catch {
            return;
          }
          if (data.type === "leave") {
            const prev = sockets.get(ws);
            sockets.set(ws, { room: null, nick: prev?.nick ?? "" });
            presence(prev?.room ?? null);
            return;
          }
          if (data.type === "nick") {
            const prev = sockets.get(ws) ?? { room: null, nick: "" };
            prev.nick = (data.nick ?? "").trim().slice(0, 24);
            sockets.set(ws, prev);
            presence(prev.room);
            return;
          }
          if (data.type === "who") {
            const prev = sockets.get(ws);
            ws.send(JSON.stringify({ type: "presence", names: prev?.room ? namesIn(prev.room) : [] }));
            return;
          }
          if (data.type !== "join") return;
          const room = (data.room ?? "").trim().toLowerCase();
          const session = await auth.api.getSession({ headers });
          const enter = db.canEnter(room, session?.user.id ?? null, data.password, data.token);
          if (!enter.ok) {
            if (enter.reason === "missing") {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: `ssh: could not resolve hostname ${data.room}`,
                }),
              );
              return;
            }
            if (enter.reason === "password") {
              ws.send(JSON.stringify({ type: "auth", mode: "password" }));
              return;
            }
            ws.send(JSON.stringify({ type: "error", error: "permission denied" }));
            return;
          }
          const prev = sockets.get(ws);
          const nick = (data.nick ?? prev?.nick ?? "").trim().slice(0, 24);
          sockets.set(ws, { room, nick });
          if (prev?.room && prev.room !== room) presence(prev.room);
          ws.send(JSON.stringify({ type: "history", messages: db.history(room) }));
          presence(room);
        })();
      },
      onClose(_evt, ws) {
        const prev = sockets.get(ws);
        sockets.delete(ws);
        presence(prev?.room ?? null);
        console.log(`[WS] disconnected (active: ${sockets.size})`);
      },
      onError(evt, ws) {
        const prev = sockets.get(ws);
        sockets.delete(ws);
        presence(prev?.room ?? null);
        console.error(`[WS] error (active: ${sockets.size})`, evt);
      },
    };
  }),
);

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" });
injectWebSocket(server);
console.log(
  `api on :${PORT}  data=${DATA_DIR}  guest=${GUEST_LIMIT}/${GUEST_WINDOW_MS / 60000}min  cd=${GUEST_COOLDOWN_MS / 1000}s  ttl=${GUEST_TTL_MS / 3600000}h`,
);
