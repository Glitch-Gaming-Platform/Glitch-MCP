/** Canonical copyable browser source. Keep it dependency-free for HTTP/MCP guides. */
export const COMMERCE_REST_STARTER_SOURCE = String.raw`function createGlitchRestShop(config) {
  const win = window, doc = document;
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const expires = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
  function trustedUrl(value, originOnly = false) {
    const url = new URL(value);
    const local = config.allowLocalDevelopment === true && config.environment === 'sandbox'
      && (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || /\.(test|local)$/.test(url.hostname));
    if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || (originOnly && url.origin !== value)) throw new Error('Configure an exact trusted HTTPS origin.');
    return url;
  }
  const apiUrl = trustedUrl(config.apiBase);
  if (apiUrl.search || apiUrl.hash || !uuid(config.titleId) || !['sandbox', 'live'].includes(config.environment) || !/^[A-Za-z0-9_.-]{1,100}$/.test(config.spendKey || '')) throw new Error('Invalid commerce configuration.');
  trustedUrl(config.checkoutOrigin, true);
  const returnOrigin = trustedUrl(win.location.origin, true).origin;
  const base = apiUrl.href.replace(/\/$/, '') + '/titles/' + encodeURIComponent(config.titleId) + '/microtransactions';
  const timeoutMs = Math.max(1000, Math.min(60000, config.timeoutMs || 15000));
  const frameTimeoutMs = Math.max(1000, Math.min(60000, config.frameTimeoutMs || 20000));
  let disposed = false, opening = false, busy = false, player = null, inventory = [], inventoryFresh = false;
  let overlay = null, pendingPurchase = null, pendingRestore = null, historyPage = 1, historyMeta = null;
  const requests = new Set(), actions = new Map();
  function nonce() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
  function problem(code, status = 0) { const error = new Error(code); error.code = code; error.status = status; return error; }
  async function request(path, options = {}) {
    if (disposed) throw problem('disposed');
    const headers = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.token) {
      if (!/^gl_player_[A-Za-z0-9]{40,128}$/.test(options.token)) throw problem('invalid_player_token');
      headers.Authorization = 'Bearer ' + options.token;
    }
    if (options.checkoutToken) headers['X-Checkout-Token'] = options.checkoutToken;
    // The browser supplies Origin. Never set it manually or add an admin/site JWT.
    const controller = new AbortController(); requests.add(controller);
    let timedOut = false;
    const aborted = new Promise((resolve, reject) => controller.signal.addEventListener('abort', () => reject(problem(timedOut ? 'timeout' : 'aborted')), { once: true }));
    const timer = win.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      return await Promise.race([aborted, (async () => {
        const response = await fetch(base + path, {
          method: options.method || 'GET', headers, mode: 'cors', credentials: 'omit',
          cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 401 && options.token && player?.token === options.token) { player = null; inventoryFresh = false; controls(); }
          throw problem(result?.code === 'no_purchases_to_restore' ? result.code : 'http_error', response.status);
        }
        if (!result || typeof result !== 'object' || !Object.prototype.hasOwnProperty.call(result, 'data')) throw problem('invalid_response');
        return result.data;
      })()]);
    } finally { win.clearTimeout(timer); requests.delete(controller); }
  }
  function help(error) {
    if (error.code === 'no_purchases_to_restore') return 'No completed purchases to restore for this account, game and environment. No new payment was made.';
    if (error.status === 401) return 'Restore/sign in through Glitch to renew commerce access. Never put a site JWT or developer token in the game.';
    if (error.status === 403) return 'Check the exact configured game Origin and return_origin, account, title and environment. Do not relax origin checks or add developer credentials.';
    if (error.status === 409) return 'Check readiness or the existing payment state. Do not create a replacement charge.';
    if (error.status === 410) return 'This capability expired or was used. Restore a purchase or request a fresh handoff in the SAME hosted checkout.';
    if (error.status === 422) return 'Check required fields, product ID, region, currency and environment.';
    return 'The result could not be verified. Keep the game open and retry the same operation; never infer payment success.';
  }
  const root = doc.createElement('section'); root.setAttribute('aria-label', 'REST in-game shop');
  const heading = doc.createElement('h2'); heading.textContent = 'Game shop — direct REST';
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const choices = doc.createElement('select'); choices.setAttribute('aria-label', 'Choose an in-game product');
  const balances = doc.createElement('ul'); balances.setAttribute('aria-label', 'Verified paid inventory');
  const historyRows = doc.createElement('ul'); historyRows.setAttribute('aria-label', 'My purchase history');
  function tell(text) { if (!disposed) status.textContent = text; }
  function button(text, callback) {
    const node = doc.createElement('button'); node.type = 'button'; node.textContent = text;
    node.addEventListener('click', () => { void Promise.resolve().then(callback).catch(error => tell(help(error))); }); return node;
  }
  const buy = button('Buy selected item', () => openShop(false));
  const restore = button('Restore my purchases', () => openShop(true));
  const refresh = button('Refresh inventory / payment status', refreshCurrent);
  const spend = button('Use 1 unit of ' + config.spendKey, useOneUnit);
  const history = button('List my purchases (optional)', () => loadHistory(1));
  const previous = button('Previous purchases', () => loadHistory(historyPage - 1));
  const next = button('Next purchases', () => loadHistory(historyPage + 1));
  root.append(heading, choices, buy, restore, refresh, spend, history, status, balances, historyRows, previous, next);
  (config.container || doc.body).append(root);
  function controls() {
    const blocked = disposed || opening || busy || Boolean(overlay), authenticated = player && expires(player.expiresAt);
    buy.disabled = blocked || (!pendingPurchase && !choices.value); buy.textContent = pendingPurchase ? 'Resume the same checkout' : 'Buy selected item';
    choices.disabled = blocked || Boolean(pendingPurchase); restore.disabled = blocked;
    refresh.disabled = blocked || (!player && !pendingPurchase);
    spend.disabled = blocked || !authenticated || !inventoryFresh || !inventory.some(item => item.key === config.spendKey && item.kind === 'consumable' && item.balance > 0);
    history.disabled = blocked || !authenticated;
    previous.disabled = blocked || !authenticated || !historyMeta || historyPage <= 1;
    next.disabled = blocked || !authenticated || !historyMeta?.has_more_pages || historyPage >= 10000;
  }
  function validInventory(rows) {
    if (!Array.isArray(rows) || new Set(rows.map(item => item?.key)).size !== rows.length
      || rows.some(item => !item || !/^[A-Za-z0-9_.-]{1,100}$/.test(item.key || '') || !['consumable', 'durable', 'pass'].includes(item.kind)
        || item.environment !== config.environment || !Number.isSafeInteger(item.balance) || item.balance < 0)) throw problem('invalid_inventory');
    return rows;
  }
  function applyInventory(identity, rows) {
    validInventory(rows); inventoryFresh = false;
    // This adapter is synchronous. Replace ONLY purchased inventory, not earned progress.
    const applied = config.onInventory?.({ playerId: identity.id, entitlements: rows.map(item => ({ ...item })) });
    if (applied && typeof applied.then === 'function') throw problem('inventory_adapter_must_be_synchronous');
    if (player?.id !== identity.id) { historyRows.replaceChildren(); historyMeta = null; historyPage = 1; }
    player = identity; inventory = rows; inventoryFresh = true;
    balances.replaceChildren(...rows.map(item => { const li = doc.createElement('li'); li.textContent = item.key + ': ' + item.balance; return li; })); controls();
  }
  function currentPlayer() {
    if (player && expires(player.expiresAt)) return player;
    tell('Restore through Glitch to renew access. Refunded-only accounts may need their Glitch purchase history rather than a new game token.'); controls(); return null;
  }
  function orderMatches(order, id) { return order && uuid(order.id) && (!id || order.id === id) && order.title_id === config.titleId && order.environment === config.environment; }
  function fulfilled(order) { return ['paid', 'partially_refunded'].includes(order.payment_status) && ['delivered', 'partially_recovered'].includes(order.fulfillment_status); }
  function active(context) { return !disposed && overlay === context && !context.closed; }
  function validateSession(value, input, restoring) {
    if (!value || !uuid(value.id) || value.checkout_session_id !== value.id || value.nonce !== input.nonce || !expires(value.expires_at)
      || !/^[A-Za-z0-9_-]{40,128}$/.test(value.session_token || '') || (restoring ? value.intent !== 'restore' : value.intent && value.intent !== 'purchase')) throw problem('invalid_checkout_session');
    const url = trustedUrl(value.hosted_url), fragment = new URLSearchParams(url.hash.slice(1));
    if (url.origin !== config.checkoutOrigin || url.pathname !== '/games/' + config.titleId + '/checkout/' + value.id || url.search
      || Array.from(fragment.keys()).length !== 1 || fragment.get('token') !== value.session_token) throw problem('invalid_checkout_url');
    return { id: value.id, nonce: input.nonce, session_token: value.session_token, hosted_url: url.href, expires_at: value.expires_at, intent: restoring ? 'restore' : 'purchase', orderId: null };
  }
  async function receipt(session) {
    const value = await request('/checkout-sessions/' + session.id, { checkoutToken: session.session_token });
    if (value.id !== session.id || value.checkout_session_id !== session.id || value.title?.id !== config.titleId || value.environment !== config.environment
      || value.nonce !== session.nonce || value.return_origin !== returnOrigin || (value.order && !orderMatches(value.order))) throw problem('invalid_receipt');
    if (disposed) return;
    if (pendingPurchase === session && value.order) { session.orderId = value.order.id; if (['failed', 'canceled', 'refunded'].includes(value.order.payment_status)) pendingPurchase = null; }
    // Session capability responses are status only; NEVER apply inventory from them.
    tell(value.order ? 'Server status: ' + value.order.payment_status + ' / ' + value.order.fulfillment_status + '. Inventory needs the verified account handoff.' : 'No payment is recorded yet. Resume this same checkout, not a replacement attempt.');
    return value.order;
  }
  async function verifyCandidate(context) {
    const identity = context.candidate;
    if (!identity || !expires(identity.expiresAt)) throw problem('expired_player_token', 401);
    const order = await request('/orders/' + identity.orderId, { token: identity.token });
    if (!active(context)) return;
    if (!orderMatches(order, identity.orderId) || (Object.prototype.hasOwnProperty.call(order, 'player_id') && order.player_id !== identity.id) || (!context.verified && !fulfilled(order))) throw problem('unverified_order');
    const result = await request('/entitlements?' + new URLSearchParams({ environment: config.environment }), { token: identity.token });
    if (!active(context)) return;
    applyInventory(identity, validInventory(result.entitlements)); context.verified = true;
    win.clearTimeout(context.watchdog); context.ready = true;
    if (context.phase === 'failed') context.phase = 'idle';
    context.status.textContent = 'Server-verified inventory has been applied. Your game remains open.';
    if (pendingPurchase && (pendingPurchase.id === context.session.id || pendingPurchase.orderId === order.id)) pendingPurchase = null;
    tell(fulfilled(order) ? 'Server-verified inventory is applied to this player. Close the overlay to continue.' : 'Purchase status changed. Inventory was replaced from the server, including revoked items.');
  }
  function ready(context) { win.clearTimeout(context.watchdog); context.ready = true; context.status.textContent = 'Glitch checkout is ready. Your game stays loaded.'; }
  async function acceptMessage(context, event) {
    if (!active(context) || context.closing || event.origin !== config.checkoutOrigin || event.source !== context.frameWindow) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || message.version !== 1 || message.title_id !== config.titleId
      || message.checkout_session_id !== context.session.id || message.nonce !== context.session.nonce) return;
    if (message.type === 'glitch.microtransaction.ready') {
      if (context.phase === 'idle') ready(context); else if (context.phase === 'checkout' && !blank(context)) context.readyEarly = true;
      return; // Ready, load, redirects and 3DS completion are NOT payment proof.
    }
    if (message.type === 'glitch.microtransaction.close') { void closeOverlay(context); return; }
    if (message.type !== 'glitch.microtransaction.updated' || !uuid(message.order_id) || !/^[A-Za-z0-9_-]{40,128}$/.test(message.claim_code || '')
      || context.flight || context.codes.has(message.claim_code) || context.codes.size >= 8 || (context.candidate && context.candidate.orderId !== message.order_id)) return;
    context.codes.add(message.claim_code); // A lost response may still consume a one-use code.
    context.flight = (async () => {
      const result = await request('/handoffs/claim', { method: 'POST', body: { claim_code: message.claim_code,
        checkout_session_id: context.session.id, nonce: context.session.nonce, return_origin: returnOrigin } });
      if (!active(context)) return;
      if (result.title_id !== config.titleId || result.checkout_session_id !== context.session.id || result.order_id !== message.order_id
        || typeof result.player_id !== 'string' || !result.player_id || !/^gl_player_[A-Za-z0-9]{40,128}$/.test(result.player_token || '')
        || !expires(result.expires_at) || !Array.isArray(result.entitlements) || (context.candidate && context.candidate.id !== result.player_id)) throw problem('invalid_claim');
      context.candidate = { id: result.player_id, token: result.player_token, expiresAt: result.expires_at, orderId: result.order_id };
      await verifyCandidate(context);
    })().catch(error => { if (active(context)) { context.status.textContent = help(error) + ' Reload the SAME frame for a fresh code if the claim response was lost.'; tell(context.status.textContent); } }).finally(() => { context.flight = null; });
  }
  function watchdog(context) {
    win.clearTimeout(context.watchdog); context.ready = false;
    context.watchdog = win.setTimeout(() => { if (active(context)) { context.phase = 'failed'; context.status.textContent = 'Embedded checkout did not become ready. Retry the SAME frame or close. No new payment or game navigation was attempted.'; } }, frameTimeoutMs);
  }
  function blank(context) { try { return context.iframe.contentDocument?.URL === 'about:blank' && context.iframe.contentDocument.readyState === 'complete'; } catch { return false; } }
  function mount(session) {
    if (typeof doc.createElement('dialog').showModal !== 'function') throw problem('modal_unavailable');
    const dialog = doc.createElement('dialog'); dialog.setAttribute('aria-label', session.intent === 'restore' ? 'Restore game purchases' : 'Secure game checkout');
    dialog.style.cssText = 'box-sizing:border-box;padding:16px;border:0;border-radius:12px;width:min(1100px,96vw);height:92vh;height:92dvh;max-height:100%;background:white;color:#172033;';
    const title = doc.createElement('h2'); title.textContent = session.intent === 'restore' ? 'Restore game purchases' : 'Secure game checkout'; title.style.cssText = 'color:#172033;font:600 18px/1.3 system-ui,sans-serif;';
    const message = doc.createElement('p'); message.setAttribute('role', 'status'); message.textContent = 'Loading Glitch. Your game remains mounted.';
    const iframe = doc.createElement('iframe'); iframe.title = title.textContent;
    iframe.setAttribute('allow', 'payment'); iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    iframe.referrerPolicy = 'no-referrer'; iframe.style.cssText = 'display:block;flex:1 1 0%;width:100%;min-height:0;border:0;background:white;';
    const context = { session, dialog, iframe, status: message, candidate: null, verified: false, codes: new Set(), flight: null,
      closed: false, closing: false, phase: 'idle', ready: false, readyEarly: false, watchdog: null, beforeFocus: doc.activeElement, overflow: doc.body.style.overflow };
    const close = button('Close and return to game', () => closeOverlay(context));
    const retry = button('Reload SAME checkout', () => {
      if (!active(context) || context.closing || context.flight || !['idle', 'failed'].includes(context.phase)) return;
      context.phase = 'blank'; context.readyEarly = false; message.textContent = 'Reloading the same session, not creating a payment.'; watchdog(context); iframe.src = 'about:blank';
    });
    const check = button('Verify inventory / check status', async () => {
      if (!active(context) || context.closing || context.flight) return;
      context.flight = (context.candidate ? verifyCandidate(context) : receipt(session)).catch(error => { if (active(context)) message.textContent = help(error); }).finally(() => { context.flight = null; }); await context.flight;
    });
    context.buttons = [retry, check, close];
    const chrome = doc.createElement('div'); chrome.style.cssText = 'flex:0 1 auto;max-height:45%;overflow:auto;'; chrome.append(title, message, retry, check, close);
    dialog.append(chrome, iframe); doc.body.append(dialog); context.frameWindow = iframe.contentWindow;
    if (!context.frameWindow) { dialog.remove(); throw problem('frame_unavailable'); }
    context.listener = event => { void acceptMessage(context, event); };
    context.cancel = event => { event.preventDefault(); void closeOverlay(context); };
    context.keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); void closeOverlay(context); }
      if (event.key === 'Tab' && event.shiftKey && doc.activeElement === retry) { event.preventDefault(); iframe.focus(); }
      else if (event.key === 'Tab' && !event.shiftKey && doc.activeElement === iframe) { event.preventDefault(); retry.focus(); }
    };
    context.load = () => {
      if (!active(context) || context.phase === 'failed') return;
      if (context.phase === 'blank') { if (blank(context)) { context.phase = 'checkout'; watchdog(context); iframe.src = session.hosted_url; } return; }
      if (context.phase === 'checkout' && !blank(context)) { context.phase = 'idle'; if (context.readyEarly) ready(context); }
      // Only a validated ready message clears the watchdog, never a load event alone.
    };
    context.frameError = () => { if (active(context)) { context.phase = 'failed'; message.textContent = 'The embedded form could not load. Retry the same session or close; the game will not navigate.'; } };
    win.addEventListener('message', context.listener); dialog.addEventListener('cancel', context.cancel); dialog.addEventListener('keydown', context.keydown);
    iframe.addEventListener('load', context.load); iframe.addEventListener('error', context.frameError); overlay = context;
    try { dialog.showModal(); dialog.style.display = 'flex'; dialog.style.flexDirection = 'column'; doc.body.style.overflow = 'hidden'; config.pauseGame?.(); close.focus(); iframe.src = session.hosted_url; watchdog(context); }
    catch (error) { cleanup(context); throw error; }
    controls();
  }
  function cleanup(context) {
    context.closed = true; win.clearTimeout(context.watchdog);
    win.removeEventListener('message', context.listener); context.dialog.removeEventListener('cancel', context.cancel); context.dialog.removeEventListener('keydown', context.keydown);
    context.iframe.removeEventListener('load', context.load); context.iframe.removeEventListener('error', context.frameError);
    context.dialog.remove(); doc.body.style.overflow = context.overflow;
    if (overlay === context) overlay = null;
    if (pendingRestore === context.session) pendingRestore = null; // A later restore may bind a different account; never rebind this session.
    context.candidate = null; context.codes.clear();
    try { config.resumeGame?.(); } catch { tell('Reconnect the game’s resume-input/audio adapter.'); }
    controls(); if (context.beforeFocus?.isConnected) context.beforeFocus.focus();
  }
  async function closeOverlay(context) {
    if (!active(context) || context.closing) return;
    context.closing = true; context.buttons.forEach(node => { node.disabled = true; });
    // Finish the in-flight claim and synchronous inventory adapter before removing the frame.
    if (context.flight) await context.flight;
    if (!active(context)) return;
    if (context.verified) { try { await verifyCandidate(context); } catch (error) { inventoryFresh = false; tell(help(error)); } }
    if (!active(context)) return;
    const needsReceipt = pendingPurchase === context.session && !context.verified; cleanup(context);
    if (needsReceipt) { busy = true; controls(); try { await receipt(context.session); } catch (error) { tell(help(error)); } finally { busy = false; controls(); if (!disposed && !overlay && context.beforeFocus?.isConnected) context.beforeFocus.focus(); } }
  }
  async function openShop(restoring) {
    if (disposed || opening || busy || overlay) return;
    opening = true; controls();
    try {
      let session = restoring ? pendingRestore : pendingPurchase;
      if (session && !expires(session.expires_at)) { if (!restoring) throw problem('expired_checkout_restore_required', 410); session = null; }
      if (!session) {
        const input = { environment: config.environment, return_origin: returnOrigin, nonce: nonce() };
        if (!restoring) Object.assign(input, { product_id: choices.value, quantity: 1, country: config.country, currency: config.currency, channel: 'web' });
        const result = await request(restoring ? '/restore-sessions' : '/checkout-sessions', { method: 'POST', body: input });
        if (disposed) return;
        session = validateSession(result, input, restoring);
        if (restoring) pendingRestore = session; else pendingPurchase = session;
      }
      mount(session);
    } finally { opening = false; controls(); }
  }
  async function refreshInventory(identity) {
    const result = await request('/entitlements?' + new URLSearchParams({ environment: config.environment }), { token: identity.token });
    if (!disposed && player === identity) applyInventory(identity, validInventory(result.entitlements));
  }
  async function refreshCurrent() {
    if (busy || overlay || disposed) return;
    busy = true; controls();
    try { if (player && currentPlayer()) await refreshInventory(player); else if (pendingPurchase) await receipt(pendingPurchase); }
    finally { busy = false; controls(); }
  }
  async function useOneUnit() {
    const identity = currentPlayer();
    if (!identity || busy || overlay || !inventoryFresh || !inventory.some(item => item.key === config.spendKey && item.kind === 'consumable' && item.balance > 0)) return;
    busy = true; controls(); let confirmed = false;
    const key = 'glitch:rest-consume:' + [config.titleId, identity.id, config.environment, config.spendKey].map(encodeURIComponent).join(':');
    try {
      let action = actions.get(key), saved = null;
      if (!action) { try { saved = win.sessionStorage.getItem(key); } catch { /* Memory fallback; keep this tab open for retries. */ } if (saved) action = JSON.parse(saved); }
      action ||= { key: config.spendKey, quantity: 1, action_id: nonce(), environment: config.environment };
      if (action.key !== config.spendKey || action.quantity !== 1 || action.environment !== config.environment || !/^[A-Za-z0-9_-]{22,128}$/.test(action.action_id || '')) throw problem('invalid_saved_action');
      actions.set(key, action);
      try { win.sessionStorage.setItem(key, JSON.stringify(action)); } catch { /* Store no token or paid balance; memory retries reuse the ID. */ }
      const result = await request('/consume', { method: 'POST', token: identity.token, body: action });
      if (result.entitlement?.key !== action.key || result.entitlement.kind !== 'consumable') throw problem('invalid_consumption');
      validInventory([result.entitlement]); confirmed = true;
      if (disposed || player !== identity) return;
      inventoryFresh = false; await refreshInventory(identity);
      if (!disposed && player === identity) {
        actions.delete(key); try { win.sessionStorage.removeItem(key); } catch { /* Optional storage. */ }
        tell(result.replayed ? 'Previous use reconciled; no extra unit was spent. Inventory was replaced. A new click gets a new action ID.' : 'Use confirmed. Inventory was replaced from the server; duplicate action IDs never spend twice.');
      }
    } catch (error) { tell(confirmed ? 'Use was confirmed, but inventory refresh failed. Refresh inventory before spending again.' : 'Use was not confirmed. Retry Use with the SAME saved action ID. ' + help(error)); }
    finally { busy = false; controls(); }
  }
  async function loadHistory(page) {
    const identity = currentPlayer();
    if (!identity || busy || overlay || !Number.isInteger(page) || page < 1 || page > 10000) return;
    busy = true; controls();
    try {
      const result = await request('/me/purchases?' + new URLSearchParams({ environment: config.environment, page, per_page: 20 }), { token: identity.token });
      if (disposed || player !== identity) return;
      if (result.title_id !== config.titleId || result.player_id !== identity.id || result.environment !== config.environment || !Array.isArray(result.purchases) || result.purchases.length > 20
        || result.pagination?.page !== page || result.pagination.per_page !== 20 || !Number.isInteger(result.pagination.total) || result.pagination.total < 0 || !Number.isInteger(result.pagination.last_page) || result.pagination.last_page < 1 || typeof result.pagination.has_more_pages !== 'boolean'
        || result.purchases.some(item => item.title_id !== config.titleId || item.player_id !== identity.id || item.environment !== config.environment || !Array.isArray(item.grant_usage))) throw problem('invalid_purchase_history');
      historyPage = page; historyMeta = result.pagination;
      historyRows.replaceChildren(...result.purchases.map(item => {
        const li = doc.createElement('li'); li.textContent = (item.product?.name || 'Archived item') + ' — ' + item.payment_status + ' / ' + item.fulfillment_status;
        const usage = doc.createElement('ul');
        for (const grant of item.grant_usage) { const row = doc.createElement('li'); row.textContent = grant.key + ': ' + grant.usage_status + '; purchased ' + grant.purchased_quantity + ', granted ' + grant.granted_quantity + ', usable ' + grant.usable_quantity
          + (grant.kind === 'consumable' ? ', consumed ' + grant.consumed_quantity : ', ownership/pass use is not a consumed boolean; expired: ' + grant.expired); usage.append(row); }
        li.append(usage); return li;
      }));
      tell(result.purchases.length ? 'This account’s history is informational, never authority to grant items.' : 'No completed purchase records on this page.');
    } finally { busy = false; controls(); }
  }
  async function loadCatalog() {
    const result = await request('/catalog?' + new URLSearchParams({ country: config.country, currency: config.currency, environment: config.environment, channel: 'web' }));
    if (disposed) return;
    if (result.title?.id !== config.titleId || result.environment !== config.environment || !Array.isArray(result.products)) throw problem('invalid_catalog');
    const eligible = result.products.filter(item => uuid(item.id) && item.status === 'active');
    choices.replaceChildren(...eligible.map(item => { const option = doc.createElement('option'); option.value = item.id; option.textContent = item.name; return option; }));
    choices.value = eligible[0]?.id || '';
    if (result.available !== true) { choices.replaceChildren(); tell('Commerce configuration is unavailable: ' + (Array.isArray(result.blockers) ? result.blockers.join(', ') : 'check readiness') + '. Fix setup; do not add credentials to the game.'); }
    else tell(choices.value ? 'Select a catalog item. Hosted account creation, payment and 3DS stay inside Glitch.' : 'No eligible products for this market.'); controls();
  }
  choices.addEventListener('change', controls); controls(); void loadCatalog().catch(error => tell(help(error)));
  return { reloadCatalog: loadCatalog, destroy() { if (disposed) return; disposed = true; requests.forEach(controller => controller.abort()); if (overlay) cleanup(overlay); player = null; inventory = []; pendingPurchase = null; pendingRestore = null; root.remove(); } };
}`;
