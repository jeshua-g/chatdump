import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { getMigrations } from "better-auth/db/migration";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "node:path";
import { auth, isOwner } from "./auth.ts";
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

const sockets = new Map<
  { send: (data: string) => void },
  { room: string | null; nick: string; userId: string | null }
>();
type Sock = { send: (data: string) => void };
const typingTimers = new Map<Sock, ReturnType<typeof setTimeout>>();

function clientIp(c: { req: { header: (n: string) => string | undefined } }) {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "local"
  );
}

function publishChat(roomId: string, sender: string, text: string, guestIp: string | null) {
  const who = sender.trim().slice(0, 24);
  const body = text.trim().slice(0, 2000);
  if (!who || !body) return { ok: false as const, error: "sender and body required" };
  if (!db.hasRoom(roomId)) return { ok: false as const, error: "no such room" };
  let left = -1;
  if (guestIp) {
    const quota = db.consumeGuest(guestIp);
    if (!quota.ok) {
      if (quota.reason === "cooldown") return { ok: false as const, error: "slow down" };
      const mins = Math.ceil(quota.retryAfterMs / 60000);
      return { ok: false as const, error: `guest limit: wait ${mins} min` };
    }
    left = quota.left;
  }
  const msg: Message = {
    id: crypto.randomUUID(),
    roomId,
    sender: who,
    body,
    createdAt: Date.now(),
  };
  db.add(msg);
  broadcast(msg);
  return { ok: true as const, message: msg, left };
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

function displayNick(meta: { nick: string; userId: string | null }) {
  return ((meta.userId ? db.getNick(meta.userId) : null) || meta.nick).trim().slice(0, 24);
}

function fanout(room: string, payload: string, except?: Sock) {
  for (const [ws, meta] of sockets) {
    if (meta.room !== room || ws === except) continue;
    try {
      ws.send(payload);
    } catch {
      sockets.delete(ws);
      const t = typingTimers.get(ws);
      if (t) clearTimeout(t);
      typingTimers.delete(ws);
    }
  }
}

function stopTyping(ws: Sock) {
  const timer = typingTimers.get(ws);
  if (timer) clearTimeout(timer);
  typingTimers.delete(ws);
  if (!timer) return;
  const meta = sockets.get(ws);
  const nick = meta ? displayNick(meta) : "";
  if (!meta?.room || !nick) return;
  fanout(meta.room, JSON.stringify({ type: "typing:stop", nick }), ws);
}

function startTyping(ws: Sock) {
  const meta = sockets.get(ws);
  const nick = meta ? displayNick(meta) : "";
  if (!meta?.room || !nick) return;
  const already = typingTimers.has(ws);
  const prev = typingTimers.get(ws);
  if (prev) clearTimeout(prev);
  typingTimers.set(
    ws,
    setTimeout(() => {
      typingTimers.delete(ws);
      const cur = sockets.get(ws);
      const who = cur ? displayNick(cur) : "";
      if (!cur?.room || !who) return;
      fanout(cur.room, JSON.stringify({ type: "typing:stop", nick: who }), ws);
    }, 5000),
  );
  if (!already) fanout(meta.room, JSON.stringify({ type: "typing:start", nick }), ws);
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
  const stored = db.getNick(session.user.id);
  const nick = stored || session.user.name?.trim().slice(0, 24) || "";
  return c.json({
    nick,
    hasNick: Boolean(stored),
    name: session.user.name,
    id: session.user.id,
    email: session.user.email,
    admin: isOwner(session.user),
  });
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

app.post("/api/sudo", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session || !isOwner(session.user)) return c.json({ error: "permission denied" }, 403);
  let body: { cmd?: string; arg?: string; room?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const cmd = (body.cmd ?? "").trim();
  const arg = (body.arg ?? "").trim();
  if (cmd === "rmdir") {
    const id = (arg || body.room || "").toLowerCase();
    const result = db.deleteRoom(id, session.user.id, true);
    if (!result.ok) {
      if (result.reason === "missing") return c.json({ error: "no such room" }, 404);
      return c.json({ error: "permission denied" }, 403);
    }
    const payload = JSON.stringify({ type: "kicked", reason: `room ${id} removed` });
    for (const [ws, meta] of sockets) {
      if (meta.room !== id) continue;
      try {
        ws.send(payload);
      } catch {
        sockets.delete(ws);
        continue;
      }
      sockets.set(ws, { room: null, nick: meta.nick, userId: meta.userId });
    }
    return c.json({ ok: true });
  }
  if (cmd === "kick") {
    const room = (body.room ?? "").trim().toLowerCase();
    if (!room || !arg) return c.json({ error: "usage" }, 400);
    let n = 0;
    const payload = JSON.stringify({ type: "kicked", reason: "kicked" });
    for (const [ws, meta] of sockets) {
      if (meta.room !== room || meta.nick !== arg) continue;
      try {
        ws.send(payload);
      } catch {
        sockets.delete(ws);
        continue;
      }
      sockets.set(ws, { room: null, nick: meta.nick, userId: meta.userId });
      n += 1;
    }
    presence(room);
    return c.json({ ok: true, kicked: n });
  }
  if (cmd === "wall") {
    const room = (body.room ?? "").trim().toLowerCase();
    if (!room || !arg) return c.json({ error: "usage" }, 400);
    const payload = JSON.stringify({ type: "sys", body: arg });
    for (const [ws, meta] of sockets) {
      if (meta.room !== room) continue;
      try {
        ws.send(payload);
      } catch {
        sockets.delete(ws);
      }
    }
    return c.json({ ok: true });
  }
  return c.json({ error: "unknown command" }, 400);
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
  let body: { sender?: string; body?: string; room?: string; password?: string; token?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const sender = ((session ? db.getNick(session.user.id) || session.user.name : body.sender) || "")
    .trim()
    .slice(0, 24);
  const roomId = (body.room ?? "").trim().toLowerCase();
  const enter = db.canEnter(roomId, session?.user.id ?? null, body.password, body.token);
  if (!enter.ok) {
    if (enter.reason === "missing") return c.json({ error: "no such room" }, 404);
    return c.json({ error: "permission denied" }, 403);
  }
  const result = publishChat(roomId, sender, body.body ?? "", session ? null : clientIp(c));
  if (!result.ok) {
    const status = result.error === "slow down" || result.error.startsWith("guest limit") ? 429 : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json({ message: result.message, left: result.left }, 201);
});

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    const headers = c.req.raw.headers;
    const ip = clientIp(c);
    return {
      onOpen(_evt, ws) {
        sockets.set(ws, { room: null, nick: "", userId: null });
        console.log(`[WS] connected (active: ${sockets.size})`);
      },
      onMessage(evt, ws) {
        void (async () => {
          let data: {
            type?: string;
            room?: string;
            password?: string;
            nick?: string;
            token?: string;
            body?: string;
          };
          try {
            data = JSON.parse(String(evt.data)) as {
              type?: string;
              room?: string;
              password?: string;
              nick?: string;
              token?: string;
              body?: string;
            };
          } catch {
            return;
          }
          if (data.type === "leave") {
            const prev = sockets.get(ws);
            stopTyping(ws);
            sockets.set(ws, { room: null, nick: prev?.nick ?? "", userId: prev?.userId ?? null });
            presence(prev?.room ?? null);
            return;
          }
          if (data.type === "nick") {
            const prev = sockets.get(ws) ?? { room: null, nick: "", userId: null };
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
          if (data.type === "typing:start") {
            startTyping(ws);
            return;
          }
          if (data.type === "typing:stop") {
            stopTyping(ws);
            return;
          }
          if (data.type === "send") {
            const prev = sockets.get(ws);
            if (!prev?.room) {
              ws.send(JSON.stringify({ type: "nack", error: "not in a room", body: data.body }));
              return;
            }
            stopTyping(ws);
            const sender = (
              (prev.userId ? db.getNick(prev.userId) : null) ||
              prev.nick
            ).trim();
            const result = publishChat(prev.room, sender, data.body ?? "", prev.userId ? null : ip);
            if (!result.ok) {
              ws.send(JSON.stringify({ type: "nack", error: result.error, body: data.body }));
            }
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
          stopTyping(ws);
          const nick = (data.nick ?? prev?.nick ?? "").trim().slice(0, 24);
          sockets.set(ws, { room, nick, userId: session?.user.id ?? prev?.userId ?? null });
          if (prev?.room && prev.room !== room) presence(prev.room);
          ws.send(JSON.stringify({ type: "history", messages: db.history(room) }));
          presence(room);
        })();
      },
      onClose(_evt, ws) {
        stopTyping(ws);
        const prev = sockets.get(ws);
        sockets.delete(ws);
        presence(prev?.room ?? null);
        console.log(`[WS] disconnected (active: ${sockets.size})`);
      },
      onError(evt, ws) {
        stopTyping(ws);
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
