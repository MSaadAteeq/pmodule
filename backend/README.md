# Parakeet Cloud API

Optional backend so the same account and usage sync across all devices. When you set the Cloud URL in the desktop app, auth and usage use this API instead of local SQLite.

## Run locally

```bash
cd backend
npm install
npm start
```

Runs at `http://localhost:3765`. Set this URL in the app (Cloud button) to use it.

## Deploy

- **Railway / Render / Fly.io**: Add this folder as a service, set `PORT` if needed. Use a persistent volume or external DB for `DB_PATH` if you want data to survive restarts.
- **VPS**: Run with `node server.js` behind nginx/caddy with HTTPS. Set `DB_PATH` to a path that is backed up.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3765 | HTTP port |
| `DB_PATH` | `./parakeet_cloud.db` | SQLite file path |

## First use

1. Deploy the backend and note the base URL (e.g. `https://parakeet.example.com`).
2. In the desktop app, click **Cloud**, enter that URL, and save.
3. Sign up or log in; that account and usage are now stored on the server and shared across any device that uses the same Cloud URL.

Default superadmin: `superadmin@parakeet.local` / `SuperAdmin123!` (change in production).
