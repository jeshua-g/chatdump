# chatdump

A self-hosted guest chat that looks like a Unix box.

Live: [chat.jdump.com](https://chat.jdump.com) · API: [chat-api.jdump.com](https://chat-api.jdump.com)

This is a small personal project, not a company product. The guest room is public and plaintext. Do not post secrets. There is no uptime promise — the static site can load while the VPS is dark. That last sentence is a feature, not an apology. It is why the architecture looks the way it does.

If you are here to collaborate, this is the map. If you are here to interview, this is the story of the decisions.

---

## What it is

You open the site. You get a CRT terminal (or a quieter sidebar skin). You type slash commands.

```
chatdump
type /help  ·  /host  ·  /ssh guest
```

Anyone can sit in `guest`. Messages last about 24 hours. Sends are rate-limited by IP. Guests get a generated name (`Late Lark`, `Moss Finch`) stored in `localStorage`.

Sign in with Google or GitHub if you want a persistent nick and rooms of your own: public, password, or invite-only. Join a room the way you would SSH:

```
/ssh user@lounge
```

The server answers in SSH dialect when a room is missing (`ssh: could not resolve hostname …`). That is not a joke layered on later. The terminal *is* the product.

`/host` opens a browser-to-browser peer room (Trystero, max 6). No server history. No relay on this Cloudflare account. If the VPS is down, chat still happens — just not through us.

Voice (`/voice`, `/mute`, `/deafen`) is stubbed. The commands exist. They say `voice is not online yet`.

---

## Why it looks like this

The first commit, 9 September 2026, was a single box: Next.js UI, Node + SQLite + WebSocket, Dockerized, meant to live on a VPS. That is the honest starting point — a guest book you own.

Then the cost and the failure mode showed up.

Constraints, not taste, split the stack:

1. **The UI is static.** Next.js is configured as `output: "export"`. Cloudflare serves `out/` as Worker assets (`wrangler.toml`). Global, cheap, almost no ops.
2. **The API is stateful.** Hono, WebSockets, SQLite, sessions. That cannot be a static asset. It runs in Docker on a private VPS, published as `chat-api.jdump.com` through a Cloudflare Tunnel. Cookies are set on `.jdump.com` so the two hostnames share a login.
3. **The VPS can die.** Terms of service say so. So `/host` is not a party trick. It is the fallback: a mesh in the browser when the origin of truth is unreachable.

```
  browser ──HTTPS/WSS──►  chat-api.jdump.com   (VPS · Hono · SQLite)
     │                           │
     │                     Cloudflare Tunnel
     │
     └──static─────────►  chat.jdump.com       (Cloudflare · Next export)
     │
     └──/host──────────►  Trystero mesh         (WebRTC, no our relay)
```

One process on the VPS does HTTP and WebSocket. One SQLite file holds chat, guest limits, nicks, rooms, invites, and better-auth. WAL mode, `busy_timeout`, a singleton `openDb()` so auth and chat never open the file twice.

Guest abuse is treated as a data problem, not a dashboard: cooldown, window cap, 24-hour prune. IP comes from `cf-connecting-ip` / `x-forwarded-for`. REST returns 429. The socket returns `nack`.

---

## A week, in order

This repo is about fifty commits, most of them in three days. The order matters more than the count.

| When | What actually changed |
|------|------------------------|
| First commit | One-box guest chat. UI and API together. Docker. |
| Same day | Split: UI to Cloudflare, VPS keeps API/WS only. Then a deploy fix so the Next export is Worker assets, not a guess. |
| Same day | Guest TTL (24h). Server-side limits. Rate limit that was forgotten, then added. SQLite WAL. CI. |
| Same day | Google / GitHub via better-auth. Custom rooms. Commands rewritten until the UX was a shell. |
| Same day | Vault Boy watermark. CRT static (an analog noise loop). Mobile. Settings. Alt-tab reconnect — a backgrounded tab must wake the socket. |
| Next days | Sidebar / minimal skin. Typing indicators. Format gate in CI. Async scrypt for room passwords. Room-scoped socket fanout instead of broadcasting every message to every connection. |
| Then | `/host` — if the VPS is down, talk peer to peer. |

Read that as a design log, not a changelog. The product started as “I want a guest chat on my VPS.” It became “static at the edge, state on a box I control, and a path that still works when the box is gone.” Everything else is furniture on that frame: CRT shaders, mentions, `/sudo`, invite links.

The npm package is still named `mychat`. The product is chatdump. Nobody renamed the `package.json`. That is also the project.

---

## Two skins, one client

`components/Chat.tsx` is the whole interactive app — commands, WebSocket, auth, P2P, skin switch. About fourteen hundred lines. There is no Next API route. The frontend is a client.

**CRT** is the default. Chat is painted to an offscreen 2D canvas (phosphor, scan, Vault Boy), then a WebGL fragment shader does curvature, grain, and analogue faults. The real input is an invisible full-screen field. Screen readers get an `sr-only` live region so the canvas is not the only copy of the log.

**Minimal** is a shadcn sidebar: rooms, bubbles, a home guide. Preference lives in `localStorage` (`chat-skin`). `/settings` toggles. `/noise` toggles the CRT hiss.

Same wire protocol in both skins. Peer rooms reuse the same `Wire` union as the WebSocket, so one handler applies server messages and mesh messages.

---

## Rooms and identity

| Who | What they can do |
|-----|------------------|
| Guest | `guest` room. Ephemeral. IP limits. Generated nick. |
| Signed in | Persist `/nick`. `/mkdir` rooms. Own, invite, delete. |
| Owner (`OWNER_ID` / `OWNER_EMAIL`) | `/sudo kick`, `/sudo wall`, `/sudo rmdir` |

Room access: `public` · `password` (async scrypt, timing-safe compare) · `invite` (URL `/?join=room&t=…` or `/inv <nick>`).

Room ids are `[a-z0-9][a-z0-9-]{0,23}`. `/mkdir Lounge` becomes `lounge`.

---

## Commands

From `lib/shell.ts` — this is what `/help` prints.

**Rooms:** `/host` `/ls` `/rooms` `/myrooms` `/mkdir` `/rmdir` `/inv` `/link` `/ssh` `/exit` `/pwd`

**Identity:** `/whoami` `/nick` `/auth` `/passwd` `/logout`

**People:** `/who` · `@name` (Tab completes; a mention beeps)

**UI:** `/clear` `/help` `/settings` `/noise`

**Root (owner):** `/sudo rmdir` `/sudo kick` `/sudo wall`

**Voice (not built):** `/voice` `/mute` `/deafen`

`/passwd` is in the help text. Treat it as reserved.

---

## Running it

Node **≥ 22.5** (native `node:sqlite`, `--experimental-strip-types` in dev).

```fish
npm ci
npm run dev
```

- UI: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- API / WS: [http://127.0.0.1:3000](http://127.0.0.1:3000)

`concurrently` runs both. In development the client hardcodes the API to `127.0.0.1:3000`.

Production-shaped API:

```fish
npm run build
npm start
```

Static frontend only (`out/` for Wrangler):

```fish
npm run build:web
```

Set `NEXT_PUBLIC_API_URL` if the API is not `https://chat-api.jdump.com`.

Docker (API only — the image never builds Next):

```fish
docker compose up --build
```

Host bind is `127.0.0.1:3001` so it does not collide with whatever else is on 3000. Data lives in the `chat-data` volume. Healthcheck hits `/api/health`.

Copy `.env.example`. `CORS_ORIGIN` must be the real UI origin (the example file has a typo). `BETTER_AUTH_SECRET` is required for login in anything that is not a toy.

| Variable | Role |
|----------|------|
| `PORT` | Listen port (default 3000) |
| `DATA_DIR` | SQLite directory (`./data` locally, `/data` in Docker) |
| `CORS_ORIGIN` | Comma-separated browser origins |
| `GUEST_LIMIT` | Max guest sends per window (50) |
| `GUEST_WINDOW_MIN` | Window length (30) |
| `GUEST_COOLDOWN_SEC` | Min seconds between guest sends (2) |
| `GUEST_TTL_HOURS` | Guest message retention (24) |
| `BETTER_AUTH_SECRET` | Session signing |
| `BETTER_AUTH_URL` | Public API URL (OAuth callbacks) |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Cookie / OAuth origins |
| `GITHUB_*` / `GOOGLE_*` | Omit either pair to disable that provider |
| `OWNER_EMAIL` / `OWNER_ID` | Who `/sudo` answers to |
| `NEXT_PUBLIC_API_URL` | Frontend build-time API base |

Quality gate (this is what CI runs):

```fish
npm run ci
```

Prettier, ESLint, `src/check.ts` (DB + P2P self-test, no Jest), `npm audit --audit-level=high`. There is no deploy workflow. Wrangler and Docker are done by hand.

---

## Repo map

| Path | What it is |
|------|------------|
| `app/page.tsx` | Renders `<Chat />`. The only interactive page. |
| `app/privacy` · `app/terms` | The product, in legal prose. Read these first if you want intent. |
| `components/Chat.tsx` | Shell, socket, auth, P2P, skins. |
| `components/MiniChat.tsx` | Minimal UI. |
| `components/ui/` | shadcn pieces. |
| `lib/shell.ts` | Help text, SSH parse, room id rules. |
| `lib/p2p.ts` | Trystero rooms. Shared `Wire` types. Mesh cap 6. |
| `lib/auth-client.ts` | better-auth browser client, credentials included. |
| `src/server.ts` | Hono HTTP + WebSocket. Room fanout. `/sudo`. |
| `src/db.ts` | Schema, limits, rooms, `publish()`. |
| `src/auth.ts` | better-auth. Same SQLite connection. |
| `src/check.ts` | The test suite. Throws or prints `ok`. |
| `src/shaders/crt/` | Canvas → texture → CRT fragment shader. |
| `public/vaultboy.webp` | The easter egg. Long-cached. |
| `Dockerfile` · `docker-compose.yml` | API image and VPS compose. |
| `wrangler.toml` | Cloudflare static deploy. SPA fallback. |

Pages: `/` · `/privacy` · `/terms`.

---

## Protocol, briefly

REST lives under `/api/*`. CORS + cookies. Useful ones: `/api/health`, `/api/auth/*`, `/api/me`, `/api/nick`, `/api/rooms`, `/api/my-rooms`, invite/delete/link, `/api/sudo`. `/api/messages` is mostly leftover REST for the guest room. Rooms travel over the socket.

WebSocket: `/ws`.

Client → server: `join` `leave` `nick` `who` `typing:start` `typing:stop` `send`

Server → client: `history` `message` `presence` `typing:*` `sys` `error` `auth` `kicked` `nack`

Typing auto-stops on the server after 5s. The client debounces a stop at 3s. Sockets are dropped if `send` throws or the readyState is closing. Coming back from another tab re-joins. That last one was a real bug, not a design essay.

Peer rooms hash the URL token with SHA-256, show a 6-character label, sync the last 100 messages to newcomers, and refuse a seventh peer.

---

## What is unfinished

- **Voice.** Commands are placeholders.
- **`/passwd`.** Listed, not a real password-account flow. Login is OAuth.
- **P2P on strict NAT.** No relay we pay for. Join can fail. The UI says so.
- **Deploy automation.** CI checks. Humans ship.
- **`cloudflared` in compose.** It was added, then the tunnel moved off this file. The privacy page still describes the tunnel. That is still how production is meant to work.

---

## If you are collaborating

Start with `lib/shell.ts` and `src/db.ts`. The UI is a shell over those two. Then `src/server.ts` for the socket, then `Chat.tsx` for everything the user touches.

Keep the split. Do not put WebSockets on Cloudflare. Do not put the Next app back in the Docker image. Do not add a test framework for one more assertion — extend `src/check.ts`.

Guest messages stay plaintext and short-lived on purpose. If you add persistence, say so on `/privacy`.

---

## If you are interviewing

The interesting part is not “I used Next and Hono.” It is a week of shipping under a real hosting split:

- Static export because the UI does not need a server.
- One Node process and one SQLite file because the API does.
- Room-scoped fanout after it was obvious that broadcasting everything would not age.
- Async scrypt because `scryptSync` on the event loop is how you stall your own chat.
- A peer fallback because the terms already admitted the VPS can be offline.
- A CRT that is a 2D buffer plus one triangle, with a pixel budget, because the fragment shader is not the expensive part — the upload is.

The code is small enough to read in an afternoon. The commit messages are not cleaned up for this document. That is the record.

Contact: [jeshua@jeshuagalao.dev](mailto:jeshua@jeshuagalao.dev)
