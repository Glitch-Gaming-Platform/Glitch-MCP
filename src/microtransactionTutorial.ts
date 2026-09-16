/** Beginner runtime tutorial mirrored from the SDK guide; no credentials or user impersonation tools. */
export const MICROTRANSACTION_CALLBACK_TUTORIAL = `# Beginner callback: make the purchase work in the running game

Minimum SDK for this player-runtime tutorial is 3.15.0. Check usable published package versions independently when implementing client code; 3.15.0 is published. New administrative direct-management wrappers use the major4.0 contract. MCP server-side catalog/provider configuration does not require installing or publishing either SDK version, so perform authorized server setup without waiting on runtime package work. A reviewed local package is for local verification, not proof of publication.

Authorized MCP settings/catalog tools manage the game directly without an extra confirmation/approval workflow. The optional browser revenue switches are on Pricing/monetization; the Microtransactions page manages catalog, required fields, Media and integration. Required product fields are SKU*, Name*, Type*, Prices* and Grants*; each price needs currency/country/integer minor units, each grant key/quantity/kind, and pass grants require duration_seconds.

For 100 Timber spent constructing things, use that title's actual consumable key. Keys are title-scoped, not globally reserved: another game may already use timber as consumable. Pass that exact key. The starter requires an explicit key of 1–100 letters, numbers, underscores, dots or hyphens; namespacing is optional. Validate its canonical kind from the title's catalog and server-verified inventory, not the display name. Preserve the per-title key/kind invariant and never convert durable ownership.

WOTW-specific migration proposal: WOTW (title ID prefix ad467, abbreviated) already has durable timber. For that title, coordinate a new consumable key and game-resource mapping; a new SKU cannot retype its existing key. wotw.resource.timber is one possible new key, not an existing catalog fact or a global naming rule. This proposal does not create/publish products or prices or authorize a catalog mutation. It does not restrict other titles' consumable keys.

The following complete browser-module example creates a small shop UI and defines every game helper it calls. Call installTimberShop with the real titleId, productId, apiBaseUrl, checkoutOrigin, exact approved gameOrigin and actual consumable timberGrantKey from that title's catalog. Hosted sandbox testing requires HTTPS endpoints. HTTP loopback and allowLocalDevelopment:true require an explicitly configured local/testing backend; sandbox alone does not permit HTTP against hosted services. A path is not an origin boundary: shared S3/CDN hosts with different game paths share an origin. Use a separately approved per-game hostname, not an expanded allowlist. Never put provider secrets, a developer/MCP token or an account JWT in these options.

A fresh SDK has no default auth. Config.setAuthToken and Requests.setAuthToken set shared global Authorization that Requests.processRoute inherits even on guest catalog/createCheckoutSession/createRestoreSession. playerToken overrides it per request; checkoutToken adds X-Checkout-Token without removing global auth. Keep guest commerce contexts credential-free; do not clear another context's auth, change credentials or inject an admin JWT to fix 401. SDK3.15.0 adds selected community_id as a query (except self-history); SDK4 excludes community context for commerce. Preserve account auth inside the hosted page and scoped player tokens per request. The backend fix is on limited guest entry, not quote/pay/inventory/finance authorization.

Administrative/developer credentials, MCP tokens and provider secrets must never ship in a game. Existing supported install-purpose runtime tokens are separate: use them only for their documented install, validation, heartbeat and telemetry endpoints, never commerce authentication or paid ownership. Do not inject them into the guest commerce context. These commerce instructions do not require removing an unrelated allowed runtime token or changing global SDK auth; preserve the game's supported install/validation/heartbeat integration.

The SDK validates the actual iframe origin/source/title/session/nonce, redeems the one-time claim at Glitch, then invokes onVerified. The callback sets the game's player profile ID, retains only the short-lived player token in memory and REPLACES inventory from the verified server result. A message, product quantity, ready notification or checkout close cannot independently grant anything.

\`\`\`js
import Glitch, {
  createMicrotransactionNonce,
  openMicrotransactionOverlay,
  openMicrotransactionRestoreOverlay,
} from 'glitch-javascript-sdk';

export function installTimberShop({ titleId, productId, apiBaseUrl, checkoutOrigin, gameOrigin, timberGrantKey,
  environment = 'sandbox', allowLocalDevelopment = false }) {
  if (new URL(gameOrigin).origin !== gameOrigin || window.location.origin !== gameOrigin) {
    throw new Error('Open the game on its exact approved gameOrigin; a path is not an origin.');
  }
  if (typeof timberGrantKey !== 'string' || timberGrantKey.length < 1 || timberGrantKey.length > 100
      || /[^A-Za-z0-9_.-]/.test(timberGrantKey)) {
    throw new Error('Supply an explicit grant key: 1–100 letters, numbers, underscores, dots or hyphens.');
  }
  // This game bundle must not configure global account/admin/MCP auth.
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
    const resource = entitlements.find(x => x.key === timberGrantKey);
    if (resource && resource.kind !== 'consumable') throw new Error('Timber grant kind mismatch.');
    game.inventory = entitlements; // REPLACE the snapshot. Never add 100 here.
    timber.textContent = 'Timber: ' + (resource?.balance ?? 0);
  }
  function setGamePaused(paused) { game.paused = paused; }
  function onVerified(result) {
    replaceInventoryInYourGame(result.entitlements); // Validate canonical kind before accepting this account.
    game.playerId = result.player_id; // Associate the game's profile with this player.
    playerToken = result.player_token; // Memory only; never a URL or global auth token.
    tokenExpiresAt = Date.parse(result.expires_at);
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
      const context = { return_origin: gameOrigin,
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
    const resource = game.inventory.find(x => x.key === timberGrantKey);
    if (!resource || resource.kind !== 'consumable') throw new Error('A verified consumable grant is required.');
    if (pendingUse && pendingUse.playerId !== game.playerId) {
      throw new Error('Restore the original account before retrying its pending action.');
    }
    // Create ONCE for this gameplay intent. A failed retry keeps this same object.
    pendingUse ??= { playerId: game.playerId, action_id: createMicrotransactionNonce(),
      key: timberGrantKey, quantity: 10 };
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

Pass timberGrantKey:'timber' when that title's canonical timber is consumable. The starter checks the returned entitlement kind before accepting an account or spending; backend validation remains authoritative. It never changes a grant kind.

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
