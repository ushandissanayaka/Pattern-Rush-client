// "Buy item" popup for Boxity Gems (shop offers, troll buttons, reveal). Shows your Gem balance, the
// item at its Boxity catalog price and — when you are short — the smallest Gem pack that covers it
// ("Buy Gems and item"). Buy tops up first if needed, then calls Legion.SDK.gems.requestPurchase(sku).
// The gem number passed in is only a label used until the catalog price arrives.
// All text is set with textContent.
import {
  getGemBalance, getCatalogItem, getTopUpPackages, requestTopUp, purchaseWithGems,
  isLoggedIn, logIn, canLogIn
} from '../bloxity/legion-sdk.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag); if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.append(e); return e;
}
function gem(parent, cls = 'pay__gem') { const i = el('img', cls, parent); i.src = 'assets/gem.svg'; i.alt = ''; i.draggable = false; return i; }

let layer = null, current = null;   // current = { resolve } of the open popup

function close(result = { success: false, error: 'Purchase cancelled' }) {
  if (!current) return;
  const { resolve } = current;
  current = null;
  layer.hidden = true; layer.replaceChildren();
  resolve(result);
}

function ensureLayer() {
  if (layer) return;
  layer = el('div', 'pay-layer', document.body); layer.hidden = true;
  layer.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === layer) close(); });
  layer.addEventListener('pointerdown', (e) => e.stopPropagation());
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) { e.stopImmediatePropagation(); close(); } }, true);
}

/** Opens the popup. Resolves { success, transactionId?, error? } once bought or closed. */
export function openPurchase({ sku, name, icon, price, metadata }) {
  ensureLayer();
  if (current) close();
  return new Promise((resolve) => {
    current = { resolve };
    const mine = current;
    let balance = null, packages = [], itemPrice = price, busy = false;

    layer.replaceChildren();
    const box = el('div', 'pay', layer);
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const top = el('div', 'pay__top', box);
    const title = el('span', 'pay__title', top, 'Buy item');
    const bal = el('span', 'pay__bal', top); gem(bal); const balText = el('span', '', bal, '…');
    bal.setAttribute('aria-label', 'Your Gems');
    const x = el('button', 'pay__x', top, '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = () => close();
    box.setAttribute('aria-labelledby', 'pay-title'); title.id = 'pay-title';

    const item = el('div', 'pay__item', box);
    const ic = el('img', 'pay__icon', item); ic.src = icon; ic.alt = '';
    const meta = el('div', 'pay__meta', item); const nameEl = el('div', 'pay__name', meta, name);
    const pr = el('div', 'pay__price', meta); gem(pr); const priceText = el('span', '', pr, String(itemPrice ?? '…'));

    const opt = el('div', 'pay__opt', box); opt.hidden = true;
    const optL = el('span', 'pay__optl', opt); gem(optL); const optAmount = el('span', '', optL);
    const old = el('span', 'pay__old', optL); gem(old, 'pay__gem pay__gem--old'); const optOld = el('s', '', old);
    const optUsd = el('span', 'pay__usd', opt);

    const error = el('p', 'pay__error', box); error.hidden = true; error.setAttribute('role', 'alert');
    const buy = el('button', 'pay__buy', box, 'Buy'); buy.type = 'button';
    const legal = el('p', 'pay__legal', box, 'Your payment method will be charged. Boxity ');
    const a = el('a', '', legal, 'Terms of Use'); a.href = 'https://bloxity.io/terms'; a.target = '_blank'; a.rel = 'noopener';
    legal.append(' apply.'); legal.hidden = true;

    // short = Gems still needed (guests have none); the pack row + "Buy Gems and item" only appear when short
    const shortBy = () => {
      const have = isLoggedIn() ? balance : 0;
      return have == null || itemPrice == null ? 0 : Math.max(0, itemPrice - have);
    };
    const pack = () => packages.find((p) => p.amount >= shortBy()) || packages[packages.length - 1];
    function render() {
      if (current !== mine) return;
      const loggedIn = isLoggedIn();
      balText.textContent = loggedIn ? (balance == null ? '…' : balance.toLocaleString()) : '0';
      priceText.textContent = String(itemPrice ?? '…');
      const p = shortBy() > 0 ? pack() : null;
      title.textContent = p ? 'Buy Gems and item' : 'Buy item';
      opt.hidden = !p; legal.hidden = !p;
      if (p) {
        optAmount.textContent = p.amount.toLocaleString();
        old.hidden = !(p.baseAmount && p.baseAmount !== p.amount);
        optOld.textContent = (p.baseAmount || '').toLocaleString();
        optUsd.textContent = `$${Number(p.price).toFixed(2)}`;
      }
      if (!busy) buy.textContent = !loggedIn && canLogIn() ? 'Log in to buy' : 'Buy';
    }
    async function load() {
      const [b, catalogItem, packs] = await Promise.all([getGemBalance(), getCatalogItem(sku), getTopUpPackages()]);
      if (current !== mine) return;
      balance = b; packages = [...packs].sort((p, q) => p.amount - q.amount);
      if (catalogItem) { itemPrice = catalogItem.price; if (catalogItem.name) nameEl.textContent = catalogItem.name; }
      render();
    }
    const fail = (message) => { error.textContent = message; error.hidden = false; };

    buy.onclick = async () => {
      if (busy) return;
      error.hidden = true;
      busy = true; buy.disabled = true;
      try {
        if (!isLoggedIn()) {
          buy.textContent = 'Logging in…';
          const user = await logIn();
          if (current !== mine) return;
          if (!user) { fail('Log in to Boxity to buy with Gems.'); return; }
          await load();
          return;   // show the real balance before charging anything
        }
        if (shortBy() > 0) {
          buy.textContent = 'Adding Gems…';
          const topUp = await requestTopUp(shortBy());
          if (current !== mine) return;
          if (!topUp.success) { fail(topUp.error || 'The Gem purchase did not go through.'); return; }
          balance = await getGemBalance();
        }
        buy.textContent = 'Buying…';
        const result = await purchaseWithGems(sku, metadata);
        if (current !== mine) return;
        if (result.success) { close(result); return; }
        if (!/cancel/i.test(result.error || '')) fail(result.error || 'Purchase failed.');
      } finally {
        if (current === mine) { busy = false; buy.disabled = false; render(); }
      }
    };

    render();
    layer.hidden = false;
    buy.focus({ preventScroll: true });
    load();
  });
}
