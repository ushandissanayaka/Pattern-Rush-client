// Bridge to the Boxity / Legion SDK (https://docs.bloxity.io/#html5). Every SDK call in the game
// goes through this module. If the SDK script failed to load, everything falls back to the default
// Legion character (skins/0.png) and a locally suggested guest name — never throws.
import { LEGION_CDN } from './legion-avatar.js';

export const GAME_SLUG = 'verity-quiz';     // the game's slug on bloxity.io
export const HOSTING_ID = 'verity-quiz';    // the backend's id on hosting.bloxity.io (play.bloxity.io matchmaker)
export const DEFAULT_PFP = 'https://static.bloxity.io/img/pfps/0.png?width=128&quality=85';
let started = false;
const userListeners = new Set();

export function sdk() { return (window.Legion && window.Legion.SDK) || null; }
function safe(fn, fallback) { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } }
async function safeAsync(fn, fallback) { try { const v = await fn(); return v === undefined ? fallback : v; } catch { return fallback; } }

export function startLegion() {
  const S = sdk();
  if (!S || started) return !!S;
  started = true;
  try { S.init({ gameSlug: GAME_SLUG }); } catch (e) { console.warn('[legion] init failed', e); }
  // registered on boot so Boxity shows its emote button (it draws the picker itself)
  safe(() => S.game.registerFeature('emotes'));
  // the one auth subscription: fires now, then on every login / logout / avatar change
  const notify = () => { const p = getLocalPlayer(); for (const cb of userListeners) safe(() => cb(p)); };
  safe(() => S.auth.onUserChanged(notify));
  safe(() => S.avatar.onAvatarChanged(notify));
  safe(() => S.avatar.onProportionsChanged(notify));
  return true;
}

/* ---------------- auth / profile ---------------- */

/** Boxity JWT for the server to verify (null for guests). */
export function getToken() {
  const S = sdk();
  return S ? safe(() => S.auth.getToken(), null) : null;
}

// Without the SDK there is no Boxity guest identity, so suggest one (kept across visits).
const ADJECTIVES = ['Swift', 'Lucky', 'Clever', 'Brave', 'Sneaky', 'Cosmic', 'Turbo', 'Mighty', 'Happy', 'Pixel'];
const NOUNS = ['Fox', 'Panda', 'Otter', 'Tiger', 'Falcon', 'Koala', 'Wolf', 'Gecko', 'Comet', 'Ninja'];
function suggestedGuestName() {
  try { const saved = localStorage.getItem('cc:guest-name'); if (saved) return saved; } catch { /* storage blocked */ }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const name = `${pick(ADJECTIVES)}${pick(NOUNS)}${Math.floor(10 + Math.random() * 90)}`;
  try { localStorage.setItem('cc:guest-name', name); } catch { /* not persisted */ }
  return name;
}

/** Snapshot of the local player: { name, username, userId, pfp, isGuest, equipped, skinUrl, proportions } */
export function getLocalPlayer() {
  const S = sdk();
  const guestName = S ? null : suggestedGuestName();
  const fallback = { name: guestName || 'Player', username: guestName || 'Player', userId: null, pfp: DEFAULT_PFP, isGuest: true, equipped: {}, skinUrl: `${LEGION_CDN}/skins/0.png`, proportions: {} };
  if (!S) return fallback;
  const user = safe(() => S.auth.getUser(), null);
  // not signed in: Boxity's generated guest identity (name + PFP), else our own suggestion
  const u = user || safe(() => S.auth.getGuest(), null) || { username: suggestedGuestName() };
  return {
    name: String(u.displayName || u.username || 'Player'),
    username: String(u.username || ''),
    userId: (user && user._id) || null,
    pfp: u.pfp || DEFAULT_PFP,
    isGuest: !user,
    equipped: safe(() => S.avatar.getEquipped(), {}) || {},
    skinUrl: safe(() => S.avatar.getSkinTextureUrl(), null) || fallback.skinUrl,
    proportions: safe(() => S.avatar.getProportions(), {}) || {}
  };
}

/** Calls cb(getLocalPlayer()) now and whenever the user or their avatar changes. Returns unsubscribe. */
export function onLocalPlayerChanged(cb) {
  userListeners.add(cb);
  cb(getLocalPlayer());
  return () => userListeners.delete(cb);
}

export const canLogIn = () => !!sdk();
export function logIn() { return safeAsync(() => sdk()?.auth.showAuthPopup(), null); }
export function logOut() { safe(() => sdk()?.auth.logout()); }
export function openAvatarCustomizer() { safe(() => sdk()?.avatar.showCustomizer()); }

