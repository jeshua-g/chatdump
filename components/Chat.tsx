"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { HELP, authMenu, parseRoomId, parseSsh, privateMenu } from "@/lib/shell";
import { CrtBackground } from "@/src/shaders/crt/CrtBackground";
import type { CrtChatLine } from "@/src/shaders/crt/crtRenderer";

type Message = {
  id: string;
  roomId: string;
  sender: string;
  body: string;
  createdAt: number;
};

const NOISE =
  "https://res.cloudinary.com/qnt0vxiu/video/upload/v1788945215/freesound_community-analog-crt-tv-electronic-static-noise-60428_ywldmf.mp3";

function apiBase() {
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:3000";
  return process.env.NEXT_PUBLIC_API_URL ?? "https://chat-api.jdump.com";
}

function apiUrl(path: string) {
  return `${apiBase()}${path}`;
}

function wsUrl() {
  const u = new URL(apiBase());
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${u.host}/ws`;
}

const ADJ = [
  "Amber",
  "Copper",
  "Quiet",
  "Warm",
  "Pale",
  "Dim",
  "Soft",
  "Late",
  "Rust",
  "Moss",
  "Pine",
  "Ash",
  "Faint",
  "Cold",
  "Dull",
  "Slow",
];
const NOUN = [
  "Moth",
  "Wren",
  "Maple",
  "Fern",
  "Fox",
  "Kite",
  "Reed",
  "Lark",
  "Birch",
  "Crow",
  "Thorn",
  "Finch",
  "Hare",
  "Tern",
  "Rook",
  "Vine",
];

function guestName() {
  return `${ADJ[(Math.random() * ADJ.length) | 0]} ${NOUN[(Math.random() * NOUN.length) | 0]}`;
}

function loadGuestName() {
  const stored = localStorage.getItem("guest-name");
  const name = stored && stored.length <= 24 ? stored : guestName();
  localStorage.setItem("guest-name", name);
  return name;
}

type Gate =
  | { kind: "auth" }
  | { kind: "mkdir-private"; id: string; echo: string }
  | { kind: "mkdir-pass"; id: string; echo: string }
  | { kind: "ssh-pass"; room: string; echo: string };

function asLines(list: Message[]): CrtChatLine[] {
  return list.map((m) => ({ id: m.id, sender: m.sender, body: m.body }));
}

export function Chat() {
  const [nick, setNick] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [text, setText] = useState("");
  const [hint, setHint] = useState("type /help");
  const [live, setLive] = useState(false);
  const [cwd, setCwd] = useState("~");
  const [promptKind, setPromptKind] = useState<"shell" | "select" | "password">("shell");
  const [feed, setFeed] = useState<CrtChatLine[]>([]);
  const seen = useRef(new Set<string>());
  const inbox = useRef<Message[]>([]);
  const roomRef = useRef<string | null>(null);
  const pendingJoin = useRef<{ room: string; echo: string } | null>(null);
  const gateRef = useRef<Gate | null>(null);
  const passRef = useRef<Record<string, string>>({});
  const wsRef = useRef<WebSocket | undefined>(undefined);
  const nickRef = useRef("");
  const signedRef = useRef(false);
  const cwdRef = useRef("~");
  const sysN = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const noiseRef = useRef<HTMLAudioElement>(null);
  nickRef.current = nick;
  signedRef.current = signedIn;
  cwdRef.current = cwd;

  function sys(body: string) {
    sysN.current += 1;
    setFeed((prev) => [...prev, { id: `sys-${sysN.current}`, sender: "", body }]);
  }

  useEffect(() => {
    let stop = false;
    authClient.getSession().then(async ({ data }) => {
      if (stop) return;
      if (data?.user) {
        setSignedIn(true);
        try {
          const res = await fetch(apiUrl("/api/me"), { credentials: "include" });
          const me = (await res.json()) as { nick?: string };
          if (stop) return;
          setNick((me.nick || data.user.name || loadGuestName()).slice(0, 24));
        } catch {
          if (stop) return;
          setNick((data.user.name || loadGuestName()).slice(0, 24));
        }
        return;
      }
      setNick(loadGuestName());
    });
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let ws: WebSocket | undefined;
    const connect = () => {
      if (stop) return;
      ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        setLive(true);
        if (roomRef.current)
          ws?.send(
            JSON.stringify({
              type: "join",
              room: roomRef.current,
              password: passRef.current[roomRef.current],
            }),
          );
      };
      ws.onclose = () => {
        setLive(false);
        if (!stop) timer = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        const data = JSON.parse(String(ev.data)) as
          | { type: "history"; messages: Message[] }
          | { type: "message"; message: Message }
          | { type: "error"; error: string }
          | { type: "auth"; mode: string };
        if (data.type === "auth") {
          const joining = pendingJoin.current;
          if (joining) {
            gateRef.current = { kind: "ssh-pass", room: joining.room, echo: joining.echo };
            setPromptKind("password");
          }
          return;
        }
        if (data.type === "error") {
          const joining = pendingJoin.current;
          pendingJoin.current = null;
          gateRef.current = null;
          setPromptKind("shell");
          sys(joining ? `${joining.echo}\n${data.error}` : data.error);
          return;
        }
        if (data.type === "history") {
          inbox.current = data.messages;
          seen.current = new Set(data.messages.map((m) => m.id));
          const joining = pendingJoin.current;
          if (joining) {
            roomRef.current = joining.room;
            pendingJoin.current = null;
            gateRef.current = null;
            setPromptKind("shell");
            setCwd(`~/${joining.room}`);
          }
          if (roomRef.current) setFeed(asLines(data.messages));
          return;
        }
        const msg = data.message;
        if (msg.roomId !== roomRef.current || seen.current.has(msg.id)) return;
        seen.current.add(msg.id);
        inbox.current.push(msg);
        setFeed((prev) => [...prev, { id: msg.id, sender: msg.sender, body: msg.body }]);
      };
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    const el = noiseRef.current;
    if (!el) return;
    el.volume = 1;
    const kick = () => {
      void el.play().catch(() => {});
    };
    const vis = () => {
      if (document.hidden) el.pause();
      else void el.play().catch(() => {});
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      document.removeEventListener("visibilitychange", vis);
      el.pause();
    };
  }, []);

  async function saveNick(name: string) {
    if (signedRef.current) {
      const res = await fetch(apiUrl("/api/nick"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nick: name }),
      });
      if (!res.ok) throw new Error("nick failed");
    } else {
      localStorage.setItem("guest-name", name);
    }
    setNick(name);
  }

  async function postRoom(
    id: string,
    access: "public" | "password" | "invite",
    echo: string,
    password?: string,
  ) {
    try {
      const res = await fetch(apiUrl("/api/rooms"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, access, password }),
      });
      if (res.status === 409) {
        sys(`${echo}\nmkdir: ${id}: file exists`);
        return;
      }
      if (!res.ok) {
        sys(`${echo}\nmkdir: failed`);
        return;
      }
      const label =
        access === "public" ? id : `${id} (${access === "password" ? "password" : "invite"})`;
      sys(`${echo}\ncreated ${label}`);
    } catch {
      sys(`${echo}\nserver offline`);
    }
  }

  async function run(line: string) {
    const echo = `${nickRef.current}@chat:${cwdRef.current}$ ${line}`;
    if (!line.startsWith("/")) {
      sys(`${echo}\ntry /help`);
      return;
    }
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    if (cmd === "clear") {
      setFeed([]);
      return;
    }
    if (cmd === "help") {
      sys(`${echo}\n${HELP}`);
      return;
    }
    if (cmd === "ls" || cmd === "rooms") {
      try {
        const res = await fetch(apiUrl("/api/rooms"));
        const data = (await res.json()) as { rooms?: { id: string; info: string }[] };
        const list = data.rooms ?? [];
        const lines =
          cmd === "ls"
            ? list.map((r) => r.id).join("\n")
            : list.map((r) => `${r.id.padEnd(16)}${r.info}`).join("\n");
        sys(`${echo}\n${lines || "no rooms"}`);
      } catch {
        sys(`${echo}\nserver offline`);
      }
      return;
    }
    if (cmd === "mkdir") {
      if (!signedRef.current) {
        sys(`${echo}\nmkdir: permission denied`);
        return;
      }
      const name = rest[0] ?? "";
      const flag = rest[1] ?? "";
      const id = parseRoomId(name);
      if (!id || (flag && flag !== "private") || rest.length > 2) {
        sys(`${echo}\nusage: /mkdir <room> [private]`);
        return;
      }
      if (flag === "private") {
        sys(`${echo}\n${privateMenu()}`);
        gateRef.current = { kind: "mkdir-private", id, echo };
        setPromptKind("select");
        return;
      }
      await postRoom(id, "public", echo);
      return;
    }
    if (cmd === "inv") {
      if (!signedRef.current) {
        sys(`${echo}\ninv: permission denied`);
        return;
      }
      if (!roomRef.current) {
        sys(`${echo}\nnot in a room`);
        return;
      }
      if (!arg) {
        sys(`${echo}\nusage: /inv <name>`);
        return;
      }
      try {
        const res = await fetch(apiUrl(`/api/rooms/${roomRef.current}/invite`), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nick: arg }),
        });
        if (res.status === 404) {
          sys(`${echo}\ninv: no such user`);
          return;
        }
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          sys(`${echo}\ninv: ${err.error ?? "failed"}`);
          return;
        }
        sys(`${echo}\ninvited ${arg}`);
      } catch {
        sys(`${echo}\nserver offline`);
      }
      return;
    }
    if (cmd === "pwd") {
      sys(`${echo}\n${cwdRef.current}`);
      return;
    }
    if (cmd === "whoami") {
      sys(`${echo}\n${nickRef.current}`);
      return;
    }
    if (cmd === "nick") {
      if (!arg) {
        sys(`${echo}\n${nickRef.current}`);
        return;
      }
      const name = arg.slice(0, 24);
      try {
        await saveNick(name);
        sys(`${echo}\nnickname is ${name}`);
      } catch {
        sys(`${echo}\nnick failed`);
      }
      return;
    }
    if (cmd === "auth") {
      sys(`${echo}\n${authMenu(signedRef.current ? nickRef.current : null)}`);
      gateRef.current = { kind: "auth" };
      setPromptKind("select");
      return;
    }
    if (cmd === "passwd") {
      sys(`${echo}\nno password - use /auth (Google / GitHub)`);
      return;
    }
    if (cmd === "logout") {
      await authClient.signOut();
      setSignedIn(false);
      const guest = loadGuestName();
      setNick(guest);
      sys(`${echo}\nsigned out`);
      return;
    }
    if (cmd === "who") {
      if (!roomRef.current) {
        sys(`${echo}\nnot in a room`);
        return;
      }
      const names = [...new Set([...inbox.current.map((m) => m.sender), nickRef.current])];
      sys(`${echo}\n${names.join("\n")}`);
      return;
    }
    if (cmd === "ssh") {
      if (!arg) {
        sys(`${echo}\nusage: /ssh user@room`);
        return;
      }
      const { room } = parseSsh(arg);
      const id = parseRoomId(room);
      if (!id) {
        sys(`${echo}\nssh: could not resolve hostname ${room}`);
        return;
      }
      if (roomRef.current === id) {
        sys(`${echo}\nalready in ${id}`);
        return;
      }
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        sys(`${echo}\nserver offline`);
        return;
      }
      pendingJoin.current = { room: id, echo };
      wsRef.current.send(JSON.stringify({ type: "join", room: id, password: passRef.current[id] }));
      return;
    }
    if (cmd === "exit") {
      if (!roomRef.current) {
        sys(`${echo}\nnot in a room`);
        return;
      }
      roomRef.current = null;
      pendingJoin.current = null;
      gateRef.current = null;
      inbox.current = [];
      wsRef.current?.send(JSON.stringify({ type: "leave" }));
      setPromptKind("shell");
      setCwd("~");
      setFeed([{ id: `sys-${++sysN.current}`, sender: "", body: `${echo}\nleft room` }]);
      return;
    }
    if (cmd === "voice" || cmd === "mute" || cmd === "deafen") {
      sys(`${echo}\nvoice is not online yet`);
      return;
    }
    sys(`${echo}\n/${cmd}: command not found`);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !nick) return;
    setText("");
    setHint("");
    const gate = gateRef.current;
    if (gate) {
      if (gate.kind === "auth") {
        gateRef.current = null;
        setPromptKind("shell");
        if (body === "1" || body === "2") {
          const provider = body === "1" ? "google" : "github";
          const { error } = await authClient.signIn.social({
            provider,
            callbackURL: location.origin,
          });
          if (error) sys(error.message ?? "login failed");
          return;
        }
        sys("cancelled");
        return;
      }
      if (gate.kind === "mkdir-private") {
        if (body === "1") {
          gateRef.current = { kind: "mkdir-pass", id: gate.id, echo: gate.echo };
          setPromptKind("password");
          return;
        }
        gateRef.current = null;
        setPromptKind("shell");
        if (body === "2") {
          await postRoom(gate.id, "invite", gate.echo);
          return;
        }
        sys("cancelled");
        return;
      }
      if (gate.kind === "mkdir-pass") {
        gateRef.current = null;
        setPromptKind("shell");
        await postRoom(gate.id, "password", gate.echo, body);
        return;
      }
      if (gate.kind === "ssh-pass") {
        passRef.current[gate.room] = body;
        setPromptKind("shell");
        gateRef.current = null;
        pendingJoin.current = { room: gate.room, echo: gate.echo };
        wsRef.current?.send(JSON.stringify({ type: "join", room: gate.room, password: body }));
        return;
      }
    }
    if (body.startsWith("/") || !roomRef.current) {
      await run(body);
      return;
    }
    try {
      const res = await fetch(apiUrl("/api/messages"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sender: nick,
          body,
          room: roomRef.current,
          password: passRef.current[roomRef.current],
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setHint(err.error ?? "send failed");
        setText(body);
      }
    } catch (err) {
      console.error("[API] /api/messages failed:", err);
      setHint("server offline");
      setText(body);
    }
  }

  return (
    <div className="shell" onPointerDown={() => inputRef.current?.focus()}>
      <div className="shader-frame">
        <CrtBackground
          variant="terminal"
          speed={1.0}
          typeSpeed={1.0}
          motion={1.0}
          hue={0}
          saturation={1.0}
          brightness={1.0}
          opacity={1.0}
          messages={feed}
          live={live}
          joined={Boolean(nick)}
          nick={nick}
          draft={text}
          hint={hint}
          cwd={cwd}
          promptKind={promptKind}
        />
      </div>
      <ol className="sr-only" aria-live="polite">
        {feed.map((msg) => (
          <li key={msg.id}>{msg.sender ? `${msg.sender}: ${msg.body}` : msg.body}</li>
        ))}
      </ol>
      <form className="ghost" onSubmit={send}>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          type={promptKind === "password" ? "password" : "text"}
          aria-label="Command"
          required
          autoFocus
        />
      </form>
      <audio ref={noiseRef} src={NOISE} loop preload="auto" />
    </div>
  );
}
