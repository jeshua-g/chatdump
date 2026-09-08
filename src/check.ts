import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUEST_LIMIT, openDb } from "./db.ts";

const dir = mkdtempSync(join(tmpdir(), "mychat-"));
const db = openDb(dir);
const ip = "1.2.3.4";
for (let i = 0; i < GUEST_LIMIT; i++) {
  const r = db.consumeGuest(ip, 1_000);
  if (!r.ok) throw new Error(`blocked early at ${i}`);
}
const blocked = db.consumeGuest(ip, 1_000);
if (blocked.ok) throw new Error("limit did not trip");
const after = db.consumeGuest(ip, 1_000 + 30 * 60 * 1000);
if (!after.ok) throw new Error("window did not reset");
rmSync(dir, { recursive: true });
console.log("ok");
