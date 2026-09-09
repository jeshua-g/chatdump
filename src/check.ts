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
if (!db.hasRoom(GUEST_ROOM)) throw new Error("guest room missing");
if (db.createRoom("guest", "u1").ok) throw new Error("guest overwrite");
if (db.createRoom("Bad Name", "u1").ok) throw new Error("bad room allowed");
const made = db.createRoom("Lounge", "u1");
if (!made.ok || made.id !== "lounge") throw new Error("room not created");
if (!db.hasRoom("lounge")) throw new Error("room missing after create");
if (db.createRoom("lounge", "u2").ok) throw new Error("duplicate room");
if (
  db
    .listRooms()
    .map((r) => r.id)
    .join() !== "lounge"
)
  throw new Error("list rooms");
const locked = db.createRoom("secret", "u1", "password", "hunter2");
if (!locked.ok) throw new Error("password room");
if (db.canEnter("secret", null).reason !== "password") throw new Error("password required");
if (!db.canEnter("secret", null, "hunter2").ok) throw new Error("password rejected");
if (db.canEnter("secret", null, "nope").ok) throw new Error("bad password allowed");
if (!db.canEnter("secret", "u1").ok) throw new Error("owner locked out");
const club = db.createRoom("club", "u1", "invite");
if (!club.ok) throw new Error("invite room");
if (db.canEnter("club", "u2").ok) throw new Error("stranger entered invite room");
db.setNick("u2", "Fern");
if (!db.invite("club", "u1", "Fern").ok) throw new Error("invite failed");
if (!db.canEnter("club", "u2").ok) throw new Error("invitee blocked");
if (db.invite("club", "u2", "Moss").reason !== "denied") throw new Error("non-owner invited");
rmSync(dir, { recursive: true });
console.log("ok");
