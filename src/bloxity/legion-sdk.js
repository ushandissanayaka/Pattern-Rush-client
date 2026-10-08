// Bridge to the Boxity / Legion SDK (https://docs.bloxity.io/#html5).
// If the SDK script failed to load, everything falls back to the default
// Legion character (skins/0.png) and the name "Player" — never throws.
import { LEGION_CDN } from './legion-avatar.js';

export const GAME_SLUG = 'verity-quiz';     // the game's slug on bloxity.io
export const HOSTING_ID = 'verity-quiz';    // the backend's id on hosting.bloxity.io (play.bloxity.io matchmaker)
let started = false;

export function sdk() { return (window.Legion && window.Legion.SDK) || null; }
function safe(fn, fallback) { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } }

export function startLegion() {
  const S = sdk();
  if (!S || started) return !!S;
  started = true;
  try { S.init({ gameSlug: GAME_SLUG }); } catch (e) { console.warn('[legion] init failed', e); }
  // registered on boot so Boxity shows its emote button (it draws the picker itself)
  safe(() => S.game.registerFeature('emotes'));
  return true;
}

/** Boxity JWT for the server to verify (null for guests). */
export function getToken() {
  const S = sdk();
  return S ? safe(() => S.auth.getToken(), null) : null;
}

export function legionLoadingStep(text) { safe(() => sdk()?.game.loadingStep(text)); }
export function legionLoadingEnd() { safe(() => sdk()?.game.loadingEnd()); }

/** Snapshot of the local player: { name, pfp, isGuest, equipped, skinUrl, proportions } */
export function getLocalPlayer() {
  const S = sdk();
  const fallback = { name: 'Player', pfp: null, isGuest: true, equipped: {}, skinUrl: `${LEGION_CDN}/skins/0.png`, proportions: {} };
  if (!S) return fallback;
  const u = safe(() => S.auth.getUser(), null) || safe(() => S.auth.getGuest(), null);
  return {
    name: String((u && (u.displayName || u.username)) || 'Player'),
    pfp: (u && u.pfp) || null,
    isGuest: !u || !!u.isGuest,
    equipped: safe(() => S.avatar.getEquipped(), {}) || {},
    skinUrl: safe(() => S.avatar.getSkinTextureUrl(), null) || fallback.skinUrl,
    proportions: safe(() => S.avatar.getProportions(), {}) || {}
  };
}

/** Calls cb(getLocalPlayer()) now and whenever the user or their avatar changes. */
export function onLocalPlayerChanged(cb) {
  const S = sdk();
  cb(getLocalPlayer());
  if (!S) return;
  safe(() => S.auth.onUserChanged(() => cb(getLocalPlayer())));
  safe(() => S.avatar.onAvatarChanged(() => cb(getLocalPlayer())));
}