/* ---------------- social ---------------- */

export function getFriends() {
  const S = sdk();
  if (!S || !safe(() => S.auth.isLoggedIn(), false)) return Promise.resolve([]);
  return safeAsync(() => S.social.getFriends(), []).then((list) => list || []);
}
export function getInviteLink() { return safe(() => sdk()?.social.getInviteFriendsLink(), null) || location.href; }
export function inviteFriend(userId) { return safeAsync(() => sdk()?.social.inviteFriend(userId), false); }

/* ---------------- Gems (server-authoritative; prices come from the Boxity catalog by sku) ---------------- */

export function getGemBalance() {
  const S = sdk();
  if (!S || !safe(() => S.auth.isLoggedIn(), false)) return Promise.resolve(null);
  return safeAsync(() => (S.gems || S.bux).getBalance(), null);
}
/** The item as the Boxity catalog sells it ({ name, price } in Gems), or null if the sku is not listed. */
const catalog = new Map();
export function getCatalogItem(sku) {
  if (!catalog.has(sku)) {
    catalog.set(sku, fetch(`https://api.bloxity.io/v1/games/${encodeURIComponent(GAME_SLUG)}/iaps/${encodeURIComponent(sku)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((item) => (item && typeof item.price === 'number' && item.price > 0 ? { name: item.name, price: item.price } : null))
      .catch(() => null));
  }
  return catalog.get(sku);
}
/** Gem top-up packs: [{ id, amount, baseAmount, bonus, price (USD) }], smallest first. */
export function getTopUpPackages() {
  const S = sdk();
  return S ? safeAsync(() => (S.gems || S.bux).getTopUpPackages(), []).then((p) => p || []) : Promise.resolve([]);
}
/** Opens Boxity's payment window for at least `gems` Gems. Resolves { success, error? }. */
export async function requestTopUp(gems) {
  const S = sdk();
  if (!S) return { success: false, error: 'Boxity is unavailable' };
  const result = await safeAsync(() => (S.gems || S.bux).requestTopUp(gems), null);
  window.dispatchEvent(new CustomEvent('cc:gems-balance'));
  return result || { success: false, error: 'Top-up failed' };
}
export const isLoggedIn = () => safe(() => sdk()?.auth.isLoggedIn(), false);

/** Opens Boxity's purchase flow for one sku. Resolves { success, transactionId?, error? }. */
export async function purchaseWithGems(sku, metadata) {
  const S = sdk();
  if (!S) return { success: false, error: 'Boxity is unavailable' };
  const result = await safeAsync(() => (S.gems || S.bux).requestPurchase(sku, metadata), null);
  if (!result) return { success: false, error: 'Purchase failed' };
  if (result.success) window.dispatchEvent(new CustomEvent('cc:gems-balance'));
  return result;
}

/* ---------------- settings (values are strings; listening adds the control to the portal menu) ---------------- */

export function listenSetting(key, cb) {
  const S = sdk();
  if (!S) return () => {};
  return safe(() => S.settings.listen(key, (value) => safe(() => cb(String(value ?? '')))), () => {});
}
export function applyAllSettings() { safe(() => sdk()?.settings.triggerAll()); }
export function setFullscreen(on) {
  const portal = sdk()?.portal;
  safe(() => (on ? portal.requestFullscreen() : portal.exitFullscreen()));
}

/* ---------------- lifecycle, rooms, portal ---------------- */

export function legionLoadingStep(text) { safe(() => sdk()?.game.loadingStep(text)); }
export function legionLoadingEnd() { safe(() => sdk()?.game.loadingEnd()); }
export function gameplayStart() { safe(() => sdk()?.game.gameplayStart()); }
export function gameplayEnd() { safe(() => sdk()?.game.gameplayEnd()); }
/** The room friends can join (invites + "Open Rooms"); '' while not in a joinable room. */
export function reportRoom(roomId) { safe(() => sdk()?.game.updateRoom(roomId || '')); }
export function reportPlayerJoined(name) { if (name) safe(() => sdk()?.game.playerJoined(name)); }
export function reportPlayerInRoom(name) { if (name) safe(() => sdk()?.game.playerInRoom(name)); }
export const isEmbedded = () => safe(() => sdk()?.portal.isEmbeddedInLegion(), false);
export function showPortalMenu() { safe(() => sdk()?.portal.showMenu(true)); }
