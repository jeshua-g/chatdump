"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  joinPeerRoom,
  mintToken,
  peerLink,
  roomLabel as peerRoomLabel,
  tokenFromHash,
  type PeerRoom,
  type Wire,
} from "@/lib/p2p";
import { authMenu, helpText, parseRoomId, parseSsh, privateMenu, settingsMenu } from "@/lib/shell";
import { MiniChat } from "@/components/MiniChat";
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
const MOTD = "chatdump\ntype /help  ·  /host  ·  /ssh guest";

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

function inviteUrl(room: string, token: string) {
  return `${location.origin}/?join=${encodeURIComponent(room)}&t=${encodeURIComponent(token)}`;
}

function typingLine(names: string[]) {
  if (!names.length) return "";
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  const extra = names.length - 2;
  return `${names[0]}, ${names[1]}, and ${extra} other${extra === 1 ? "" : "s"} are typing...`;
}

function mentioned(body: string, nick: string) {
  const needle = `@${nick.toLowerCase()}`;
  const hay = body.toLowerCase();
  let from = 0;
  while (from < hay.length) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return false;
    const after = i + needle.length;
    if (after >= body.length || /\W/.test(body[after])) return true;
    from = i + 1;
  }
  return false;
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.06;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.09);
    o.onended = () => void ctx.close();
  } catch {
    /* no audio */
  }
}

function loadHist(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem("shell-hist") ?? "[]") as unknown;
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string").slice(-50)
      : [];
  } catch {
    return [];
  }
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
  | { kind: "settings" }
  | { kind: "mkdir-private"; id: string; echo: string }
  | { kind: "mkdir-pass"; id: string; echo: string }
  | { kind: "ssh-pass"; room: string; echo: string };

function asLines(list: Message[]): CrtChatLine[] {
  return list.map((m) => ({ id: m.id, sender: m.sender, body: m.body }));
}

