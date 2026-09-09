"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { HELP, ROOMS, authMenu, parseSsh } from "@/lib/shell";
import { CrtBackground } from "@/src/shaders/crt/CrtBackground";
import type { CrtChatLine } from "@/src/shaders/crt/crtRenderer";

type Message = {
  id: string;
  roomId: string;
  sender: string;
  body: string;
  createdAt: number;
};

const CMDS = new Set([
  "ls",
  "rooms",
  "ssh",
  "exit",
  "pwd",
  "whoami",
  "nick",
  "auth",
  "passwd",
  "logout",
  "who",
  "clear",
  "help",
  "voice",
  "mute",
  "deafen",
]);

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

function asLines(list: Message[]): CrtChatLine[] {
  return list.map((m) => ({ id: m.id, sender: m.sender, body: m.body }));
}

export function Chat() {
  const [nick, setNick] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [text, setText] = useState("");
  const [hint, setHint] = useState("type help");
  const [live, setLive] = useState(false);
  const [cwd, setCwd] = useState("~");
  const [authSelect, setAuthSelect] = useState(false);
  const [feed, setFeed] = useState<CrtChatLine[]>([]);
  const seen = useRef(new Set<string>());
  const inbox = useRef<Message[]>([]);
  const roomRef = useRef<string | null>(null);
  const nickRef = useRef("");
  const signedRef = useRef(false);
  const cwdRef = useRef("~");
  const sysN = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
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
    const push = (list: Message[]) => {
      const fresh: Message[] = [];
      for (const msg of list) {
        if (seen.current.has(msg.id)) continue;
        seen.current.add(msg.id);
        inbox.current.push(msg);
        fresh.push(msg);
      }
      if (!fresh.length || roomRef.current !== "guest") return;
      setFeed((prev) => [...prev, ...asLines(fresh)]);
    };
    const connect = () => {
      if (stop) return;
      ws = new WebSocket(wsUrl());
      ws.onopen = () => setLive(true);
      ws.onclose = () => {
        setLive(false);
        if (!stop) timer = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        const data = JSON.parse(String(ev.data)) as
          { type: "history"; messages: Message[] } | { type: "message"; message: Message };
        if (data.type === "history") push(data.messages);
        else push([data.message]);
      };
    };
    connect();
    return () => {
      stop = true;
      clearTimeout(timer);
      ws?.close();
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

  async function run(line: string) {
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ").trim();
    const echo = `${nickRef.current}@chat:${cwdRef.current}$ ${line}`;
    if (cmd === "clear") {
      setFeed([]);
      return;
    }
    if (cmd === "help") {
      sys(`${echo}\n${HELP}`);
      return;
    }
    if (cmd === "ls") {
      sys(`${echo}\n${Object.keys(ROOMS).join("\n")}`);
      return;
    }
    if (cmd === "rooms") {
      const rows = Object.entries(ROOMS).map(([id, info]) => `${id.padEnd(8)}${info}`);
      sys(`${echo}\n${rows.join("\n")}`);
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
      setAuthSelect(true);
      return;
    }
    if (cmd === "passwd") {
      sys(`${echo}\nno password - use auth (Google / GitHub)`);
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
      if (roomRef.current !== "guest") {
        sys(`${echo}\nnot in a room`);
        return;
      }
      const names = [...new Set([...inbox.current.map((m) => m.sender), nickRef.current])];
      sys(`${echo}\n${names.join("\n")}`);
      return;
    }
    if (cmd === "ssh") {
      if (!arg) {
        sys(`${echo}\nusage: ssh user@room`);
        return;
      }
      const { room } = parseSsh(arg);
      if (!(room in ROOMS)) {
        sys(`${echo}\nssh: could not resolve hostname ${room}`);
        return;
      }
      if (roomRef.current === room) {
        sys(`${echo}\nalready in ${room}`);
        return;
      }
      roomRef.current = room;
      setCwd(`~/${room}`);
      setFeed([...asLines(inbox.current), { id: `sys-${++sysN.current}`, sender: "", body: echo }]);
      return;
    }
    if (cmd === "exit") {
      if (!roomRef.current) {
        sys(`${echo}\nnot in a room`);
        return;
      }
      roomRef.current = null;
      setCwd("~");
      setFeed([{ id: `sys-${++sysN.current}`, sender: "", body: `${echo}\nleft room` }]);
      return;
    }
    if (cmd === "voice" || cmd === "mute" || cmd === "deafen") {
      sys(`${echo}\nvoice is not online yet`);
      return;
    }
    sys(`${echo}\n${cmd}: command not found`);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !nick) return;
    setText("");
    setHint("");
    if (authSelect) {
      setAuthSelect(false);
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
    const cmd = body.split(/\s+/)[0] ?? "";
    if (CMDS.has(cmd) || roomRef.current !== "guest") {
      await run(body);
      return;
    }
    try {
      const res = await fetch(apiUrl("/api/messages"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender: nick, body }),
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
          authSelect={authSelect}
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
          aria-label="Command"
          required
          autoFocus
        />
      </form>
    </div>
  );
}
