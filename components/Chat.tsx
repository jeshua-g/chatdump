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

export function Chat() {
  const [nick, setNick] = useState("");
  const [joined, setJoined] = useState(false);
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const [live, setLive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    setNick(localStorage.getItem("nick") ?? "");
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

  function join(e: FormEvent) {
    e.preventDefault();
    const name = nick.trim();
    if (!name) return;
    localStorage.setItem("nick", name);
    setNick(name);
    setJoined(true);
  }

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
    <div className="app">
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
        />
      </div>
      <header>
        <div>
          <p className="kicker">guest room</p>
          <h1>chat.jdump</h1>
        </div>
        <p className="status" data-state={live ? "on" : "off"}>
          {live ? "live" : "offline"}
        </p>
      </header>
      <ol className="log" ref={logRef} aria-live="polite">
        {messages.map((msg) => (
          <li key={msg.id}>
            <div className="who">
              {msg.sender}{" "}
              <span className="when">
                {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <p>{msg.body}</p>
          </li>
        ))}
      </ol>
      {!joined ? (
        <form onSubmit={join}>
          <label>
            Nickname
            <input
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              maxLength={24}
              autoComplete="nickname"
              required
            />
          </label>
          <button type="submit">Join</button>
        </form>
      ) : (
        <form className="compose" onSubmit={send}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            autoComplete="off"
            placeholder="Message"
            required
            autoFocus
          />
          <button type="submit">Send</button>
        </form>
      )}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}
