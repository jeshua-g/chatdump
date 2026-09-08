"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { CrtBackground } from "@/src/shaders/crt/CrtBackground";

type Message = {
  id: string;
  roomId: string;
  sender: string;
  body: string;
  createdAt: number;
};

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

const ADJ = ["Amber", "Copper", "Quiet", "Warm", "Pale", "Dim", "Soft", "Late", "Rust", "Moss", "Pine", "Ash", "Faint", "Cold", "Dull", "Slow"];
const NOUN = ["Moth", "Wren", "Maple", "Fern", "Fox", "Kite", "Reed", "Lark", "Birch", "Crow", "Thorn", "Finch", "Hare", "Tern", "Rook", "Vine"];

function guestName() {
  return `${ADJ[(Math.random() * ADJ.length) | 0]} ${NOUN[(Math.random() * NOUN.length) | 0]}`;
}

export function Chat() {
  const [nick, setNick] = useState("");
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const [live, setLive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const seen = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem("guest-name");
    const name = stored && stored.length <= 24 ? stored : guestName();
    localStorage.setItem("guest-name", name);
    setNick(name);
  }, []);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let ws: WebSocket | undefined;
    const push = (list: Message[]) => {
      setMessages((prev) => {
        const next = [...prev];
        for (const msg of list) {
          if (seen.current.has(msg.id)) continue;
          seen.current.add(msg.id);
          next.push(msg);
        }
        return next;
      });
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
          | { type: "history"; messages: Message[] }
          | { type: "message"; message: Message };
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

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !nick) return;
    setText("");
    setHint("");
    try {
      const res = await fetch(apiUrl("/api/messages"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender: nick, body }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setHint(err.error ?? "send failed");
        setText(body);
      }
    } catch {
      setHint("server offline");
      setText(body);
    }
  }

  return (
    <div className="shell" onPointerDown={() => inputRef.current?.focus()}>
      <div className="shader-frame">
        <CrtBackground
          variant="terminal"
          speed={1.00}
          typeSpeed={1.00}
          motion={1.00}
          hue={0}
          saturation={1.00}
          brightness={1.00}
          opacity={1.00}
          messages={messages}
          live={live}
          joined={Boolean(nick)}
          nick={nick}
          draft={text}
          hint={hint}
        />
      </div>
      <ol className="sr-only" aria-live="polite">
        {messages.map((msg) => (
          <li key={msg.id}>
            {msg.sender}: {msg.body}
          </li>
        ))}
      </ol>
      <form className="ghost" onSubmit={send}>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          autoComplete="off"
          aria-label="Message"
          required
          autoFocus
        />
      </form>
    </div>
  );
}
