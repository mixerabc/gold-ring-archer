# Deploying GOLD RING

The project has two deployable pieces:

| Piece | What it is | Where it can run |
| --- | --- | --- |
| **Client** | Static Vite build (`dist/client`) | Netlify, Vercel, Cloudflare Pages, any static host |
| **Server** | Fastify REST + WebSocket, authoritative shots | Render, Fly.io, Railway, a VPS, Docker |

Netlify and Vercel host the **client only**. Their static hosting cannot run the Fastify/WebSocket server. Deploy the server first, then point the client at it.

---

## 1. Put the project on GitHub

From the project root:

```bash
git init
git add .
git commit -m "GOLD RING: playable archery simulation"
git branch -M main
git remote add origin https://github.com/<you>/gold-ring.git
git push -u origin main
```

`node_modules/`, `dist/`, `.env`, `.tmp/` and `.workbuddy-ai/` are already ignored. Do not commit them.

Create the empty repository on GitHub first (no README, no `.gitignore`), then run the commands above.

If `git` complains about your identity:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

---

## 2. Deploy the server (Render example)

The server is required for **Online duel** and the **Leaderboard**. The rest of the game works without it.

### Option A — Render blueprint

1. Push the repo to GitHub.
2. Render → **New** → **Blueprint** → select the repo. It reads `render.yaml`.
3. Set `CORS_ORIGIN` to your client URL(s), comma-separated:
   ```
   https://your-site.netlify.app,https://your-app.vercel.app
   ```
4. Deploy. The health check is `GET /api/health`.

`render.yaml` mounts a 1 GB disk at `/app/data`, so the JSON leaderboard survives restarts. On a plan without disks, the data is ephemeral.

### Option B — Docker anywhere

```bash
docker build -f server/Dockerfile -t gold-ring-server .
docker run -p 8080:8080 \
  -e CORS_ORIGIN=https://your-site.netlify.app \
  -e DATA_DIR=/app/data \
  -v gold-ring-data:/app/data \
  gold-ring-server
```

### Environment variables

| Variable | Example | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP/WS port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `/app/data` | JSON store location |
| `CORS_ORIGIN` | `https://your-site.netlify.app` | Allowed browser origins (comma-separated) |
| `RATE_LIMIT_MAX` | `240` | Requests per minute per IP |
| `LOG_LEVEL` | `info` | pino level |

After deploying, verify:

```bash
curl https://your-server.onrender.com/api/health
# {"ok":true,...}
```

Note the URL. It becomes `VITE_API_URL` for the client.

---

## 3. Deploy the client to Netlify

1. Netlify → **Add new site** → **Import an existing project** → GitHub → select the repo.
2. Netlify reads `netlify.toml`:
   - build command: `npm run build`
   - publish directory: `dist/client`
   - Node 22
3. Add environment variables (Site configuration → Environment variables):
   ```
   VITE_API_URL = https://your-server.onrender.com
   ```
   Optional, if your WebSocket URL is not `<api>/ws`:
   ```
   VITE_WS_URL = wss://your-server.onrender.com/ws
   ```
4. Deploy.

`VITE_*` values are baked into the build. If you change them, trigger a new deploy.

Then add the Netlify URL to the server's `CORS_ORIGIN` and redeploy the server.

---

## 4. Deploy the client to Vercel

1. Vercel → **Add New** → **Project** → import the GitHub repo.
2. Vercel reads `vercel.json`:
   - install: `npm install`
   - build: `npm run build`
   - output: `dist/client`
   - framework: none
3. Add the same environment variables:
   ```
   VITE_API_URL = https://your-server.onrender.com
   ```
4. Deploy.

Again, add the Vercel URL to `CORS_ORIGIN` on the server.

### Which should I use?

Either. Netlify's `netlify.toml` and Vercel's `vercel.json` are both included; deploy to one, or both for a staging/production pair. Keep the server URL in sync in both projects.

---

## 5. How the client finds the API

`NetClient` resolves its base URL in this order:

1. constructor argument (unused in the game),
2. `VITE_API_URL`,
3. `http://127.0.0.1:8080` when the page is on port 5173 or 4173,
4. same origin otherwise.

The WebSocket URL is `VITE_WS_URL`, or the API URL with `http → ws` / `https → wss`, plus `/ws`.

So with `VITE_API_URL=https://gold-ring.onrender.com`, the client calls:

```
https://gold-ring.onrender.com/api/...
wss://gold-ring.onrender.com/ws
```

No proxy is needed in production. In local development, `npm run dev` proxies `/api` and `/ws` to `127.0.0.1:8080`; the fallback in step 3 also works if the proxy is unavailable.

---

## 6. Custom domains

- Netlify/Vercel: add the domain in the project settings, then update `CORS_ORIGIN` on the server to the final origin (for example `https://goldring.example.com`).
- If you use both `www` and the apex domain, list both origins.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page, 404 on `/assets/...` | publish directory wrong | Netlify: `dist/client`; Vercel: output `dist/client` |
| `WebGL 2 is unavailable` | browser/hardware | enable hardware acceleration; try Chrome/Edge |
| Leaderboard says server offline | `VITE_API_URL` missing or wrong | set it and redeploy the client |
| `blocked by CORS` | server `CORS_ORIGIN` missing the client origin | add the exact origin (scheme + host), redeploy server |
| WebSocket fails, REST works | mixed content or wrong URL | use `https` API → `wss`; check `VITE_WS_URL` |
| Online queue never matches | only one player, or different divisions | open two windows and pick the same division |
| Data disappears after restart | no persistent disk | mount `/app/data` or use a managed database |
| Build fails on Netlify/Vercel | Node version | `.nvmrc` is 22; set `NODE_VERSION=22` |

---

## 8. CI

`.github/workflows/ci.yml` runs on pushes and pull requests:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

It uploads the built client as an artifact. Netlify/Vercel can deploy independently of CI; the workflow is there to catch a broken commit before it reaches production.

---

## 9. What still needs a real service

- **Persistence**: the server writes a JSON file. For multiple instances or serious traffic, move to PostgreSQL using `server/src/db/schema.sql`.
- **Auth**: the demo `/api/auth` returns an unsigned token. Add real sessions/JWT before exposing leaderboards to the public.
- **Scaling WebSockets**: rooms live in process memory. A multi-instance deployment needs a shared room store (Redis) or sticky sessions.
- **Object storage**: none is required; all assets are procedural.
