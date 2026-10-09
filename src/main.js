// Cipher Clash client entry. Renders the lobby, player presence, and booth matches.
import * as THREE from 'three';
import { buildWorld, tickWorld, BILLBOARDS, WORLD, CONVEYORS, CONVEYOR_SPEED, DANCE_SPOTS } from './scene/world.js';
import { createDancers } from './scene/dancers.js';
import { createSky } from './scene/sky.js';
import { moveCharacter, cameraClearance } from './scene/physics.js';
import { CameraRig, CAMERA_LIMITS } from './controls/camera.js';
import { initHud } from './ui/hud.js';
import { initProfile } from './ui/profile.js';
import { LegionCharacter } from './bloxity/legion-avatar.js';
import {
  startLegion, onLocalPlayerChanged, getLocalPlayer, getToken, sdk,
  listenSetting, applyAllSettings, setFullscreen, gameplayStart, reportRoom
} from './bloxity/legion-sdk.js';
import { loadEmotes, getEmoteClip } from './bloxity/legion-emotes.js';
import { createMatchSystem } from './game/match.js';
import { createMultiplayer, createRemotePlayers } from './network/multiplayer.js';
import { loadingStatus, finishLoading } from './ui/loading.js';
import { initAudio, sfx, setVolumes } from './audio/sound.js';
import { SCENE_BRIGHTNESS } from './config/palette.js';

const canvas = document.getElementById('world-canvas');
// phones / tablets and machines with ≤ 4 cores get a lower resolution cap and a smaller shadow map
const LOW = (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820) || (navigator.hardwareConcurrency || 8) <= 4;
// No post-processing (no bloom glow): the scene is drawn straight to the antialiased canvas.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Adaptive resolution: start at up to 1.5× (2× is rarely visible but costs ~78 % more
// pixels) and step down / up to hold ~60 fps (see the frame loop below).
const FIXED_PR = parseFloat(new URLSearchParams(location.search).get('pr'));   // ?pr=1 pins resolution (screenshots)
// Never drop below 1× on desktop (that is what made the scene look soft / blurry).
// Phones: up to 1.5× and never under 1× — below that the pixel-art skins turn into a smear on
// 2–3× screens.
const MAX_PR = FIXED_PR || Math.min(devicePixelRatio, LOW ? 1.5 : 2), MIN_PR = FIXED_PR || Math.min(1, MAX_PR);
let pixelRatio = MAX_PR, qualityCap = MAX_PR;   // qualityCap: Boxity setting graphics_quality
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // Roblox look: saturated, untonemapped
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // filtered (radius) but much cheaper than PCFSoft

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA_LIMITS.fov, 1, 0.3, 3000);

// Lighting: bright midday sun from the front-left, soft shadows (Roblox ShadowMap look)
// Afternoon sun (lower than noon → longer, clearer shadows, as in the screenshots)
const SUN_DIR = new THREE.Vector3(0.6, 0.66, 0.42).normalize();
// Calibrated so an upward face renders at its palette colour (like Roblox):
// (hemi + sun·cosθ) / π ≈ 1. Shadowed ground keeps only the hemisphere fill (≈ 58 % in sRGB).
// SCENE_BRIGHTNESS (< 1) darkens everything evenly.
const HEMI = 1.0 * SCENE_BRIGHTNESS, UP_LIGHT = 3.06 * SCENE_BRIGHTNESS;
scene.add(new THREE.HemisphereLight('#ffffff', '#c9d2cc', HEMI));
const sun = new THREE.DirectionalLight('#fffaf0', (UP_LIGHT - HEMI) / SUN_DIR.y);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 700 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 1.4;   // soft Roblox-like edges
scene.add(sun, sun.target);
const sky = createSky(scene, SUN_DIR);

startLegion();
initAudio();   // sounds + music render in the background while the world loads
await document.fonts.ready; // billboards are drawn to canvas with web fonts
await Promise.all(["400 40px 'Luckiest Guy'", "700 40px 'Fredoka'", "600 40px 'Fredoka'", "900 40px 'Montserrat'", "800 40px 'Montserrat'"].map(f => document.fonts.load(f).catch(() => {})));
loadingStatus('Building world');
await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));   // let the new status paint first
buildWorld(scene);
const dancers = createDancers(scene, DANCE_SPOTS);

