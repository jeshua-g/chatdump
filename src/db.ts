import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const GUEST_LIMIT = 50;
const GUEST_WINDOW_MS = 30 * 60 * 1000;

export type Message = {
  id: string;
  roomId: string;
  sender: string;
  body: string;
  createdAt: number;
};

export function openDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "chat.db"));
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
      window_start INTEGER NOT NULL
    );
  `);

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
    `SELECT count, window_start FROM guest_limits WHERE ip = ?`,
  );
  const upsertLimit = db.prepare(
    `INSERT INTO guest_limits (ip, count, window_start) VALUES (?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET count = excluded.count, window_start = excluded.window_start`,
  );

  return {
    history(roomId: string): Message[] {
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
    },

    /** @returns remaining sends in this window, or 0 if blocked */
    consumeGuest(ip: string, now = Date.now()): { ok: true; left: number } | { ok: false; retryAfterMs: number } {
      const row = getLimit.get(ip) as { count: number; window_start: number } | undefined;
      let count = 0;
      let windowStart = now;
      if (row && now - row.window_start < GUEST_WINDOW_MS) {
        count = row.count;
        windowStart = row.window_start;
      }
      if (count >= GUEST_LIMIT) {
        return { ok: false, retryAfterMs: GUEST_WINDOW_MS - (now - windowStart) };
      }
      upsertLimit.run(ip, count + 1, windowStart);
      return { ok: true, left: GUEST_LIMIT - count - 1 };
    },
  };
}

export const GUEST_ROOM = "guest";
export { GUEST_LIMIT, GUEST_WINDOW_MS };
