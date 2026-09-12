export const PEER_CAP = 6;
const HIST = 100;

export type Message = {
  id: string;
  roomId: string;
  sender: string;
  body: string;
  createdAt: number;
};

export type Wire =
  | { type: "history"; messages: Message[] }
  | { type: "message"; message: Message }
  | { type: "presence"; names: string[] }
  | { type: "typing:start"; nick: string }
  | { type: "typing:stop"; nick: string }
  | { type: "sys"; body: string }
  | { type: "error"; error: string }
  | { type: "auth"; mode: string }
  | { type: "kicked"; reason?: string }
  | { type: "nack"; error?: string; body?: string };

export type PeerRoom = {
  send: (body: string) => void;
  setNick: (nick: string) => void;
  typing: (on: boolean) => void;
  leave: () => void;
};

export function mintToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function peerLink(token: string, origin: string) {
  return `${origin}/#r=${token}`;
}

export function tokenFromHash(hash: string) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const token = new URLSearchParams(raw).get("r");
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return token;
}

export async function hashRoom(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function roomLabel(token: string) {
  return (await hashRoom(token)).slice(0, 6);
}

function isMessage(x: unknown): x is Message {
  if (!x || typeof x !== "object") return false;
  const m = x as Message;
  return (
    typeof m.id === "string" &&
    typeof m.roomId === "string" &&
    typeof m.sender === "string" &&
    typeof m.body === "string" &&
    typeof m.createdAt === "number"
  );
}

export async function selfCheck() {
  const token = "aaaaaaaaaaaaaaaaaaaa";
  const id = await hashRoom(token);
  if (id.slice(0, 16) !== "42492da06234ad0a") throw new Error("room hash");
  if (id === token || (await hashRoom(token)) !== id) throw new Error("room hash unstable");
  if ((await roomLabel(token)) !== "42492d") throw new Error("room label");
  if (tokenFromHash(`#r=${token}`) !== token) throw new Error("hash parse");
  if (tokenFromHash("#r=short") !== null) throw new Error("short token");
  if (tokenFromHash("") !== null) throw new Error("empty hash");
  const minted = mintToken();
  if (!/^[A-Za-z0-9_-]{22}$/.test(minted)) throw new Error("mint");
}

export async function joinPeerRoom(
  token: string,
  nick: () => string,
  onWire: (ev: Wire) => void,
): Promise<PeerRoom> {
  const { joinRoom } = await import("trystero");
  const label = await roomLabel(token);
  const meshId = await hashRoom(token);
  let left = false;
  let warned = false;
  let booting = true;
  const names = new Map<string, string>();
  const pendingNicks = new Map<string, string>();
  const typing = new Set<string>();
  let log: Message[] = [];
  const seen = new Set<string>();

  const who = () => nick().trim().slice(0, 24) || "anon";

  const room = joinRoom({ appId: "chatdump", password: token }, meshId, {
    onJoinError(details) {
      if (left || warned) return;
      if (/full/i.test(details.error)) return;
      warned = true;
      onWire({
        type: "sys",
        body: "couldn't punch through. their network blocked the direct link. no relay.",
      });
    },
  });

  const chat = room.makeAction<Message>("chat");
  const hello = room.makeAction<string>("nick");
  const hist = room.makeAction<Message[]>("hist");
  const typed = room.makeAction<{ nick: string; on: boolean }>("typing");
  const full = room.makeAction<number>("full");

  function presence() {
    const list = [who(), ...names.values()].filter(Boolean);
    onWire({ type: "presence", names: [...new Set(list)] });
  }

  function remember(msg: Message) {
    if (msg.roomId !== label || seen.has(msg.id)) return false;
    seen.add(msg.id);
    log = [...log, msg].slice(-HIST);
    return true;
  }

  function admit(peerId: string) {
    names.set(peerId, pendingNicks.get(peerId) ?? names.get(peerId) ?? "");
    pendingNicks.delete(peerId);
    void hello.send(who(), { target: peerId }).catch(() => {});
    if (log.length) void hist.send(log, { target: peerId }).catch(() => {});
    presence();
  }

  // ponytail: mesh cap 6. a relay if groups grow — not on our cloudflare account.
  room.onPeerJoin = (peerId) => {
    if (left) return;
    const n = Object.keys(room.getPeers()).length;
    if (!booting && n > PEER_CAP - 1) {
      void full.send(1, { target: peerId }).catch(() => {});
      return;
    }
    if (n > PEER_CAP - 1) {
      onWire({ type: "sys", body: "room full (6)" });
      void leave();
      return;
    }
    warned = true;
    admit(peerId);
  };

  room.onPeerLeave = (peerId) => {
    if (left) return;
    const name = names.get(peerId);
    names.delete(peerId);
    pendingNicks.delete(peerId);
    if (name && typing.delete(name)) onWire({ type: "typing:stop", nick: name });
    presence();
  };

  chat.onMessage = (msg) => {
    if (left || !isMessage(msg) || !remember(msg)) return;
    onWire({ type: "message", message: msg });
  };

  hello.onMessage = (name, { peerId }) => {
    if (left || typeof name !== "string") return;
    const clean = name.trim().slice(0, 24);
    if (!clean) return;
    if (!names.has(peerId)) {
      pendingNicks.set(peerId, clean);
      return;
    }
    names.set(peerId, clean);
    presence();
  };

  hist.onMessage = (batch) => {
    if (left || !Array.isArray(batch)) return;
    for (const msg of batch.slice(-HIST)) {
      if (!isMessage(msg) || !remember(msg)) continue;
      onWire({ type: "message", message: msg });
    }
  };

  typed.onMessage = (data) => {
    if (left || !data || typeof data.nick !== "string") return;
    const name = data.nick.trim().slice(0, 24);
    if (!name || name === who()) return;
    if (data.on) onWire({ type: "typing:start", nick: name });
    else onWire({ type: "typing:stop", nick: name });
  };

  full.onMessage = () => {
    if (left) return;
    onWire({ type: "sys", body: "room full (6)" });
    void leave();
  };

  const wait = setTimeout(() => {
    if (left || warned || Object.keys(room.getPeers()).length) return;
    warned = true;
    onWire({
      type: "sys",
      body: "still alone. if a friend already opened the link, their network blocked the direct link.",
    });
  }, 15_000);

  queueMicrotask(() => {
    booting = false;
  });

  onWire({ type: "history", messages: [] });
  presence();

  function leave() {
    if (left) return;
    left = true;
    clearTimeout(wait);
    room.onPeerJoin = null;
    room.onPeerLeave = null;
    void room.leave();
  }

  return {
    send(body) {
      const text = body.trim().slice(0, 2000);
      if (!text || left) return;
      const msg: Message = {
        id: crypto.randomUUID(),
        roomId: label,
        sender: who(),
        body: text,
        createdAt: Date.now(),
      };
      if (!remember(msg)) return;
      onWire({ type: "message", message: msg });
      if (Object.keys(room.getPeers()).length) void chat.send(msg).catch(() => {});
    },
    setNick(next) {
      if (left) return;
      void hello.send(next.trim().slice(0, 24) || "anon").catch(() => {});
      presence();
    },
    typing(on) {
      if (left) return;
      void typed.send({ nick: who(), on }).catch(() => {});
    },
    leave,
  };
}