// --- your Legion character (skin + equipped parts from Legion.SDK) ---
const me = new LegionCharacter({});
me.root.userData.class = 'avatar-3d avatar-3d--me legion-character';
scene.add(me.root);
const remotePlayers = createRemotePlayers(scene);
const multiplayer = createMultiplayer(remotePlayers.handleMessage);
let localIdentity = getLocalPlayer();
// The token lets the server verify the Boxity account (guests send none).
window.addEventListener('cc:identify-request', () => {
  multiplayer.send('identify', { player: localIdentity, token: getToken() });
});
// No name tag on your own avatar (matches the video: only other players show one).
onLocalPlayerChanged((p) => {
  localIdentity = p;
  me.setSkin(p.skinUrl);
  me.applyEquipped(p.equipped);
  if (p.proportions && p.proportions.height) me.root.scale.set(1, p.proportions.height, 1);
  multiplayer.send('identify', { player: p, token: getToken() });
  window.dispatchEvent(new CustomEvent('cc:player', { detail: p }));
});

// Boxity draws the emote picker and the chat box over the game; we only play / show the results.
loadEmotes();
function stopLocalEmote() {
  if (!me.emote) return;
  me.stopEmote();
  multiplayer.send('emote', { emoteId: null });
}
sdk()?.player?.onEvent?.((event, data) => {
  if (event === 'play_emote') {
    getEmoteClip(data).then((clip) => {
      if (!clip) return;
      me.playEmote(clip);
      multiplayer.send('emote', { emoteId: data });
    }).catch(() => {});
  } else if (event === 'respawn_request') {
    state.checkpoint.copy(WORLD.spawn);
    respawn();
  }
});
let chatBubbles = true;   // Boxity setting enable_chat
sdk()?.chat?.onMessage?.((m) => {
  const chat = sdk().chat;
  if (!chatBubbles) return;
  // the local avatar has no name tag; other players' bubbles sit just above theirs
  const character = m.isLocalPlayer ? me : remotePlayers.getCharacterByUserId(String(m.userId || '').replace(/^legion_/, ''));
  if (!character) return;
  chat.attachBubble(THREE, character.root, chat.bubbleText(m), { height: m.isLocalPlayer ? 7 : 8.9, scale: 1.7, seconds: chat.bubbleSeconds });
});
// Gems purchases fulfilled by the server's webhook (see Pattern-Rush-Server README)
addEventListener('cc:multiplayer-message', (e) => {
  if (e.detail.type === 'gems-grant') window.dispatchEvent(new CustomEvent('cc:gems-grant', { detail: e.detail.grant }));
});

const rig = new CameraRig(camera, canvas);
// Spawn on the spawn pad facing the castle. The camera is fully player-controlled.
const state = { heading: Math.PI, grounded: true, checkpoint: WORLD.spawn.clone(), inObby: false };
const feet = WORLD.spawn.clone();
const prevFeet = new THREE.Vector3().copy(feet);
const vel = new THREE.Vector3();
rig.clearance = (focus, camPos, dist) => cameraClearance(focus, camPos, dist);

function respawn(at = WORLD.spawn, faceCastle = true) {
  feet.copy(at); vel.set(0, 0, 0); prevFeet.copy(feet);
  if (faceCastle) { state.heading = Math.PI; me.root.rotation.y = Math.PI; }
  window.dispatchEvent(new CustomEvent('cc:respawn'));
}
// HUD "RETURN TO LOBBY" (shown while you are on the obby side)
window.addEventListener('cc:return-to-lobby', () => { state.checkpoint.copy(WORLD.spawn); respawn(); });

// --- walking (WASD / arrows / joystick, Space = jump) with simple box collisions.
// Movement stays client-simulated and is broadcast for live lobby presence.
const keys = new Set();
const WALK_SPEED = 19, JUMP_V = 50, GRAVITY = 196.2;
let stepTimer = 0;
const JUMP_BUFFER_TIME = 0.2;
const touchControls = document.getElementById('touch-controls');
const touchStick = document.getElementById('touch-stick');
const touchStickThumb = document.getElementById('touch-stick-thumb');
const touchJump = document.getElementById('touch-jump');
const touchInput = { x: 0, y: 0, jump: false, stickPointer: null, jumpPointer: null };
let jumpBuffer = 0;
if (navigator.maxTouchPoints > 0) touchControls.hidden = false;

function updateTouchStick(e) {
  const bounds = touchStick.getBoundingClientRect();
  const radius = bounds.width * 0.32;
  const dx = e.clientX - (bounds.left + bounds.width / 2);
  const dy = e.clientY - (bounds.top + bounds.height / 2);
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;
  const x = dx * scale, y = dy * scale;
  touchInput.x = x / radius;
  touchInput.y = y / radius;
  touchStickThumb.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
}

