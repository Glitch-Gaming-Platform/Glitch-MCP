/** Beginner runtime tutorial mirrored from the SDK guide; no credentials or user impersonation tools. */
export const MICROTRANSACTION_CALLBACK_TUTORIAL = `# Beginner callback: make the purchase work in the running game

Minimum SDK for this tutorial is 3.15.0: use a confirmed published 3.15.0+ release or an approved local package. Registry verification on September 15, 2026 showed public latest 3.10.8, which lacks commerce. Plain public npm installation at that point cannot run this example. Until 3.15.0 is actually published, use the reviewed local 3.15.0 tarball for testing; never claim a local build is a published release.

Use the game's Pricing/monetization page for Enable in-game purchases and Show ads. The Microtransactions page configures the catalog, required fields, Media and integration. Required product fields are SKU*, Name*, Type*, Prices* and Grants*; each price needs currency/country/integer minor units, each grant key/quantity/kind, and pass grants require duration_seconds.

For 100 Timber spent constructing things, choose product type currency (or consumable), with a consumable grant {key:'timber',quantity:100,kind:'consumable'}. Durable means lasting ownership and cannot be spent. Do not configure building Timber as durable.

The following complete browser-module example creates a small shop UI and defines every game helper it calls. Call installTimberShop with the real titleId, productId, apiBaseUrl and checkoutOrigin from that game's setup. environment defaults to sandbox; select approved local endpoints plus allowLocalDevelopment:true for local tests. Never put provider secrets, a developer/MCP token or an account JWT in these options.

The SDK validates the actual iframe origin/source/title/session/nonce, redeems the one-time claim at Glitch, then invokes onVerified. The callback sets the game's player profile ID, retains only the short-lived player token in memory and REPLACES inventory from the verified server result. A message, product quantity, ready notification or checkout close cannot independently grant anything.

\`\`\`js
import Glitch, {
  createMicrotransactionNonce,
  openMicrotransactionOverlay,
  openMicrotransactionRestoreOverlay,
} from 'glitch-javascript-sdk';

export function installTimberShop({ titleId, productId, apiBaseUrl, checkoutOrigin,
  environment = 'sandbox', allowLocalDevelopment = false }) {
  Glitch.util.Requests.setBaseUrl(apiBaseUrl); // Set API location, NOT global auth.
  const api = Glitch.api.Microtransactions;
  const game = { playerId: null, inventory: [], paused: false };
  let playerToken = '', tokenExpiresAt = 0, overlay = null;
  let opening = false, spending = false, pendingUse = null;
  const shop = document.createElement('section');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const timber = document.createElement('output');
  const history = document.createElement('pre');
  shop.append(timber, status, history); document.body.append(shop);
  const say = text => { status.textContent = text; };

  function replaceInventoryInYourGame(entitlements) {
    game.inventory = entitlements; // REPLACE the snapshot. Never add 100 here.
    timber.textContent = 'Timber: ' + (entitlements.find(x => x.key === 'timber')?.balance ?? 0);
  }
  function setGamePaused(paused) { game.paused = paused; }
  function onVerified(result) {
    game.playerId = result.player_id; // Associate the game's profile with this player.
    playerToken = result.player_token; // Memory only; never a URL or global auth token.
    tokenExpiresAt = Date.parse(result.expires_at);
    replaceInventoryInYourGame(result.entitlements); // Already verified by Glitch.
    say('Account connected. Your current inventory is ready.');
  }
  function playerOptions() {
    if (!playerToken || Date.now() >= tokenExpiresAt) {
      throw new Error('Player authentication is required; restore needs an active purchase.');
    }
    return { playerToken }; // Per-request token; never choose a user_id.
  }
  function showError(error) {
    const code = error?.response?.data?.code ?? error?.code ?? error?.response?.data?.message;
    const noRestore = code === 'no_purchases_to_restore'
      || error?.response?.data?.message === 'No active purchases to restore for this game/account/environment.';
    say(noRestore
      ? 'No active purchases to restore. Refunded receipt history still belongs to this account, but no new game token or items can be granted here.'
      : 'Not completed. Retry the same action. If sign-in expired, authenticate again; restore requires an active purchase.');
  }
  async function openShop(restore) {
    if (opening || overlay) return;
    opening = true;
    try {
      const context = { return_origin: window.location.origin,
        nonce: createMicrotransactionNonce(), environment };
      const response = restore
        ? await api.createRestoreSession(titleId, context)
        : await api.createCheckoutSession(titleId, { ...context, product_id: productId,
          quantity: 1, country: 'US', currency: 'USD', channel: 'web' });
      const open = restore ? openMicrotransactionRestoreOverlay : openMicrotransactionOverlay;
      overlay = open({ titleId, checkoutOrigin, session: response.data.data,
        allowLocalDevelopment, onVerified,
        onOpen: () => setGamePaused(true),
        onClose: () => { overlay = null; setGamePaused(false); },
        onOrderUpdate: order => say(order ? 'Receipt: ' + order.payment_status : 'No completed receipt yet.'),
        onError: showError });
    } finally { opening = false; }
  }
  async function showMyPurchases(page = 1) {
    const response = await api.listMyPurchases(titleId,
      { environment, page, per_page: 20 }, playerOptions());
    const data = response.data.data;
    history.textContent = data.purchases.map(purchase => {
      const name = purchase.product.name ?? purchase.product.sku ?? ('Purchase ' + purchase.id);
      return name + '\\n' + purchase.grant_usage.map(row => row.key + ': ' + row.usage_status
        + '; promised ' + row.purchased_quantity + ', granted ' + row.granted_quantity
        + ', consumed ' + row.consumed_quantity + ', usable ' + row.usable_quantity).join('\\n');
    }).join('\\n\\n') || 'No captured purchases yet.';
    say('History page ' + data.pagination.page + ' of ' + data.pagination.last_page);
  }
  async function useTenTimber() {
    if (spending || game.paused) return;
    const options = playerOptions();
    if (pendingUse && pendingUse.playerId !== game.playerId) {
      throw new Error('Restore the original account before retrying its pending action.');
    }
    // Create ONCE for this gameplay intent. A failed retry keeps this same object.
    pendingUse ??= { playerId: game.playerId, action_id: createMicrotransactionNonce(),
      key: 'timber', quantity: 10 };
    spending = true;
    try {
      await api.consume(titleId, { key: pendingUse.key, quantity: pendingUse.quantity,
        action_id: pendingUse.action_id, environment }, options);
      const current = await api.listEntitlements(titleId, { environment }, options);
      replaceInventoryInYourGame(current.data.data.entitlements);
      pendingUse = null; // Clear only after successful acknowledgement AND refresh.
      say('10 Timber spent once. Inventory refreshed from Glitch.');
    } finally { spending = false; } // Do not clear pendingUse on failure.
  }
  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button'; element.textContent = label;
    element.onclick = () => void action().catch(showError);
    shop.append(element);
  }
  replaceInventoryInYourGame([]);
  button('Buy 100 Timber', () => openShop(false));
  button('Restore purchases', () => openShop(true));
  button('My purchases', () => showMyPurchases());
  button('Use 10 Timber', useTenTimber); // Explicit gameplay action, NOT a purchase callback.
  return game;
}
\`\`\`

replaceInventoryInYourGame and setGamePaused are explicitly named example GAME functions, not Glitch SDK APIs. Their demo bodies update a displayed Timber count and the returned game object. Adapt those bodies to the real engine's inventory assignment and pause/input/audio controls. Never use += productQuantity: verified callbacks can repeat during close, restore or refresh. Purchase callbacks must not call consume.

An expired scoped token requires authentication. Restore issues a new game token only if an eligible active purchase remains; an account with only fully refunded items may receive no_purchases_to_restore. Show that state clearly. Its owner JWT in a Glitch-authenticated context can still read all captured history, as can an existing valid scoped token, but do not promise universal token renewal, broaden paid-item handoff, expose the account JWT, repurchase for history access or invent a read-only-authsession API.

Use 10 Timber is an explicit separate gameplay operation. pendingUse is created once and retained across failed retries; a failed refresh after consumption also keeps the same action_id. Clear the intent only after successful consume acknowledgement AND an authoritative inventory refresh. For page-reload recovery retain only that nonsecret intent/account binding in the game's durable command queue, never the player token, and retry the same ID after sign-in. Coordinate actual building creation idempotently with that action; the demo spends resources only.

## Runtime player history is not developer impersonation

Glitch.api.Microtransactions.listMyPurchases(titleId,{environment,page,per_page},{playerToken}) calls GET /titles/{title_id}/microtransactions/me/purchases. A normal user JWT selects that same user. A gl_player token selects its bound title/player/environment and requires the exact approved game Origin. The endpoint rejects MCP/install tokens and caller user_id/player_id; a developer commerce:read token does not impersonate a player. Existing admin listOrders remains a separate permissioned reporting API. Do not add an arbitrary-player MCP tool for this runtime query.

JWT environment defaults to live; scoped credentials default to their bound environment. page defaults to 1 and is bounded 1–10000; per_page defaults to 20 and is bounded 1–100. Ordering is created_at DESC,id DESC. No cursor, product filter, community_id or identity selector is accepted. Response data is {title_id,player_id,environment,purchases,pagination:{page,per_page,total,last_page,has_more_pages}}.

Each captured purchase includes the Order DTO, required player_id, product snapshot {id,sku,name,type,version}, grant_usage, has_consumed_grants and has_usable_grants. Legacy snapshot sku/name/type/version may be null: display the purchase ID rather than inventing a current catalog value. Captured purchases remain after refund/dispute/quarantine; unpaid attempts are excluded.

Each grant_usage row contains grant_id (nullable), key, kind, purchased_quantity, granted_quantity, acquired_quantity, remaining_quantity, consumed_quantity, revoked_quantity, refunded_quantity, unrecoverable_quantity, expires_at, expired, usable_quantity, is_used and usage_status. purchased_quantity is promised frozen grant quantity times order quantity. granted_quantity and acquired_quantity are actual grants; no lot means grant_id:null and actual granted/remaining/consumed zero even if promised quantity is positive. History is not permission to create missing grants.

Consumed = acquired - remaining - revoked. Refunded is bounded revoked + unrecoverable; unrecoverable overlaps consumed and must not be subtracted twice. A refund is not gameplay use. Durable/pass is_used is null, never a guessed used flag: inspect usable_quantity and expired. Statuses are unused, partially_used, used_up, owned, expired, revoked, not_delivered and unavailable. Use listEntitlements for current aggregate inventory; use listMyPurchases for history/lot usage; consume is an explicit state change, not a history read.

An iframe ready message, direct API capture or this example's unit tests do not prove browser 3DS completion. Keep actual browser challenge verification separate and pending until observed.
`;
