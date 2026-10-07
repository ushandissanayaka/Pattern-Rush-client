# Cipher Clash client

## Run locally

Install the frontend packages once:

```powershell
npm install
```

Start the frontend:

```powershell
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). The Vite `/api` proxy forwards WebSocket connections to the backend on port 3000.

For a separately hosted production client, set `VITE_REALTIME_URL` to the server WebSocket endpoint, for example `wss://cipher-clash-server.onrender.com/api/realtime`.

## Deploy to Bloxity

The server URLs live in `.env.dev` (dev channel) and `.env.production` (prod channel). Build a ZIP for the channel you are uploading to:

```powershell
npm run zip:dev    # release/pattern-rush-client-dev.zip  -> wss://prince-creations.dev.host.bloxity.io
npm run zip:prod   # release/pattern-rush-client-prod.zip -> wss://prince-creations.host.bloxity.io
```

Upload the ZIP under My Games → the game → Frontend, on the matching Dev or Prod channel. The ZIP has `index.html` at its root.

## Client layout

- `public/assets/` contains the static HUD SVGs.
- `src/main.jsx` and `src/App.jsx` are the Vite entry points for the existing lobby.
- `src/scene/`, `src/controls/`, `src/ui/`, `src/config/`, and `src/bloxity/` contain the lobby modules.
- `src/objects/`, `src/net/`, and the other feature folders are ready for the next game systems.

The lobby uses Three.js and its existing HTML interface; the `.jsx` files provide the Vite entry and do not add React as a runtime dependency. Connected players appear as live avatars; joining opposite sides of the same booth starts a server-validated 1v1 pattern match.