function loadSkin(): "crt" | "min" {
  try {
    return localStorage.getItem("chat-skin") === "crt" ? "crt" : "min";
  } catch {
    return "min";
  }
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
  const [skin, setSkin] = useState<"crt" | "min">("min");
  const [rooms, setRooms] = useState<{ id: string }[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [typers, setTypers] = useState<string[]>([]);
  const seen = useRef(new Set<string>());
  const inbox = useRef<Message[]>([]);
  const roomRef = useRef<string | null>(null);
  const pendingJoin = useRef<{ room: string; echo: string } | null>(null);
  const gateRef = useRef<Gate | null>(null);
  const passRef = useRef<Record<string, string>>({});
  const tokenRef = useRef<Record<string, string>>({});
  const presenceRef = useRef<string[]>([]);
  const histRef = useRef<string[]>([]);
  const histI = useRef(-1);
  const stashRef = useRef("");
  const mentionI = useRef(-1);
  const urlJoin = useRef<{ room: string; token: string } | null>(null);
  const hissOn = useRef(true);
  const skinRef = useRef<"crt" | "min">("min");
  const booted = useRef(false);
  const wsRef = useRef<WebSocket | undefined>(undefined);
  const peerRef = useRef<PeerRoom | null>(null);
  const peerMode = useRef(false);
  const linkRef = useRef("");
  const joining = useRef(false);
  const applyRef = useRef<(data: Wire) => void>(() => {});
  const nickRef = useRef("");
  const signedRef = useRef(false);
  const adminRef = useRef(false);
  const meIdRef = useRef("");
  const cwdRef = useRef("~");
  const sysN = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingOn = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noiseRef = useRef<HTMLAudioElement>(null);
  nickRef.current = nick;
  signedRef.current = signedIn;
  cwdRef.current = cwd;
  skinRef.current = skin;

  function host() {
    return signedRef.current ? "chat" : "anon";
  }

  function applySkin(next: "crt" | "min") {
    skinRef.current = next;
    setSkin(next);
    localStorage.setItem("chat-skin", next);
    document.documentElement.classList.toggle("skin-min", next === "min");
    document.documentElement.classList.toggle("dark", next === "min");
    const el = noiseRef.current;
    if (!el) return;
    if (next === "min") el.pause();
    else if (hissOn.current) void el.play().catch(() => {});
  }

  function sys(body: string) {
    sysN.current += 1;
    setFeed((prev) => [...prev, { id: `sys-${sysN.current}`, sender: "", body }]);
  }

  function setPresence(names: string[]) {
    presenceRef.current = names;
    setPeople(names);
    setTypers((prev) => prev.filter((n) => names.includes(n)));
  }

  function emit(obj: { type: string; body?: string; nick?: string }) {
    const peer = peerRef.current;
    if (peer) {
      if (obj.type === "send" && obj.body) peer.send(obj.body);
      else if (obj.type === "typing:start") peer.typing(true);
      else if (obj.type === "typing:stop") peer.typing(false);
      else if (obj.type === "nick" && obj.nick) peer.setNick(obj.nick);
      else if (obj.type === "leave") peer.leave();
      return true;
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  function stopTyping() {
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    if (!typingOn.current) return;
    typingOn.current = false;
    emit({ type: "typing:stop" });
  }

  function pingTyping() {
    if (!roomRef.current || promptKind !== "shell") return;
    if (!typingOn.current) {
      if (!emit({ type: "typing:start" })) return;
      typingOn.current = true;
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 3000);
  }

  function enterRoom(id: string) {
    if (peerMode.current) {
      setHint("no server");
      return;
    }
    if (roomRef.current === id) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setHint("server offline");
      return;
    }
    stopTyping();
    pendingJoin.current = { room: id, echo: `join ${id}` };
    ws.send(JSON.stringify(joinMsg(id)));
  }

  function leaveRoom() {
    if (!roomRef.current) return;
    stopTyping();
    const peer = peerRef.current;
    peerRef.current = null;
    linkRef.current = "";
    joining.current = false;
    if (peer) {
      peer.leave();
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      setLive(false);
    } else {
      wsRef.current?.send(JSON.stringify({ type: "leave" }));
    }
    roomRef.current = null;
    pendingJoin.current = null;
    gateRef.current = null;
    inbox.current = [];
    setPresence([]);
    setTypers([]);
    setPromptKind("shell");
    setCwd("~");
    setFeed([{ id: `sys-${++sysN.current}`, sender: "", body: "left room" }]);
  }

  async function startPeer(token: string, url?: string) {
    if (peerRef.current || joining.current) return;
    joining.current = true;
    peerMode.current = true;
    if (url) linkRef.current = url;
    wsRef.current?.close();
    try {
      pendingJoin.current = { room: await peerRoomLabel(token), echo: "join link" };
      const room = await joinPeerRoom(
        token,
        () => nickRef.current,
        (ev) => applyRef.current(ev),
      );
      peerRef.current = room;
      if (url) linkRef.current = url;
      setLive(true);
    } catch (err) {
      joining.current = false;
      throw err;
    }
    joining.current = false;
  }

  function joinMsg(room: string) {
    return {
      type: "join",
      room,
      nick: nickRef.current,
      password: passRef.current[room],
      token: tokenRef.current[room],
    };
  }

  function remember(line: string) {
    if (!line || histRef.current[histRef.current.length - 1] === line) return;
    histRef.current = [...histRef.current, line].slice(-50);
    localStorage.setItem("shell-hist", JSON.stringify(histRef.current));
  }

  function tryUrlJoin() {
    const j = urlJoin.current;
    const ws = wsRef.current;
    if (!j || !nickRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
    urlJoin.current = null;
    if (roomRef.current === j.room) return;
    pendingJoin.current = { room: j.room, echo: `join ${j.room}` };
    ws.send(JSON.stringify(joinMsg(j.room)));
  }

  function mentionMatches(value: string) {
    const at = value.lastIndexOf("@");
    if (at < 0) return [];
    const prefix = value.slice(at + 1).toLowerCase();
    if (
      prefix.includes(" ") &&
      !presenceRef.current.some((n) => n.toLowerCase().startsWith(prefix))
    ) {
      return [];
    }
    return presenceRef.current.filter(
      (n) => n !== nickRef.current && n.toLowerCase().startsWith(prefix),
    );
  }

  function applyHint(value: string) {
    const hits = mentionMatches(value);
    if (value.includes("@") && hits.length) setHint(`tab: ${hits.join("  ")}`);
    else if (!value) setHint("type /help");
    else setHint("");
  }

  function loadRooms() {
    if (peerMode.current) return;
    fetch(apiUrl("/api/rooms"))
      .then((r) => r.json())
      .then((d: { rooms?: { id: string }[] }) => setRooms(d.rooms ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    histRef.current = loadHist();
    hissOn.current = localStorage.getItem("crt-noise") !== "off";
    applySkin(loadSkin());
    const peerTok = tokenFromHash(location.hash);
    if (peerTok) {
      peerMode.current = true;
      const guest = loadGuestName();
      nickRef.current = guest;
      setNick(guest);
    }
    const q = new URLSearchParams(location.search);
    const room = parseRoomId(q.get("join") ?? "");
    const token = q.get("t") ?? "";
    if (room && token) {
      tokenRef.current[room] = token;
      urlJoin.current = { room, token };
    }
    sys(MOTD);
  }, []);

  useEffect(() => {
    if (skin !== "min") return;
    loadRooms();
  }, [skin, live]);

  useEffect(() => {
    if (peerMode.current) return;
    let stop = false;
    void (async () => {
      const { data } = await authClient.getSession();
      if (stop) return;
      const user = data?.user;
      if (!user) {
        setSignedIn(false);
        setNick(loadGuestName());
        return;
      }
      setSignedIn(true);
      meIdRef.current = user.id;
      let nick = (user.name || loadGuestName()).slice(0, 24);
      try {
        const res = await fetch(apiUrl("/api/me"), { credentials: "include" });
        if (res.ok) {
          const me = (await res.json()) as {
            nick?: string;
            admin?: boolean;
            id?: string;
            hasNick?: boolean;
          };
          if (stop) return;
          adminRef.current = Boolean(me.admin);
          if (me.id) meIdRef.current = me.id;
          const guest = localStorage.getItem("guest-name")?.trim().slice(0, 24);
          if (!me.hasNick && guest) {
            const saved = await fetch(apiUrl("/api/nick"), {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ nick: guest }),
            });
            if (saved.ok) nick = guest;
            else nick = (me.nick || nick).slice(0, 24);
          } else {
            nick = (me.nick || nick).slice(0, 24);
          }
        }
      } catch {
        /* keep oauth / guest nick */
      }
      if (!stop) setNick(nick);
    })();
    return () => {
      stop = true;
    };
  }, []);

  applyRef.current = (data) => {
    if (data.type === "typing:start") {
      const who = data.nick;
      if (who && who !== nickRef.current) {
        setTypers((prev) => (prev.includes(who) ? prev : [...prev, who]));
      }
      return;
    }
    if (data.type === "typing:stop") {
      const who = data.nick;
      if (who) setTypers((prev) => prev.filter((n) => n !== who));
      return;
    }
    if (data.type === "presence") {
      setPresence(data.names);
      return;
    }
    if (data.type === "sys") {
      sys(data.body);
      return;
    }
    if (data.type === "nack") {
      setHint(data.error ?? "send failed");
      if (data.body) setText(data.body);
      return;
    }
    if (data.type === "kicked") {
      roomRef.current = null;
      pendingJoin.current = null;
      gateRef.current = null;
      inbox.current = [];
      setPresence([]);
      setTypers([]);
      typingOn.current = false;
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
        typingTimer.current = null;
      }
      setPromptKind("shell");
      setCwd("~");
      setFeed([
        {
          id: `sys-${++sysN.current}`,
          sender: "",
          body: data.reason ?? "kicked",
        },
      ]);
      return;
    }
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
      setTypers([]);
      return;
    }
    if (data.type !== "message") return;
    const msg = data.message;
    if (msg.roomId !== roomRef.current || seen.current.has(msg.id)) return;
    seen.current.add(msg.id);
    inbox.current.push(msg);
    if (msg.sender !== nickRef.current && mentioned(msg.body, nickRef.current)) beep();
    setFeed((prev) => [...prev, { id: msg.id, sender: msg.sender, body: msg.body }]);
  };

  useEffect(() => {
    if (peerMode.current) return;
    let stop = false;
    let dead = false;
    let fails = 0;
    let timer: ReturnType<typeof setTimeout>;
    let ws: WebSocket | undefined;
    let hidAt = 0;
    const connect = () => {
      if (stop || dead || peerMode.current) return;
      clearTimeout(timer);
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))
        return;
      ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        fails = 0;
        setLive(true);
        if (roomRef.current) ws?.send(JSON.stringify(joinMsg(roomRef.current)));
        else tryUrlJoin();
      };
      ws.onclose = () => {
        setLive(false);
        if (stop || peerMode.current) return;
        fails += 1;
        if (fails >= 2) {
          dead = true;
          sys("api is down. /host to open a peer room");
          return;
        }
        timer = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        applyRef.current(JSON.parse(String(ev.data)) as Wire);
      };
    };
    const wake = () => {
      if (dead || peerMode.current) return;
      if (document.hidden) {
        hidAt = Date.now();
        return;
      }
      clearTimeout(timer);
      const stale = hidAt && Date.now() - hidAt > 4000;
      hidAt = 0;
      if (stale && ws && ws.readyState === WebSocket.OPEN) ws.close();
      if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
        connect();
        return;
      }
      if (ws.readyState === WebSocket.OPEN && roomRef.current) {
        ws.send(JSON.stringify(joinMsg(roomRef.current)));
      }
    };
    connect();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      stop = true;
      clearTimeout(timer);
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
        typingTimer.current = null;
      }
      if (typingOn.current && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "typing:stop" }));
      }
      typingOn.current = false;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    if (nick && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "nick", nick }));
    }
    peerRef.current?.setNick(nick);
    tryUrlJoin();
  }, [live, nick]);

  useEffect(() => {
    const token = tokenFromHash(location.hash);
    if (!token || !nickRef.current) return;
    let stop = false;
    const url = peerLink(token, location.origin);
    linkRef.current = url;
    void startPeer(token, url)
      .then(() => {
        if (stop) {
          peerRef.current?.leave();
          peerRef.current = null;
          return;
        }
        sys("peer room. max 6. dies when the last tab closes.");
      })
      .catch((err: unknown) => {
        if (!stop) sys(err instanceof Error ? err.message : "peer room failed");
      });
    return () => {
      stop = true;
      peerRef.current?.leave();
      peerRef.current = null;
      joining.current = false;
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [skin, promptKind]);

  useEffect(() => {
    const el = noiseRef.current;
    if (!el) return;
    const kick = () => {
      if (hissOn.current && skinRef.current !== "min") void el.play().catch(() => {});
    };
    const vis = () => {
      if (document.hidden || !hissOn.current || skinRef.current === "min") el.pause();
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
    emit({ type: "nick", nick: name });
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
      const made = (await res.json()) as { token?: string };
      const label =
        access === "public" ? id : `${id} (${access === "password" ? "password" : "invite"})`;
      const extra = access === "invite" && made.token ? `\n${inviteUrl(id, made.token)}` : "";
      sys(`${echo}\ncreated ${label}${extra}`);
      loadRooms();
    } catch {
      sys(`${echo}\nserver offline`);
    }
  }

  async function run(line: string) {
    const echo = `${nickRef.current}@${host()}:${cwdRef.current}$ ${line}`;
    if (!line.startsWith("/")) {
      sys(`${echo}\ntry /help`);
      return;
    }
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(" ").trim();
    if (
      peerMode.current &&
      (cmd === "ls" ||
        cmd === "rooms" ||
        cmd === "myrooms" ||
        cmd === "mkdir" ||
        cmd === "rmdir" ||
        cmd === "inv" ||
        cmd === "ssh" ||
        cmd === "sudo")
    ) {
      sys(`${echo}\nno server. this is a peer room`);
      return;
    }
    if (cmd === "host") {
      if (peerRef.current || joining.current) {
        sys(linkRef.current ? `${echo}\n${linkRef.current}` : `${echo}\nopening room`);
        return;
      }
      const token = mintToken();
      const url = peerLink(token, location.origin);
      history.replaceState(null, "", `${location.pathname}${location.search}#r=${token}`);
      try {
        await startPeer(token, url);
        let copied = false;
        try {
          await navigator.clipboard.writeText(url);
          copied = true;
        } catch {
          /* the link is on screen */
        }
        sys(
          `${echo}\n${url}\n${copied ? "copied. " : ""}max 6. room dies when the last tab closes.`,
        );
      } catch (err) {
        sys(`${echo}\n${err instanceof Error ? err.message : "peer room failed"}`);
      }
      return;
    }
    if (cmd === "clear") {
      setFeed([]);
      return;
    }
    if (cmd === "help") {
      sys(
        `${echo}\n${helpText(window.matchMedia("(max-width: 720px)").matches, adminRef.current)}`,
      );
      return;
    }
    if (cmd === "noise") {
      hissOn.current = !hissOn.current;
      localStorage.setItem("crt-noise", hissOn.current ? "on" : "off");
      const el = noiseRef.current;
      if (el) {
        if (hissOn.current && skinRef.current !== "min") void el.play().catch(() => {});
        else el.pause();
      }
      sys(`${echo}\nstatic ${hissOn.current ? "on" : "off"}`);
      return;
    }
    if (cmd === "ls" || cmd === "rooms") {
      try {
        const res = await fetch(apiUrl("/api/rooms"));
        const data = (await res.json()) as { rooms?: { id: string; info: string }[] };
        const list = data.rooms ?? [];
        const narrow = window.matchMedia("(max-width: 720px)").matches;
        const lines =
          cmd === "ls"
            ? list.map((r) => r.id).join("\n")
            : list
                .map((r) => (narrow ? `${r.id}\n  ${r.info}` : `${r.id.padEnd(16)}${r.info}`))
                .join("\n");
        sys(`${echo}\n${lines || "no rooms"}`);
      } catch {
        sys(`${echo}\nserver offline`);
      }
      return;
    }
    if (cmd === "myrooms") {
      if (!signedRef.current) {
        sys(`${echo}\nmyrooms: sign in first`);
        return;
      }
      try {
        const res = await fetch(apiUrl("/api/my-rooms"), { credentials: "include" });
        if (res.status === 401) {
          sys(`${echo}\nmyrooms: sign in first`);
          return;
        }
        const data = (await res.json()) as {
          rooms?: { id: string; access: string; role: string }[];
        };
        const list = data.rooms ?? [];
        sys(
          `${echo}\n${
            list.map((r) => `${r.id.padEnd(16)}${r.role}  ${r.access}`).join("\n") || "no rooms"
          }`,
        );
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
    if (cmd === "rmdir") {
      if (!signedRef.current) {
        sys(`${echo}\nrmdir: permission denied`);
        return;
      }
      const id = parseRoomId(arg || roomRef.current || "");
      if (!id) {
        sys(`${echo}\nusage: /rmdir [room]`);
        return;
      }
      try {
        const res = await fetch(apiUrl(`/api/rooms/${id}/delete`), {
          method: "POST",
          credentials: "include",
        });
        if (res.status === 404) {
          sys(`${echo}\nrmdir: no such room`);
          return;
        }
        if (!res.ok) {
          sys(`${echo}\nrmdir: permission denied`);
          return;
        }
        if (roomRef.current === id) {
          stopTyping();
          roomRef.current = null;
          inbox.current = [];
          setPresence([]);
          wsRef.current?.send(JSON.stringify({ type: "leave" }));
          setCwd("~");
          setFeed([{ id: `sys-${++sysN.current}`, sender: "", body: `${echo}\nremoved ${id}` }]);
        } else {
          sys(`${echo}\nremoved ${id}`);
        }
      } catch {
        sys(`${echo}\nserver offline`);
      }
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
        const data = (await res.json()) as { token?: string };
        const extra = data.token ? `\n${inviteUrl(roomRef.current, data.token)}` : "";
        sys(`${echo}\ninvited ${arg}${extra}`);
      } catch {
        sys(`${echo}\nserver offline`);
      }
      return;
    }
    if (cmd === "link") {
      if (peerMode.current) {
        sys(linkRef.current ? `${echo}\n${linkRef.current}` : `${echo}\nnot in a room`);
        return;
      }
      if (!signedRef.current) {
        sys(`${echo}\nlink: permission denied`);
        return;
      }
      if (!roomRef.current) {
        sys(`${echo}\nnot in a room`);
        return;
      }
      try {
        const res = await fetch(apiUrl(`/api/rooms/${roomRef.current}/link`), {
          credentials: "include",
        });
        if (!res.ok) {
          sys(`${echo}\nlink: not an invite room`);
          return;
        }
        const data = (await res.json()) as { token?: string };
        if (!data.token) {
          sys(`${echo}\nlink: not an invite room`);
          return;
        }
        sys(`${echo}\n${inviteUrl(roomRef.current, data.token)}`);
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
      const { data } = await authClient.getSession();
      const user = data?.user;
      if (!user) {
        meIdRef.current = "";
        adminRef.current = false;
        signedRef.current = false;
        setSignedIn(false);
        sys(`${echo}\nnick  ${nickRef.current}\nlogin guest\nid    (sign in with /auth)`);
        return;
      }
      signedRef.current = true;
      setSignedIn(true);
      let id = user.id;
      let root = false;
      try {
        const res = await fetch(apiUrl("/api/me"), { credentials: "include" });
        if (res.ok) {
          const me = (await res.json()) as { nick?: string; admin?: boolean; id?: string };
          if (me.id) id = me.id;
          root = Boolean(me.admin);
          if (me.nick) setNick(me.nick.slice(0, 24));
        }
      } catch {
        /* session is enough */
      }
      meIdRef.current = id;
      adminRef.current = root;
      sys(
        `${echo}\nnick  ${nickRef.current}\nlogin yes\nid    ${id}${root ? "\nuid=0(root)" : ""}`,
      );
      return;
    }
    if (cmd === "sudo") {
      if (!adminRef.current) {
        sys(`${echo}\nsudo: permission denied`);
        return;
      }
      const sub = rest[0] ?? "";
      const sudoArg = rest.slice(1).join(" ").trim();
      if (!sub || sub === "help") {
        sys(
          `${echo}\nusage: /sudo rmdir <room>\n       /sudo kick <nick>\n       /sudo wall <text>`,
        );
        return;
      }
      if ((sub === "kick" || sub === "wall") && !roomRef.current) {
        sys(`${echo}\nnot in a room`);
        return;
      }
      if ((sub === "kick" || sub === "wall") && !sudoArg) {
        sys(`${echo}\nusage: /sudo ${sub} ${sub === "kick" ? "<nick>" : "<text>"}`);
        return;
      }
      try {
        const res = await fetch(apiUrl("/api/sudo"), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cmd: sub,
            arg: sudoArg,
            room: roomRef.current,
          }),
        });
        if (res.status === 403) {
          sys(`${echo}\nsudo: permission denied`);
          return;
        }
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          sys(`${echo}\nsudo: ${err.error ?? "failed"}`);
          return;
        }
        if (sub === "rmdir") {
          const id = sudoArg || roomRef.current;
          if (roomRef.current && roomRef.current === id) {
            stopTyping();
            roomRef.current = null;
            inbox.current = [];
            setPresence([]);
            setCwd("~");
            setFeed([{ id: `sys-${++sysN.current}`, sender: "", body: `${echo}\nremoved ${id}` }]);
          } else {
            sys(`${echo}\nremoved ${id}`);
          }
          return;
        }
        if (sub === "kick") {
          const data = (await res.json()) as { kicked?: number };
          sys(`${echo}\n${data.kicked ? `kicked ${sudoArg}` : `sudo: ${sudoArg}: not in room`}`);
          return;
        }
        sys(`${echo}\nok`);
      } catch {
        sys(`${echo}\nserver offline`);
      }
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
    if (cmd === "settings") {
      const pick = arg.toLowerCase();
      if (pick === "crt" || pick === "1") {
        applySkin("crt");
        sys(`${echo}\nquality CRT`);
        return;
      }
      if (pick === "min" || pick === "minimal" || pick === "2") {
        applySkin("min");
        sys(`${echo}\nquality minimal`);
        return;
      }
      sys(`${echo}\n${settingsMenu(skinRef.current)}`);
      gateRef.current = { kind: "settings" };
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
      adminRef.current = false;
      meIdRef.current = "";
      const guest = loadGuestName();
      setNick(guest);
      emit({ type: "nick", nick: guest });
      sys(`${echo}\nsigned out`);
      return;
    }
    if (cmd === "who") {
      if (!roomRef.current) {
        sys(`${echo}\nnot in a room`);
        return;
      }
      const names = presenceRef.current.length ? presenceRef.current : [nickRef.current];
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
      enterRoom(id);
      return;
    }
    if (cmd === "exit") {
      if (!roomRef.current) {
        sys(`${echo}\nnot in a room`);
        return;
      }
      leaveRoom();
      return;
    }
    if (cmd === "voice" || cmd === "mute" || cmd === "deafen") {
      sys(`${echo}\nvoice is not online yet`);
      return;
    }
    sys(`${echo}\n/${cmd}: command not found`);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (promptKind === "password") return;
    if (e.key === "Tab") {
      e.preventDefault();
      const hits = mentionMatches(text);
      if (!hits.length) return;
      mentionI.current = (mentionI.current + 1) % hits.length;
      const at = text.lastIndexOf("@");
      const next = `${text.slice(0, at)}@${hits[mentionI.current]} `;
      setText(next);
      setHint(`tab: ${hits.join("  ")}`);
      return;
    }
    if (e.key === "ArrowUp") {
      if (!histRef.current.length) return;
      e.preventDefault();
      if (histI.current < 0) stashRef.current = text;
      histI.current =
        histI.current < 0 ? histRef.current.length - 1 : Math.max(0, histI.current - 1);
      setText(histRef.current[histI.current] ?? "");
      return;
    }
    if (e.key === "ArrowDown") {
      if (histI.current < 0) return;
      e.preventDefault();
      histI.current += 1;
      if (histI.current >= histRef.current.length) {
        histI.current = -1;
        setText(stashRef.current);
        return;
      }
      setText(histRef.current[histI.current] ?? "");
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !nick) return;
    stopTyping();
    setText("");
    setHint("");
    histI.current = -1;
    mentionI.current = -1;
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
      if (gate.kind === "settings") {
        gateRef.current = null;
        setPromptKind("shell");
        if (body === "1") {
          applySkin("crt");
          sys("quality CRT");
          return;
        }
        if (body === "2") {
          applySkin("min");
          sys("quality minimal");
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
        wsRef.current?.send(JSON.stringify(joinMsg(gate.room)));
        return;
      }
    }
    if (body.startsWith("/") || !roomRef.current) {
      remember(body);
      await run(body);
      return;
    }
    if (!emit({ type: "send", body })) {
      setHint("server offline");
      setText(body);
      return;
    }
  }

  const roomLabel = cwd === "~" ? "HOME" : cwd.replace(/^~\//, "");

  return (
    <div
      className={`shell${skin === "min" ? " skin-min" : ""}`}
      onPointerDown={() => inputRef.current?.focus()}
    >
      {skin === "min" ? (
        <MiniChat
          feed={feed}
          nick={nick}
          live={live}
          roomLabel={roomLabel}
          rooms={rooms}
          people={people}
          typing={typingLine(typers)}
          hint={hint}
          value={text}
          promptKind={promptKind}
          lobby={cwd === "~"}
          inputRef={inputRef}
          onChange={(next) => {
            mentionI.current = -1;
            setText(next);
            applyHint(next);
            pingTyping();
          }}
          onKeyDown={onKey}
          onSubmit={send}
          onJoin={enterRoom}
          onLeave={leaveRoom}
        />
      ) : (
        <>
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
              typing={typingLine(typers)}
              cwd={cwd}
              promptKind={promptKind}
              signed={signedIn}
            />
          </div>
          <ol className="sr-only" aria-live="polite">
            {feed.map((msg) => (
              <li key={msg.id}>{msg.sender ? `${msg.sender}: ${msg.body}` : msg.body}</li>
            ))}
          </ol>
        </>
      )}
      {skin === "min" ? null : (
        <form className="ghost" onSubmit={send}>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              mentionI.current = -1;
              setText(e.target.value);
              applyHint(e.target.value);
              pingTyping();
            }}
            onKeyDown={onKey}
            maxLength={2000}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            type={promptKind === "password" ? "password" : "text"}
            aria-label="Command"
            autoFocus
          />
        </form>
      )}
      <audio ref={noiseRef} src={NOISE} loop preload="auto" />
    </div>
  );
}
