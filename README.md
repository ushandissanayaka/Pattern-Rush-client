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

Pushes deploy automatically (`.github/workflows/deploy.yml`): `dev` → dev channel (`verity-quiz.dev.play.bloxity.io`), `main` → prod channel (`verity-quiz.play.bloxity.io`). The workflow needs the repository secret `LEGION_DEPLOY_TOKEN` (the hosting dashboard's deploy token) and the repository variable `LEGION_GAME_ID` = `verity-quiz`.

To deploy by hand instead, build a ZIP for the channel you are uploading to:

```powershell
npm run zip:dev    # release/pattern-rush-client-dev.zip  -> verity-quiz.dev.play.bloxity.io (dev backend)
npm run zip:prod   # release/pattern-rush-client-prod.zip -> verity-quiz.play.bloxity.io (prod backend)
```

Upload the ZIP on the hosting dashboard (verity-quiz) → Frontend, on the matching Dev or Prod channel. The ZIP has `index.html` at its root.

The game slug and hosting id are `verity-quiz` (`src/bloxity/legion-sdk.js`). The client sends `Legion.SDK.auth.getToken()` with `identify` so the server can verify the account, plays Boxity emotes (`src/bloxity/legion-emotes.js`) and relays them, and shows Boxity chat messages as bubbles above each player.

### Boxity integration (`src/bloxity/legion-sdk.js`)

All SDK calls go through `src/bloxity/legion-sdk.js`, which keeps the single `auth.onUserChanged` subscription.

- **Profile (top-right, `src/ui/profile.js`)**: picture, name and Gems balance. Players who are not signed in get Boxity's generated guest name and picture (or a suggested name such as `SwiftFox42` if the SDK did not load), plus a **Log in** button. The menu also has the avatar customizer, an invite link, online friends with Invite buttons, and Log out.
- **Settings**: `master_volume`, `music_volume`, `graphics_quality`, `show_fps`, `camera_sensitivity`, `enable_chat` and `fullscreen` show up in the portal menu.
- **Rooms**: the connected lobby is reported with `game.updateRoom(roomId)`. A `?roomId=` launch (Open Rooms or a friend invite) joins that room through `play.bloxity.io/v1/dir/verity-quiz/list`, or matchmakes normally if the room is gone or full. ESC in the lobby opens the Boxity pause menu when embedded.
- **Gems**: the shop passes only skus to `gems.requestPurchase`. The gem numbers on the cards are labels. Register these skus with their real prices in the Boxity catalog for `verity-quiz`:
  `daily_claim_all`, `fall_pack_x1|x3|x10|x50`, `limited_pack_x1|x3|x10|x50`, `starter_pack`, `server_luck_2x`, `pass_2x_cash`, `pass_2x_wins`, `cash_1k`, `cash_3k`, `cash_10k`, `cash_50k`, `cash_150k`, and in matches `troll_reset_shuffle`, `troll_skip_turn`, `reveal_next_answer`.
  Every Buy opens the purchase popup (`src/ui/buy-popup.js`): Gem balance, the catalog price, and the smallest Boxity Gem pack when the player is short.
  Each purchase fires `cc:purchase` `{ sku, transactionId }` once, from either the purchase result or the server's `gems-grant`.

## Client layout

- `public/assets/` contains the static HUD SVGs.
- `src/main.jsx` and `src/App.jsx` are the Vite entry points for the existing lobby.
- `src/scene/`, `src/controls/`, `src/ui/`, `src/config/`, and `src/bloxity/` contain the lobby modules.
- `src/objects/`, `src/net/`, and the other feature folders are ready for the next game systems.

The lobby uses Three.js and its existing HTML interface; the `.jsx` files provide the Vite entry and do not add React as a runtime dependency. Connected players appear as live avatars; joining opposite sides of the same booth starts a server-validated 1v1 pattern match.