function resetTouchStick() {
  touchInput.x = 0; touchInput.y = 0; touchInput.stickPointer = null;
  touchStickThumb.style.transform = 'translate(-50%, -50%)';
}

touchStick.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  touchInput.stickPointer = e.pointerId;
  touchStick.setPointerCapture(e.pointerId);
  updateTouchStick(e);
});
touchStick.addEventListener('pointermove', (e) => {
  if (e.pointerId === touchInput.stickPointer) updateTouchStick(e);
});
touchStick.addEventListener('pointerup', (e) => {
  if (e.pointerId === touchInput.stickPointer) resetTouchStick();
});
touchStick.addEventListener('pointercancel', resetTouchStick);

touchJump.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  touchInput.jumpPointer = e.pointerId;
  touchInput.jump = true;
  jumpBuffer = JUMP_BUFFER_TIME;
  touchJump.setPointerCapture(e.pointerId);
});
function releaseTouchJump(e) {
  if (e.pointerId !== touchInput.jumpPointer) return;
  touchInput.jumpPointer = null;
  touchInput.jump = false;
}
touchJump.addEventListener('pointerup', releaseTouchJump);
touchJump.addEventListener('pointercancel', releaseTouchJump);

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
    keys.add(k); e.preventDefault();
    if (k === ' ') jumpBuffer = JUMP_BUFFER_TIME;
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => {
  keys.clear(); resetTouchStick(); touchInput.jump = false; touchInput.jumpPointer = null; jumpBuffer = 0;
});

function walk(dt) {
  const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - touchInput.y;
  const r = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + touchInput.x;
  const inputLength = Math.hypot(f, r);
  vel.x = 0; vel.z = 0; state.inputSpeed = 0;
  if (inputLength > 0.12 && rig.enabled) {
    const yaw = THREE.MathUtils.degToRad(rig.yaw);
    // camera looks along -(sin yaw, cos yaw); right = (cos yaw, -sin yaw)
    const dx = -Math.sin(yaw) * f + Math.cos(yaw) * r, dz = -Math.cos(yaw) * f - Math.sin(yaw) * r;
    const sp = Math.min(inputLength, 1) * WALK_SPEED / inputLength;
    vel.x = dx * sp; vel.z = dz * sp;
    state.heading = Math.atan2(dx, dz);
    state.inputSpeed = Math.min(inputLength, 1) * WALK_SPEED;
  }
  // conveyor road: standing on a chevron strip carries you in the arrow direction
  state.onConveyor = false;
  if (feet.y < 1.2) {
    for (const c of CONVEYORS) {
      if (feet.x >= c.minX && feet.x <= c.maxX && feet.z >= c.minZ && feet.z <= c.maxZ) {
        vel.x += c.dx * CONVEYOR_SPEED; vel.z += c.dz * CONVEYOR_SPEED; state.onConveyor = true;
        // gentle pull toward the middle of the belt so you ride round the corners
        if (!inputLength || inputLength <= 0.12) { if (c.dx) vel.z += (c.cz - feet.z) * 2.5; else vel.x += (c.cx - feet.x) * 2.5; }
        break;
      }
    }
  }
  const jumpHeld = keys.has(' ') || touchInput.jump;
  jumpBuffer = Math.max(0, jumpBuffer - dt);
  if (rig.enabled && state.grounded && (jumpBuffer > 0 || jumpHeld)) {
    vel.y = JUMP_V;
    jumpBuffer = 0;
  }
  vel.y = Math.max(vel.y - GRAVITY * dt, -160);
  const res = moveCharacter(feet, vel, dt);
  state.grounded = res.grounded;
  if (res.checkpoint) state.checkpoint.copy(res.checkpoint);
  if (res.killed) respawn(state.checkpoint, false);             // obby laser
  else if (feet.y < WORLD.killY) respawn(state.checkpoint.z < WORLD.roadEndZ ? state.checkpoint : WORLD.spawn, false); // fell off
  const inObby = feet.z < WORLD.roadEndZ;
  if (inObby !== state.inObby) { state.inObby = inObby; window.dispatchEvent(new CustomEvent('cc:zone', { detail: inObby ? 'obby' : 'lobby' })); }
}

// Camera is paused while a modal / match screen is open (no stray orbiting behind panels).

initHud();
initProfile();
if (import.meta.env.DEV) window.__cc = { rig, feet, vel, state, respawn, renderer, scene, sun, me, get pixelRatio() { return pixelRatio; } }; // dev-only debug handle (tests)

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas); resize();

