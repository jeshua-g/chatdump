import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUEST_COOLDOWN_MS, GUEST_LIMIT, GUEST_ROOM, GUEST_TTL_MS, openDb } from "./db.ts";

const dir = mkdtempSync(join(tmpdir(), "mychat-"));
const db = openDb(dir);
const ip = "1.2.3.4";
const first = db.consumeGuest(ip, 1_000);
if (!first.ok) throw new Error("first send blocked");
const burst = db.consumeGuest(ip, 1_001);
if (burst.ok || burst.reason !== "cooldown") throw new Error("cooldown did not trip");
for (let i = 1; i < GUEST_LIMIT; i++) {
  const r = db.consumeGuest(ip, 1_000 + i * GUEST_COOLDOWN_MS);
  if (!r.ok) throw new Error(`blocked early at ${i}`);
}
const blocked = db.consumeGuest(ip, 1_000 + GUEST_LIMIT * GUEST_COOLDOWN_MS);
if (blocked.ok) throw new Error("limit did not trip");
const after = db.consumeGuest(ip, 1_000 + 30 * 60 * 1000);
if (!after.ok) throw new Error("window did not reset");
const now = Date.now();
db.add({
  id: "old",
  roomId: GUEST_ROOM,
  sender: "a",
  body: "gone",
  createdAt: now - GUEST_TTL_MS - 1,
});
db.add({ id: "new", roomId: GUEST_ROOM, sender: "a", body: "kept", createdAt: now });
const ids = db.history(GUEST_ROOM).map((m) => m.id);
if (ids.includes("old")) throw new Error("expired guest message stayed");
if (!ids.includes("new")) throw new Error("fresh guest message dropped");
if (db.getNick("u1") !== null) throw new Error("missing nick should be null");
db.setNick("u1", "Late Lark");
if (db.getNick("u1") !== "Late Lark") throw new Error("nick did not persist");
db.setNick("u1", "Moss");
if (db.getNick("u1") !== "Moss") throw new Error("nick did not update");
rmSync(dir, { recursive: true });
console.log("ok");
