"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  roomId: string;
  sender: string;
  body: string;
  createdAt: number;
};

function apiUrl(path: string) {
  return process.env.NODE_ENV === "development" ? `http://127.0.0.1:3000${path}` : path;
}

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const host = process.env.NODE_ENV === "development" ? `${location.hostname}:3000` : location.host;
  return `${proto}//${host}/ws`;
}

export function Chat() {
  const [nick, setNick] = useState("");
  const [joined, setJoined] = useState(false);
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const [live, setLive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const seen = useRef(new Set<string>());
  const logRef = useRef<HTMLOListElement>(null);

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

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

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
  }

  return (
    <div className="app">
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
