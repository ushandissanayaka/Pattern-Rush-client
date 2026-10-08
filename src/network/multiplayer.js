import * as THREE from 'three';
import { LegionCharacter } from '../bloxity/legion-avatar.js';
import { sdk, HOSTING_ID, reportPlayerJoined, reportPlayerInRoom } from '../bloxity/legion-sdk.js';
import { getEmoteClip } from '../bloxity/legion-emotes.js';

// Where the game socket goes. On Boxity every connect asks the matchmaker at play.bloxity.io for
// a seat and gets a relay endpoint pinned to one pod; the socket never goes to <id>.host.bloxity.io.
// A page on verity-quiz.dev.play.bloxity.io reaches the dev backend automatically.
// Local runs (Vite proxy to localhost:3000) and a VITE_REALTIME_URL override skip the matchmaker.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.)/;
// Boxity's "Open Rooms" Join button and friend invites open the game with ?roomId=. The first connect
// tries that room (resolved to its pod through the room directory); if it is gone or full we fall
// back to normal matchmaking.
let launchRoomId = new URLSearchParams(location.search).get('roomId');
async function launchRoomEndpoint() {
  const roomId = launchRoomId;
  launchRoomId = null;                      // only the first connect
  if (!roomId) return null;
  try {
    const response = await fetch(`https://play.bloxity.io/v1/dir/${encodeURIComponent(HOSTING_ID)}/list`);
    const { rooms = [] } = await response.json();
    const room = rooms.find((r) => (r.roomId || r.id) === roomId);
    if (!room?.joinUrl || room.locked || (room.maxPlayers && room.players >= room.maxPlayers)) return null;
    return { endpoint: room.joinUrl.replace(/^http/i, 'ws').replace(/\/$/, ''), roomId };
  } catch (error) {
    console.warn('[multiplayer] could not look up the invited room; matchmaking instead.', error.message);
    return null;
  }
}
async function realtimeUrl() {
  const override = import.meta.env.VITE_REALTIME_URL;
  const net = sdk()?.net;
  if (override || LOCAL_HOST.test(location.hostname) || !net) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL(override || `${protocol}//${location.host}/api/realtime`, location.href);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    return { url, roomId: null };
  }
  const { endpoint, roomId } = (await launchRoomEndpoint()) || await net.resolveEndpoint(HOSTING_ID);
  return { url: new URL(`${endpoint}/api/realtime`), roomId: roomId || null };
}

function newClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function createMultiplayer(onMessage) {
  const clientId = newClientId();
  let socket = null;
  let closed = false;
  let retryDelay = 1000;
  let reconnectTimer = null;
  let retries = 0;                          // reconnect attempts since the last successful connection

  let attempted = false;

  function retryLater() {
    if (closed) return;
    reconnectTimer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  }

  async function connect() {
    if (closed) return;
    if (attempted) window.dispatchEvent(new CustomEvent('cc:network-retry', { detail: { attempt: ++retries } }));
    attempted = true;
    let url, roomId;
    try {
      ({ url, roomId } = await realtimeUrl());
    } catch (error) {
      console.warn('[multiplayer] matchmaker unavailable; retrying.', error.message);
      window.dispatchEvent(new CustomEvent('cc:network', { detail: { connected: false } }));
      retryLater();
      return;
    }
    if (closed) return;
    url.searchParams.set('id', clientId);
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener('open', () => {
      retryDelay = 1000; retries = 0;
      window.dispatchEvent(new CustomEvent('cc:network', { detail: { connected: true, roomId } }));
      window.dispatchEvent(new CustomEvent('cc:identify-request'));
    });
    ws.addEventListener('message', (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch (error) {
        console.error('[multiplayer] invalid server message:', error);
      }
    });
    ws.addEventListener('error', () => {
      console.warn('[multiplayer] connection failed; reconnecting when the server is available.');
      window.dispatchEvent(new CustomEvent('cc:network', { detail: { connected: false } }));
    });
    ws.addEventListener('close', () => {
      if (socket !== ws) return;
      window.dispatchEvent(new CustomEvent('cc:network', { detail: { connected: false } }));
      retryLater();   // resolves a fresh endpoint: a pod being replaced closes with 1012
    });
  }

  function send(type, data = {}) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type, ...data }));
    return true;
  }

  connect();
  return {
    send,
    clientId,
    get connected() { return socket?.readyState === WebSocket.OPEN; },
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    }
  };
}

function makeNameTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 72;
  const context = canvas.getContext('2d');
  context.font = "700 36px 'Montserrat', 'Fredoka'";
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 7;
  context.strokeStyle = 'rgba(0,0,0,.75)';
  context.fillStyle = '#ffffff';
  context.strokeText(name.slice(0, 24), 160, 36, 300);
  context.fillText(name.slice(0, 24), 160, 36, 300);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  tag.scale.set(5.6, 1.26, 1);
  tag.position.y = 7.4;
  return tag;
}

