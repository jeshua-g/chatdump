import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

function envInt(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const GUEST_LIMIT = envInt("GUEST_LIMIT", 50);
const GUEST_WINDOW_MS = envInt("GUEST_WINDOW_MIN", 30) * 60 * 1000;
const GUEST_TTL_MS = envInt("GUEST_TTL_HOURS", 24) * 60 * 60 * 1000;
const GUEST_COOLDOWN_MS = envInt("GUEST_COOLDOWN_SEC", 2) * 1000;

export type Message = {
  id: string;
  roomId: string;
  sender: string;
  body: string;
  createdAt: number;
};

export type RoomAccess = "public" | "password" | "invite";

function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function checkPassword(password: string, stored: string) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(hashHex, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

type ChatDb = ReturnType<typeof createDb>;
const dbs = new Map<string, ChatDb>();

export function openDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "chat.db");
  const existing = dbs.get(file);
  if (existing) return existing;
  const api = createDb(file);
  dbs.set(file, api);
  return api;
}

function createDb(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_room_created
      ON messages(room_id, created_at);
    CREATE TABLE IF NOT EXISTS guest_limits (
      ip TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      window_start INTEGER NOT NULL,
      last_sent INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS nicks (
      user_id TEXT PRIMARY KEY,
      nick TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      access TEXT NOT NULL DEFAULT 'public',
      password_hash TEXT,
      invite_token TEXT
    );
    CREATE TABLE IF NOT EXISTS invites (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );
  `);
  try {
    db.exec(`ALTER TABLE guest_limits ADD COLUMN last_sent INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* already on this schema */
  }
  try {
    db.exec(`ALTER TABLE rooms ADD COLUMN access TEXT NOT NULL DEFAULT 'public'`);
  } catch {
    /* already on this schema */
  }
  try {
    db.exec(`ALTER TABLE rooms ADD COLUMN invite_token TEXT`);
  } catch {
    /* already on this schema */
  }

  const insertMsg = db.prepare(
    `INSERT INTO messages (id, room_id, sender, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const listMsg = db.prepare(
    `SELECT id, room_id, sender, body, created_at
     FROM messages WHERE room_id = ?
     ORDER BY created_at DESC LIMIT 100`,
  );
  const getLimit = db.prepare(
    `SELECT count, window_start, last_sent FROM guest_limits WHERE ip = ?`,
  );
  const upsertLimit = db.prepare(
    `INSERT INTO guest_limits (ip, count, window_start, last_sent) VALUES (?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET count = excluded.count, window_start = excluded.window_start, last_sent = excluded.last_sent`,
  );
  const getNickStmt = db.prepare(`SELECT nick FROM nicks WHERE user_id = ?`);
  const setNickStmt = db.prepare(
    `INSERT INTO nicks (user_id, nick) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET nick = excluded.nick`,
  );
  const getRoomStmt = db.prepare(
    `SELECT id, owner_id, access, COALESCE(password_hash, '') AS password_hash,
            COALESCE(invite_token, '') AS invite_token FROM rooms WHERE id = ?`,
  );
  const insertRoom = db.prepare(
    `INSERT INTO rooms (id, owner_id, created_at, access, password_hash, invite_token)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const listRoomsStmt = db.prepare(
    `SELECT r.id, r.access, COALESCE(n.nick, '') AS owner
     FROM rooms r LEFT JOIN nicks n ON n.user_id = r.owner_id
     ORDER BY r.created_at ASC`,
  );
  const findNickStmt = db.prepare(`SELECT user_id FROM nicks WHERE nick = ?`);
  const isInvitedStmt = db.prepare(`SELECT 1 FROM invites WHERE room_id = ? AND user_id = ?`);
  const insertInvite = db.prepare(`INSERT OR IGNORE INTO invites (room_id, user_id) VALUES (?, ?)`);
  const myRoomsStmt = db.prepare(
    `SELECT r.id, r.access, 'owner' AS role
     FROM rooms r WHERE r.owner_id = ?
     UNION
     SELECT r.id, r.access, 'invite' AS role
     FROM rooms r JOIN invites i ON i.room_id = r.id WHERE i.user_id = ?
     ORDER BY id`,
  );
  const deleteMsgs = db.prepare(`DELETE FROM messages WHERE room_id = ?`);
  const deleteInvites = db.prepare(`DELETE FROM invites WHERE room_id = ?`);
  const deleteRoomStmt = db.prepare(`DELETE FROM rooms WHERE id = ?`);
  const setInviteToken = db.prepare(`UPDATE rooms SET invite_token = ? WHERE id = ?`);
  const expireGuest = db.prepare(`DELETE FROM messages WHERE room_id = ? AND created_at < ?`);
  let lastPrune = 0;
  const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
  const pruneGuestIfNeeded = (now = Date.now()) => {
    if (now - lastPrune < PRUNE_INTERVAL_MS) return;
    lastPrune = now;
    expireGuest.run(GUEST_ROOM, now - GUEST_TTL_MS);
  };

  const consumeGuest = (
    ip: string,
    now = Date.now(),
  ):
    | { ok: true; left: number }
    | { ok: false; retryAfterMs: number; reason: "cooldown" | "limit" } => {
    const row = getLimit.get(ip) as
      | { count: number; window_start: number; last_sent: number }
      | undefined;
    if (row && now - row.last_sent < GUEST_COOLDOWN_MS) {
      return {
        ok: false,
        retryAfterMs: GUEST_COOLDOWN_MS - (now - row.last_sent),
        reason: "cooldown",
      };
    }
    let count = 0;
    let windowStart = now;
    if (row && now - row.window_start < GUEST_WINDOW_MS) {
      count = row.count;
      windowStart = row.window_start;
    }
    if (count >= GUEST_LIMIT) {
      return { ok: false, retryAfterMs: GUEST_WINDOW_MS - (now - windowStart), reason: "limit" };
    }
    upsertLimit.run(ip, count + 1, windowStart, now);
    return { ok: true, left: GUEST_LIMIT - count - 1 };
  };

  const rollback = () => {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* no active transaction */
    }
  };

  return {
    sqlite: db,

    history(roomId: string): Message[] {
      pruneGuestIfNeeded();
      const rows = listMsg.all(roomId) as {
        id: string;
        room_id: string;
        sender: string;
        body: string;
        created_at: number;
      }[];
      return rows.reverse().map((r) => ({
        id: r.id,
        roomId: r.room_id,
        sender: r.sender,
        body: r.body,
        createdAt: r.created_at,
      }));
    },

    add(msg: Message) {
      insertMsg.run(msg.id, msg.roomId, msg.sender, msg.body, msg.createdAt);
      if (msg.roomId === GUEST_ROOM) pruneGuestIfNeeded(msg.createdAt);
    },

    getNick(userId: string) {
      const row = getNickStmt.get(userId) as { nick: string } | undefined;
      return row?.nick ?? null;
    },

    setNick(userId: string, nick: string) {
      setNickStmt.run(userId, nick);
    },

    hasRoom(id: string) {
      return id === GUEST_ROOM || Boolean(getRoomStmt.get(id));
    },

    getRoom(id: string) {
      if (id === GUEST_ROOM) {
        return { id, ownerId: "", access: "public" as const, passwordHash: "", inviteToken: "" };
      }
      const row = getRoomStmt.get(id) as
        | {
            id: string;
            owner_id: string;
            access: string;
            password_hash: string;
            invite_token: string;
          }
        | undefined;
      if (!row) return null;
      const access = (row.access || "public") as RoomAccess;
      let inviteToken = row.invite_token;
      if (access === "invite" && !inviteToken) {
        inviteToken = randomBytes(16).toString("hex");
        setInviteToken.run(inviteToken, row.id);
      }
      return {
        id: row.id,
        ownerId: row.owner_id,
        access,
        passwordHash: row.password_hash,
        inviteToken,
      };
    },

    listRooms() {
      return listRoomsStmt.all() as { id: string; access: string; owner: string }[];
    },

    canEnter(id: string, userId: string | null, password?: string, token?: string) {
      const room = this.getRoom(id);
      if (!room) return { ok: false as const, reason: "missing" as const };
      if (room.access === "public") return { ok: true as const };
      if (userId && userId === room.ownerId) return { ok: true as const };
      if (room.access === "password") {
        if (!password) return { ok: false as const, reason: "password" as const };
        if (!checkPassword(password, room.passwordHash)) {
          return { ok: false as const, reason: "denied" as const };
        }
        return { ok: true as const };
      }
      if (token && room.inviteToken && token === room.inviteToken) return { ok: true as const };
      if (userId && isInvitedStmt.get(id, userId)) return { ok: true as const };
      return { ok: false as const, reason: "denied" as const };
    },

    createRoom(raw: string, ownerId: string, access: RoomAccess = "public", password?: string) {
      const id = parseRoomId(raw);
      if (!id) return { ok: false as const, reason: "invalid" as const };
      if (access === "password" && !password)
        return { ok: false as const, reason: "invalid" as const };
      if (id === GUEST_ROOM) return { ok: false as const, reason: "exists" as const };
      if (getRoomStmt.get(id)) return { ok: false as const, reason: "exists" as const };
      const hash = access === "password" && password ? hashPassword(password) : null;
      const token = access === "invite" ? randomBytes(16).toString("hex") : null;
      insertRoom.run(id, ownerId, Date.now(), access, hash, token);
      return { ok: true as const, id, token: token ?? undefined };
    },

    listMine(userId: string) {
      return myRoomsStmt.all(userId, userId) as { id: string; access: string; role: string }[];
    },

    deleteRoom(id: string, actorId: string, force = false) {
      if (id === GUEST_ROOM) return { ok: false as const, reason: "denied" as const };
      const room = this.getRoom(id);
      if (!room) return { ok: false as const, reason: "missing" as const };
      if (!force && room.ownerId !== actorId)
        return { ok: false as const, reason: "denied" as const };
      deleteMsgs.run(id);
      deleteInvites.run(id);
      deleteRoomStmt.run(id);
      return { ok: true as const };
    },

    inviteLink(roomId: string, actorId: string) {
      const room = this.getRoom(roomId);
      if (!room) return { ok: false as const, reason: "missing" as const };
      if (room.ownerId !== actorId) return { ok: false as const, reason: "denied" as const };
      if (room.access !== "invite" || !room.inviteToken) {
        return { ok: false as const, reason: "not-invite" as const };
      }
      return { ok: true as const, token: room.inviteToken };
    },

    invite(roomId: string, actorId: string, nick: string) {
      const room = this.getRoom(roomId);
      if (!room) return { ok: false as const, reason: "missing" as const };
      if (room.ownerId !== actorId) return { ok: false as const, reason: "denied" as const };
      if (room.access !== "invite") return { ok: false as const, reason: "not-invite" as const };
      const rows = findNickStmt.all(nick) as { user_id: string }[];
      if (!rows.length) return { ok: false as const, reason: "nouser" as const };
      if (rows.length > 1) return { ok: false as const, reason: "ambiguous" as const };
      insertInvite.run(roomId, rows[0].user_id);
      return { ok: true as const };
    },

    consumeGuest,

    publish(
      roomId: string,
      who: string,
      body: string,
      guestIp: string | null,
    ):
      | { ok: true; message: Message; left: number }
      | { ok: false; error: string } {
      db.exec("BEGIN");
      try {
        if (roomId !== GUEST_ROOM && !getRoomStmt.get(roomId)) {
          rollback();
          return { ok: false, error: "no such room" };
        }
        let left = -1;
        if (guestIp) {
          const quota = consumeGuest(guestIp);
          if (!quota.ok) {
            rollback();
            if (quota.reason === "cooldown") return { ok: false, error: "slow down" };
            const mins = Math.ceil(quota.retryAfterMs / 60000);
            return { ok: false, error: `guest limit: wait ${mins} min` };
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
        insertMsg.run(msg.id, msg.roomId, msg.sender, msg.body, msg.createdAt);
        db.exec("COMMIT");
        try {
          if (msg.roomId === GUEST_ROOM) pruneGuestIfNeeded(msg.createdAt);
        } catch {
          /* prune is best-effort after a committed insert */
        }
        return { ok: true, message: msg, left };
      } catch (err) {
        rollback();
        const text = err instanceof Error ? err.message : String(err);
        if (/SQLITE_BUSY|database is locked/i.test(text)) {
          return { ok: false, error: "busy, try again" };
        }
        return { ok: false, error: "send failed" };
      }
    },
  };
}

export const GUEST_ROOM = "guest";
export { GUEST_LIMIT, GUEST_WINDOW_MS, GUEST_TTL_MS, GUEST_COOLDOWN_MS };

export function parseRoomId(raw: string) {
  const id = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(id)) return null;
  return id;
}
