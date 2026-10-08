// Top-right profile chip (index.html #profile): your Boxity picture + name. Guests get Boxity's
// generated guest identity (or a suggested name when the SDK is missing) and a "Log in" button.
// Clicking the chip opens a menu with Gems balance, avatar customizer, invite link and friends.
// All player data goes in with textContent / DOM properties — never innerHTML.
import {
  onLocalPlayerChanged, canLogIn, logIn, logOut, openAvatarCustomizer,
  getFriends, getInviteLink, inviteFriend, getGemBalance, DEFAULT_PFP
} from '../bloxity/legion-sdk.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag); if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.append(e); return e;
}
function pfpImage(src, cls, parent) {
  const i = el('img', cls, parent); i.alt = ''; i.draggable = false;
  i.onerror = () => { i.onerror = null; i.src = DEFAULT_PFP; };
  i.src = src || DEFAULT_PFP;
  return i;
}
function button(cls, parent, text, onClick) {
  const b = el('button', cls, parent, text); b.type = 'button';
  b.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail > 0) b.blur(); onClick(b); });
  return b;
}
const STATUS_LABEL = { online: 'Online', 'in-game': 'In game', away: 'Away', offline: 'Offline' };

export function initProfile() {
  const root = document.getElementById('profile');
  if (!root) return;
  const chip = document.getElementById('profile-chip');
  const chipPfp = document.getElementById('profile-pfp');
  const chipName = document.getElementById('profile-name');
  const chipSub = document.getElementById('profile-sub');
  const menu = document.getElementById('profile-menu');
  chipPfp.onerror = () => { chipPfp.onerror = null; chipPfp.src = DEFAULT_PFP; };
  let player = null, balance = null, friends = [], loadToken = 0;

  async function loadAccountData() {
    const token = ++loadToken;
    balance = null; friends = [];
    if (player?.isGuest) { render(); return; }
    const [b, f] = await Promise.all([getGemBalance(), getFriends()]);
    if (token !== loadToken) return;   // logged out / switched account meanwhile
    balance = b; friends = f;
    render();
  }

  function render() {
    if (!player) return;
    chipPfp.src = player.pfp || DEFAULT_PFP;
    chipName.textContent = player.name;
    chipSub.textContent = player.isGuest ? 'Guest' : balance == null ? `@${player.username}` : `${balance.toLocaleString()} Gems`;
    chip.setAttribute('aria-label', `Profile: ${player.name}${player.isGuest ? ' (guest)' : ''}`);
    if (!menu.hidden) renderMenu();
  }

  function renderMenu() {
    menu.replaceChildren();
    const head = el('div', 'profile-menu__head', menu);
    pfpImage(player.pfp, 'profile-menu__pfp', head);
    const who = el('div', 'profile-menu__who', head);
    el('div', 'profile-menu__name', who, player.name);
    el('div', 'profile-menu__handle', who, player.isGuest ? 'Playing as a guest' : `@${player.username}`);

    if (player.isGuest) {
      el('p', 'profile-menu__note', menu, 'We picked this name for you. Log in to Boxity to keep your progress, avatar and friends.');
      if (canLogIn()) button('profile-menu__btn profile-menu__btn--primary', menu, 'Log in', async (b) => {
        b.disabled = true; b.textContent = 'Opening…';
        await logIn();          // onUserChanged re-renders when it succeeds
        b.disabled = false; b.textContent = 'Log in';
      });
    } else {
      const gems = el('div', 'profile-menu__gems', menu);
      const gemIcon = el('img', 'profile-menu__gem', gems); gemIcon.src = 'assets/gem.svg'; gemIcon.alt = '';
      el('span', '', gems, balance == null ? '…' : balance.toLocaleString());
      el('span', 'profile-menu__gems-label', gems, 'Gems');
    }

    const actions = el('div', 'profile-menu__actions', menu);
    if (canLogIn()) button('profile-menu__btn', actions, 'Customize avatar', () => { close(); openAvatarCustomizer(); });
    button('profile-menu__btn', actions, 'Copy invite link', async (b) => {
      const link = getInviteLink();
      try { await navigator.clipboard.writeText(link); b.textContent = 'Link copied!'; }
      catch { window.prompt('Copy this invite link:', link); }
      setTimeout(() => { b.textContent = 'Copy invite link'; }, 1800);
    });

    if (!player.isGuest) {
      const online = friends.filter((f) => f.presence?.status && f.presence.status !== 'offline');
      el('div', 'profile-menu__section', menu, `Friends · ${online.length} online`);
      const list = el('ul', 'profile-menu__friends', menu);
      if (!friends.length) el('li', 'profile-menu__empty', list, 'No friends yet');
      const sorted = [...online, ...friends.filter((f) => !online.includes(f))].slice(0, 12);
      for (const f of sorted) {
        const status = f.presence?.status || 'offline';
        const li = el('li', 'friend', list);
        const pic = el('span', 'friend__pic', li);
        pfpImage(f.pfp, 'friend__pfp', pic);
        el('span', `friend__dot friend__dot--${status}`, pic);
        const txt = el('span', 'friend__txt', li);
        el('span', 'friend__name', txt, f.displayName || f.username);
        el('span', 'friend__status', txt, status === 'in-game' && f.presence.gameName ? `Playing ${f.presence.gameName}` : STATUS_LABEL[status] || status);
        if (status !== 'offline') button('friend__invite', li, 'Invite', async (b) => {
          b.disabled = true;
          b.textContent = (await inviteFriend(f._id)) ? 'Sent' : 'Failed';
        });
      }
      button('profile-menu__btn profile-menu__btn--quiet', menu, 'Log out', () => { close(); logOut(); });
    }
  }

  function open() {
    menu.hidden = false; chip.setAttribute('aria-expanded', 'true');
    renderMenu();
    if (!player.isGuest) loadAccountData();   // fresh balance + presence each time it opens
  }
  function close() { menu.hidden = true; chip.setAttribute('aria-expanded', 'false'); }

  chip.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail > 0) chip.blur(); menu.hidden ? open() : close(); });
  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  addEventListener('pointerdown', (e) => { if (!menu.hidden && !root.contains(e.target)) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopImmediatePropagation(); close(); } }, true);

  onLocalPlayerChanged((p) => {
    const accountChanged = !player || player.userId !== p.userId;
    player = p;
    render();
    if (accountChanged) loadAccountData();
  });
  // after a Gems purchase
  addEventListener('cc:gems-balance', () => { if (!player?.isGuest) loadAccountData(); });
}