export function createRemotePlayers(scene) {
  const remotePlayers = new Map();
  const stations = new Map();

  function updatePlayer(data) {
    if (!data?.id) return;
    let remote = remotePlayers.get(data.id);
    if (!remote) {
      const character = new LegionCharacter({
        skinUrl: data.skinUrl,
        equipped: data.equipped,
        castShadow: false
      });
      character.root.add(makeNameTag(data.name || 'Player'));
      scene.add(character.root);
      remote = {
        character,
        target: new THREE.Vector3(),
        initialized: false,
        heading: 0,
        state: 'idle',
        name: data.name || 'Player',
        userId: null,
        skinUrl: data.skinUrl,
        equipped: JSON.stringify(data.equipped || {}),
        proportions: JSON.stringify(data.proportions || {})
      };
      remotePlayers.set(data.id, remote);
    } else {
      if (remote.name !== data.name) {
        remote.character.root.children.find((child) => child.isSprite)?.material.map.dispose();
        const oldTag = remote.character.root.children.find((child) => child.isSprite);
        if (oldTag) remote.character.root.remove(oldTag);
        remote.character.root.add(makeNameTag(data.name || 'Player'));
        remote.name = data.name || 'Player';
      }
      if (remote.skinUrl !== data.skinUrl && data.skinUrl) {
        remote.character.setSkin(data.skinUrl);
        remote.skinUrl = data.skinUrl;
      }
      const equipped = JSON.stringify(data.equipped || {});
      if (remote.equipped !== equipped) {
        remote.character.applyEquipped(data.equipped || {});
        remote.equipped = equipped;
      }
      const proportions = JSON.stringify(data.proportions || {});
      if (remote.proportions !== proportions) {
        const height = Number(data.proportions?.height);
        remote.character.root.scale.set(1, Number.isFinite(height) ? height : 1, 1);
        remote.proportions = proportions;
      }
    }
    if (data.position && [data.position.x, data.position.y, data.position.z].every(Number.isFinite)) {
      remote.target.set(data.position.x, data.position.y, data.position.z);
      if (!remote.initialized) {
        remote.character.root.position.copy(remote.target);
        remote.initialized = true;
      }
    }
    if (data.userId !== undefined) remote.userId = data.userId || null;   // verified Boxity account id
    if (Number.isFinite(data.heading)) remote.heading = data.heading;
    if (['idle', 'walk', 'airborne'].includes(data.state)) remote.state = data.state;
    if (remote.state !== 'idle') remote.character.stopEmote();   // an emote stops when the player moves
  }

  function handleMessage(message) {
    if (message.type === 'snapshot') {
      for (const player of message.players || []) {
        if (!remotePlayers.has(player.id)) reportPlayerInRoom(player.name);   // Boxity toasts friends already here
        updatePlayer(player);
      }
      for (const station of message.stations || []) {
        stations.set(station.stationId, station);
        window.dispatchEvent(new CustomEvent('cc:multiplayer-message', {
          detail: { type: 'station-updated', ...station }
        }));
      }
      window.dispatchEvent(new CustomEvent('cc:stations', { detail: [...stations.values()] }));
    } else if (message.type === 'player-joined' || message.type === 'player-updated') {
      if (message.type === 'player-joined') reportPlayerJoined(message.player?.name);
      updatePlayer(message.player);
    } else if (message.type === 'player-left') {
      const remote = remotePlayers.get(message.id);
      if (remote) {
        scene.remove(remote.character.root);
        remote.character.root.traverse((child) => {
          if (child.isSprite) child.material.map?.dispose();
        });
        remotePlayers.delete(message.id);
      }
    } else if (message.type === 'player-emote') {
      const remote = remotePlayers.get(message.id);
      if (remote && !message.emoteId) remote.character.stopEmote();
      else if (remote) getEmoteClip(message.emoteId).then((clip) => clip && remote.character.playEmote(clip));
    } else if (message.type === 'station-updated') {
      stations.set(message.stationId, message);
      window.dispatchEvent(new CustomEvent('cc:stations', { detail: [...stations.values()] }));
    }
    window.dispatchEvent(new CustomEvent('cc:multiplayer-message', { detail: message }));
  }

  // players whose avatar another system animates (your match opponent on the booth deck)
  let isControlled = () => false;

  function update(dt) {
    for (const [id, remote] of remotePlayers) {
      if (!remote.initialized || isControlled(id)) continue;
      const root = remote.character.root;
      const distance = root.position.distanceTo(remote.target);
      root.position.lerp(remote.target, 1 - Math.exp(-dt * 12));
      const difference = Math.atan2(Math.sin(remote.heading - root.rotation.y), Math.cos(remote.heading - root.rotation.y));
      root.rotation.y += difference * (1 - Math.exp(-dt * 14));
      remote.character.setState(remote.state === 'airborne' ? 'airborne' : 'idle');
      remote.character.update(dt, remote.state === 'walk' ? Math.min(19, distance / Math.max(dt, 0.001)) : 0);
    }
  }

  return {
    handleMessage,
    update,
    getCharacter: (id) => remotePlayers.get(id)?.character || null,
    // chat messages name the sender by Boxity account id
    getCharacterByUserId(userId) {
      if (!userId) return null;
      for (const remote of remotePlayers.values()) if (remote.userId === userId) return remote.character;
      return null;
    },
    setControlFilter(filter) { isControlled = filter; }
  };
}
