import { COMMERCE_REST_STARTER_SOURCE } from "./commerceRestStarter.js";

/** REST-first tutorial; canonical factory is mirrored from the frontend AI export and parity-tested. */
export const MICROTRANSACTION_CALLBACK_TUTORIAL = `# Beginner callback: direct REST in the running game

Prefer direct REST API access. No npm package, SDK import or SDK version is required for this tutorial. The JavaScript SDK is optional, not removed from existing frontend implementations. Authorized MCP catalog/provider settings work independently of a runtime library or package publication. Start with current server schemas, not guessed payloads.

Sandbox proof is optional QA, not required to enable purchases or activate live sales. Authorized developers can use normal settings without a sandbox order or integration.verify call. Keep integration_verified truthful: false/absent is unverified/unknown, not a setup blocker; opt-in verification still requires real paid + fulfilled + claimed evidence. Actual provider/account/market/tax, revenue, payment and fulfillment rules remain enforced. This does not make a configuration save or browser message proof of purchased inventory.

Authorized commerce writes do not require a custom confirmation/approval workflow. Browser revenue switches remain on Pricing/monetization. Required product fields are SKU*, Name*, Type*, Prices* and Grants*; each price needs currency/country/integer minor units, each grant needs key/quantity/kind, and pass grants require duration_seconds. Commerce media uploads are commerce-only: reuse the processing pipeline but do not create title/game preview, gallery, cover or social imagery. Attach only same-title commerce Media IDs; upload generic/gallery/social assets separately via commerce, never relink them.

For Timber spent constructing things, use that title's actual consumable key in spendKey. Keys are title-scoped, not globally reserved; existing consumable timber is valid and namespacing is optional. Require 1–100 letters, numbers, underscores, dots or hyphens. Validate canonical kind from the catalog and authoritative inventory, not labels. Preserve the per-title key/kind invariant and never convert durable ownership.

WOTW-specific migration proposal: WOTW (title ID prefix ad467, abbreviated) already has durable timber. A distinct new consumable key and game-resource mapping such as wotw.resource.timber is a proposal for that title, not an existing catalog fact or global rule. This proposal does not create/publish products or prices or authorize a catalog mutation.

## Credentials, origins and guest entry

Use the configured API base ending in /api, exact title ID and trusted checkout origin. The real gameOrigin is window.location.origin and must be server-approved. Hosted sandbox testing requires HTTPS. HTTP loopback with allowLocalDevelopment:true additionally requires an explicitly configured local/testing backend; sandbox alone does not relax hosted policy. A path is not an origin boundary: shared S3/CDN game paths share an origin. Use a separately approved per-game hostname.

Guest GET /titles/{title_id}/microtransactions/catalog and POST checkout-sessions/restore-sessions need no bearer token. Native fetch uses credentials:'omit'; the browser supplies Origin automatically. Do not manually set that forbidden header in browser JavaScript (curl can for diagnostics). Sandbox catalog requires enabled sandbox settings and an exact allowed Origin. New checkout requires enabled matching environment and session return_origin equal to browser Origin. Restore ingress can remain after sales stop/environment changes; it does not authenticate ownership by itself. Quote/pay/inventory/finance remain authenticated. Do not add community_id or user_id/player_id.

Keep administrative/developer credentials, MCP tokens, provider secrets and account JWTs out of the game. Preserve existing unrelated install/validation/heartbeat credentials; they simply cannot authenticate commerce or paid ownership. Do not remove or temporarily change global authentication to make a guest request succeed. Missing MCP ability403 is different from guest401.

The hosted Glitch iframe handles account creation/login, bound account JWT, Stripe Embedded Checkout and 3DS. Game code never submits raw cards or calls account-only checkout/authenticate/reconcile/handoff methods. X-Checkout-Token grants only limited session status. For ownership, validate exact iframe.contentWindow, checkout origin, title/session/nonce and version before POST /handoffs/claim. One-use claim_code is not payment proof. Check response identity/expiry, then read own order and fresh entitlements with per-request Authorization using the returned title/player/environment token. Own receipt DTOs need not include player_id: identity comes from the verified claim and scoped token; validate the optional receipt field only when present, plus required order/title/environment/status.

Optional card saving is confined to that hosted form after the saved-card migration/backend rollout, for new marked orders only. The player opts in there; this game example never receives card data, customer IDs or payment methods. Saving is not permission for off-session/autopay: a returning purchase still requires user confirmation and may require 3DS. Reuse is limited to the same Glitch account/provider/processing account/environment; no cross-provider or sandbox/live sharing and no support promise for older deployments or other providers. This feature adds no game API or SDK dependency.

## Copyable complete browser starter

Copy the following dependency-free JavaScript into the game's browser code. It creates its own controls and modal. Configure real IDs/origins and the existing consumable spendKey. The verified callback is onInventory: it receives playerId and authoritative entitlements only after claim, own-order status/identity and inventory reads succeed. The short-lived player token remains private inside the factory's memory. Replace purchased inventory, never increment by product quantity or consume in a purchase callback.

The original game document/canvas/session stays mounted; no top-navigation fallback. Only the actual checkout iframe is trusted. Its sandbox permits payments and controlled verification popups, never top navigation. A bounded watchdog offers Retry/Close for the SAME session. Close waits for in-flight claim and inventory work. Ready/load/client completion/authorization/redirect never mean paid, fulfilled or browser3DS success.

\`\`\`js\n` + COMMERCE_REST_STARTER_SOURCE + `\n
const game = { playerId: null, purchasedInventory: [], paused: false };
// Example GAME adapters, not Glitch APIs. Replace these bodies with your engine's
// synchronous inventory assignment and pause/input/audio controls.
function replacePurchasedInventory({ playerId, entitlements }) {
  game.playerId = playerId;
  game.purchasedInventory = entitlements; // REPLACE; never += product quantity.
}
const shop = createGlitchRestShop({
  apiBase: 'https://YOUR_GLITCH_API_HOST/api',
  titleId: 'YOUR_TITLE_UUID',
  checkoutOrigin: 'https://YOUR_GLITCH_CHECKOUT_HOST',
  environment: 'sandbox', country: 'US', currency: 'USD',
  spendKey: 'YOUR_EXISTING_CONSUMABLE_GRANT_KEY',
  onInventory: replacePurchasedInventory,
  pauseGame: () => { game.paused = true; },
  resumeGame: () => { game.paused = false; },
});
// Call shop.destroy() only when intentionally disposing this game UI.
\`\`\`\n
The adapter functions above are named GAME functions, not SDK methods. Keep onInventory synchronous as required by this starter; its body assigns the verified snapshot to your engine. Do not mix paid inventory with freely edited cloud saves/earned progress. Pass spendKey:'timber' only when that title's canonical timber is consumable. A durable/pass key is not a spendable resource. The example never rewrites the catalog.

Unknown or delayed payment retains the original session/provider/order/idempotency intent; Resume and Reload do not create a replacement charge. A lost one-use claim response may need a fresh handoff in the same hosted frame or account restore, never optimistic inventory or blind code replay. Before claim, close can read checkout status only: it cannot refresh private inventory with a read-only capability. Restore opens POST /restore-sessions inside the same modal pattern, with a new pinned session/nonce and no account JWT in game.

An expired scoped token requires authentication. Restore issues a new token only if an eligible active purchase remains; fully refunded-only accounts may receive no_purchases_to_restore. Show that limitation clearly: do not promise universal token renewal, broaden paid-item handoff, expose the account JWT, repurchase for history access or invent a new authentication API. The owning account inside Glitch and an existing valid scoped token can still read captured history.

Use 1 unit is a separate explicit gameplay action, never a purchase callback. Create one action_id for an intent outside retry/catch; persist only the nonsecret action bound to title/player/environment/key, never tokens or balances. Reuse its exact ID/body after uncertain failure. A confirmed use with failed inventory refresh must not let another spend bypass authoritative refresh; retain the pending intent through recovery. Coordinate actual building creation idempotently with the same gameplay intent—the example demonstrates resource spending, not building creation.

## Runtime player history is not developer impersonation

GET /titles/{title_id}/microtransactions/me/purchases uses a normal owning JWT only inside Glitch, or the bound gl_player token with exact approved game Origin. It rejects MCP/install tokens and caller user_id/player_id. Developer commerce:read cannot impersonate a player; existing administrative orders remain a separate reporting API. Do not add an arbitrary-player MCP tool.

JWT environment defaults to live; scoped credentials default to the bound environment. Query environment/page/per_page only: page1–10000 defaults1, per_page1–100 defaults20. No cursor, product filter or community_id. Native fetch JSON has one data envelope: payload.data is {title_id,player_id,environment,purchases,pagination:{page,per_page,total,last_page,has_more_pages}}. Ordering is created_at DESC,id DESC.

Each captured purchase has the Order DTO, required player_id, product snapshot {id,sku,name,type,version}, grant_usage, has_consumed_grants and has_usable_grants. Legacy snapshot fields may be null: display a fallback, not a guessed current product. Captured purchases remain after refund/dispute/quarantine; unpaid attempts are excluded.

Each grant_usage row contains grant_id (nullable), key, kind, purchased_quantity, granted_quantity, acquired_quantity, remaining_quantity, consumed_quantity, revoked_quantity, refunded_quantity, unrecoverable_quantity, expires_at, expired, usable_quantity, is_used and usage_status. Purchased is the frozen promised quantity times order quantity. Granted/acquired are actual issued units; no lot means null grant_id and zero actual units even when promised quantity is positive. History cannot authorize missing grants.

Consumed = acquired - remaining - revoked. Refunded is bounded revoked + unrecoverable; unrecoverable overlaps consumed and must not be subtracted twice. Refund is not gameplay use. Durable/pass is_used is null; use usable_quantity and expired. Statuses: unused, partially_used, used_up, owned, expired, revoked, not_delivered, unavailable. GET entitlements is current aggregate inventory; GET me/purchases is history/lot usage; POST consume is an explicit state change.

An iframe ready message, direct API capture or these example unit tests do not prove browser3DS completion. Keep challenge success/cancel/failure verification separate until observed.
`;
