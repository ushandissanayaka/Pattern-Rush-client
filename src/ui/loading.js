// Loading screen (index.html #loading). main.js reports each real start-up step here, then
// finishLoading() removes the screen and the player is in the lobby. Each step is mirrored to
// Boxity's own loading screen when the game is embedded on bloxity.io.
import { legionLoadingStep, legionLoadingEnd } from '../bloxity/legion-sdk.js';

const root = document.getElementById('loading');
const statusText = document.getElementById('loading-status');

export function loadingStatus(text) {
  if (statusText) statusText.textContent = text;
  legionLoadingStep(text);
}

// The loading screen is static: it is removed in one step once the game is ready (no fade).
export function finishLoading() {
  root?.remove();
  legionLoadingEnd();
}
