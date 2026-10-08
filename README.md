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

On Boxity the client never opens its socket to `verity-quiz.host.bloxity.io`. Every connect calls `Legion.SDK.net.resolveEndpoint('verity-quiz')` and opens `<endpoint>/api/realtime`, a relay at `play.bloxity.io` pinned to one server pod. A failed resolve or a closed socket resolves again with a backoff. Local runs (`localhost`) skip the matchmaker and use the Vite proxy. `VITE_REALTIME_URL` still overrides the socket URL for a server hosted elsewhere (see `netlify.toml`).

## Deploy to Bloxity

Build a ZIP for the channel you are uploading to:

```powershell
npm run zip:dev    # release/pattern-rush-client-dev.zip  -> verity-quiz.dev.play.bloxity.io (dev backend)
npm run zip:prod   # release/pattern-rush-client-prod.zip -> verity-quiz.play.bloxity.io (prod backend)
```

Upload the ZIP under My Games → verity-quiz → Frontend, on the matching Dev or Prod channel. The ZIP has `index.html` at its root.

The game slug and hosting id are `verity-quiz` (`src/bloxity/legion-sdk.js`). The client sends `Legion.SDK.auth.getToken()` with `identify` so the server can verify the account, plays Boxity emotes (`src/bloxity/legion-emotes.js`) and relays them, and shows Boxity chat messages as bubbles above each player.

## Client layout

- `public/assets/` contains the static HUD SVGs.
- `src/main.jsx` and `src/App.jsx` are the Vite entry points for the existing lobby.
- `src/scene/`, `src/controls/`, `src/ui/`, `src/config/`, and `src/bloxity/` contain the lobby modules.
- `src/objects/`, `src/net/`, and the other feature folders are ready for the next game systems.

The lobby uses Three.js and its existing HTML interface; the `.jsx` files provide the Vite entry and do not add React as a runtime dependency. Connected players appear as live avatars; joining opposite sides of the same booth starts a server-validated 1v1 pattern match.
