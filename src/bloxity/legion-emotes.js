// Boxity emote catalogue. Boxity draws the emote picker itself and sends the chosen id through
// Legion.SDK.player.onEvent('play_emote'); the clips are played by LegionCharacter.playEmote().
const EMOTES_URL = 'https://api.bloxity.io/v1/avatar/emotes';

let catalogue = null;

/** Fetched once at startup; resolves to Map<id, clip>. A failed fetch yields an empty map. */
export function loadEmotes() {
  if (!catalogue) {
    catalogue = fetch(EMOTES_URL)
      .then((response) => (response.ok ? response.json() : { emotes: [] }))
      .then((body) => {
        const list = Array.isArray(body) ? body : body?.emotes || [];
        return new Map(list.filter((emote) => emote?.id && emote.clip?.tracks).map((emote) => [emote.id, emote.clip]));
      })
      .catch((error) => {
        console.warn('[legion] emote catalogue unavailable', error);
        return new Map();
      });
  }
  return catalogue;
}

/** Clip for an emote id, or null for an unknown id (ignored silently). */
export async function getEmoteClip(id) {
  if (typeof id !== 'string') return null;
  return (await loadEmotes()).get(id) || null;
}