const match = createMatchSystem({
  scene, camera, me, feet, state,
  getName: () => getLocalPlayer().name,
  multiplayer,
  getRemoteCharacter: remotePlayers.getCharacter
});
remotePlayers.setControlFilter(match.controlsRemote);
if (import.meta.env.DEV) window.__match = match;
const clock = new THREE.Clock();
const wp = new THREE.Vector3(), shadowFocus = new THREE.Vector3();
const perf = { t: 0, n: 0, last: 0, slow: 0, fast: 0, tooSlow: Infinity, on: false };
// lite rendering: a 1024 shadow map (nearly the same look, a fraction of the GPU cost)
function useLiteRendering() {
  if (sun.shadow.mapSize.x > 1024) { sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(1024, 1024); }
}
let networkElapsed = 0, networkIdle = 0, lastMoveKey = '';
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  prevFeet.copy(feet);
  match.update(dt);
  rig.enabled = !match.cameraActive() && document.body.dataset.screen === 'lobby';
  if (!match.locksPlayer()) walk(dt);
  else { vel.set(0, 0, 0); state.grounded = true; state.inputSpeed = 0; }
  if (state.inputSpeed > 0.5 || !state.grounded || match.ownsAvatar()) stopLocalEmote();

  // smooth turning toward the movement heading (Roblox AutoRotate)
  if (!match.ownsAvatar()) {
    const cur = me.root.rotation.y, d = Math.atan2(Math.sin(state.heading - cur), Math.cos(state.heading - cur));
    me.root.rotation.y = cur + d * (1 - Math.exp(-dt * 14));
    me.root.position.copy(feet);
    // walk animation follows your own input, not the conveyor (standing still on a belt = idle)
    me.setState(state.grounded ? 'idle' : 'airborne');
    me.update(dt, state.grounded ? state.inputSpeed : 0);
  }
  // footsteps: one per stride, following your own walking speed (on the lobby floor or a booth deck)
  const stepSpeed = match.ownsAvatar() ? match.avatarSpeed() : state.grounded ? state.inputSpeed : 0;
  if (stepSpeed > 0.5) {
    stepTimer -= dt;
    if (stepTimer <= 0) { stepTimer = 0.34 * Math.min(1.8, WALK_SPEED / stepSpeed); sfx('step', { rate: 0.9 + Math.random() * 0.2, volume: 0.55 }); }
  } else stepTimer = 0.08;
  tickWorld(dt, camera);
  remotePlayers.update(dt);
  // 10 updates/s while moving; standing still only refreshes once a second, so a lobby full of
  // idle players does not flood every client with identical position messages
  networkElapsed += dt; networkIdle += dt;
  if (networkElapsed >= 0.1) {
    networkElapsed = 0;
    const p = me.root.position, moveState = !state.grounded ? 'airborne' : state.inputSpeed > 0.5 || match.avatarSpeed() > 0.5 ? 'walk' : 'idle';
    const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)},${me.root.rotation.y.toFixed(2)},${moveState}`;
    if (key !== lastMoveKey || networkIdle >= 1) {
      lastMoveKey = key; networkIdle = 0;
      multiplayer.send('move', { position: { x: p.x, y: p.y, z: p.z }, heading: me.root.rotation.y, state: moveState });
    }
  }

  if (match.cameraActive()) { match.updateCamera(dt); me.root.visible = true; }
  else {
    // the booth camera widens the FOV on narrow screens; the lobby camera always uses the standard one
    if (camera.fov !== CAMERA_LIMITS.fov) { camera.fov = CAMERA_LIMITS.fov; camera.updateProjectionMatrix(); }
    const firstPerson = rig.update(dt, feet); me.root.visible = !firstPerson;
  }
  // shadow frustum follows the player, snapped to whole shadow texels so edges don't shimmer
  const span = rig.dist > 110 ? 200 : rig.dist > 50 ? 130 : 90;
  if (sun.shadow.camera.right !== span) {
    sun.shadow.camera.left = sun.shadow.camera.bottom = -span;
    sun.shadow.camera.right = sun.shadow.camera.top = span;
    sun.shadow.camera.updateProjectionMatrix();
  }
  const texel = (2 * span) / sun.shadow.mapSize.x;
  shadowFocus.set(Math.round(feet.x / texel) * texel, 0, Math.round(feet.z / texel) * texel);
  sun.position.copy(shadowFocus).addScaledVector(SUN_DIR, 300); sun.target.position.copy(shadowFocus);
  sky.update(dt, camera);
  // billboards fade out inside ~16–36 studs of the camera so they never fill the screen
  for (const b of BILLBOARDS) {
    b.getWorldPosition(wp);
    b.material.opacity = THREE.MathUtils.smoothstep(wp.distanceTo(camera.position), 16, 36);
  }
  dancers.update(dt, camera);
  renderer.render(scene, camera);

  // adaptive quality: average frame time over ~1 s. After two slow seconds in a row, first switch
  // to lite rendering once (smaller shadow map); only if it is still slow, step the pixel ratio down by 0.15.
  // Steady ~60 fps for 4 s steps it back up (60 Hz phones never get under 13 ms), but never to a
  // level that was already too slow. Loading frames (shader compiles, avatar downloads) don't count.
  perf.t += clock.elapsedTime - perf.last; perf.last = clock.elapsedTime; perf.n++;
  if (perf.t >= 1) {
    const ms = (perf.t / perf.n) * 1000; perf.t = 0; perf.n = 0;
    if (!fpsLabel.hidden) fpsLabel.textContent = `${Math.round(1000 / ms)} FPS`;
    perf.slow = perf.on && ms > 22 ? perf.slow + 1 : 0;
    perf.fast = perf.on && ms < 18 ? perf.fast + 1 : 0;
    let next = pixelRatio;
    if (perf.slow >= 2 && sun.shadow.mapSize.x > 1024) { useLiteRendering(); perf.slow = 0; }
    else if (perf.slow >= 2 && pixelRatio > MIN_PR) { perf.tooSlow = Math.min(perf.tooSlow, pixelRatio); next = Math.max(MIN_PR, pixelRatio - 0.15); perf.slow = 0; }
    else if (perf.fast >= 4 && pixelRatio < qualityCap && pixelRatio + 0.15 < perf.tooSlow) { next = Math.min(qualityCap, pixelRatio + 0.15); perf.fast = 0; }
    if (next > qualityCap) next = qualityCap;
    if (next !== pixelRatio) { pixelRatio = next; renderer.setPixelRatio(pixelRatio); resize(); }
  }
});
document.body.dataset.ready = '1';

// --- Boxity portal settings (string values; listening adds each control to the portal menu) ---
const fpsLabel = document.getElementById('hud-fps');
const settingNumber = (value, fallback) => { const n = parseFloat(value); return Number.isFinite(n) ? n : fallback; };
listenSetting('master_volume', (v) => setVolumes({ master: settingNumber(v, 80) / 100 }));
listenSetting('music_volume', (v) => setVolumes({ music: settingNumber(v, 80) / 100 }));
listenSetting('graphics_quality', (v) => {
  if (v === 'Low' || v === 'Medium') useLiteRendering();
  qualityCap = v === 'Low' ? Math.min(MAX_PR, 1) : v === 'Medium' ? Math.min(MAX_PR, 1.25) : MAX_PR;
  if (pixelRatio > qualityCap) { pixelRatio = Math.max(MIN_PR, qualityCap); renderer.setPixelRatio(pixelRatio); resize(); }
});
listenSetting('show_fps', (v) => { fpsLabel.hidden = v !== 'true'; });
listenSetting('camera_sensitivity', (v) => { rig.sensitivity = Math.min(5, Math.max(0.1, settingNumber(v, 1))); });
listenSetting('enable_chat', (v) => { chatBubbles = v !== 'false'; });
listenSetting('fullscreen', (v) => setFullscreen(v === 'true'));
applyAllSettings();

// The lobby you are connected to is joinable: Boxity invites / "Open Rooms" send friends into it.
addEventListener('cc:network', (e) => reportRoom(e.detail.connected ? e.detail.roomId : ''));

// Loading screen: wait for your avatar (with a time limit, so a slow CDN never blocks the game) and
// for the server; while the server is unavailable (e.g. Render waking up) show the retry count.
// Then enter the game.
const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
(async () => {
  loadingStatus('Loading avatar');
  await within(me.whenReady(), 10000);
  loadingStatus('Joining server');
  if (!multiplayer.connected) {
    const onRetry = (e) => loadingStatus(`Waiting for an available server. Retrying...(${e.detail.attempt})`);
    addEventListener('cc:network-retry', onRetry);
    await new Promise((r) => {
      const onNetwork = (e) => { if (e.detail.connected) { removeEventListener('cc:network', onNetwork); r(); } };
      addEventListener('cc:network', onNetwork);
    });
    removeEventListener('cc:network-retry', onRetry);
    loadingStatus('Joining server');
  }
  await nextFrame();
  finishLoading();
  gameplayStart();
  setTimeout(() => { perf.on = true; }, 2000);   // adaptive resolution starts once the first frames have settled
})();
