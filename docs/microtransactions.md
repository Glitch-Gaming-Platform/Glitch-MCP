# Direct microtransaction management through MCP

Authorized title-scoped commerce operations execute directly. There is no custom
confirmation, human-review, proposal/approval/resume workflow. Legacy `confirm`
is optional and ignored. Authentication, current title membership, abilities,
input validation, immutable financial/inventory records and factual external
provider availability remain mandatory. Writes are truthfully annotated as
mutations; do not label them read-only to bypass a host's own controls.

Start with `glitch_get_microtransaction_capabilities` and
`glitch://microtransactions/setup`. The same authenticated catalog is available at
`glitch://titles/{title_id}/microtransactions/capabilities`. Each operation has
`input_schema`, examples, required `ability`, `http_method`, `mutates` and output
description; both custom approval flags are false.

**Server setup does not wait for a game SDK.** Use MCP now to configure the
catalog/providers/settings supported by the server. Existing game checkout and
own-player history use SDK3.15+, which is published. New administrative wrappers
use SDK4.0's breaking contract (required refund keys and factual Provider DTO).
Check current usable public versions independently before recommending an SDK
install. An unpublished local candidate is for explicitly approved local QA, not
proof of public publication or a reason to stop server-side configuration.

## Guest runtime and supported testing

The local backend guest-entry change is limited to catalog, checkout-session creation
and restore-session creation. Hosted sandbox tests require the exact approved
HTTPS `gameOrigin`, with session `return_origin` equal to the browser `Origin`.
Sandbox catalog/checkout require enabled sandbox settings. Historical restore
entry can remain available with commerce off but still binds to the owning account.
Quote/pay/inventory/finance remain authenticated; anonymous entry is not ownership.
No hosted backend deployment was performed for this update; verify the target
backend's deployed contract before relying on the change.

HTTP loopback requires an explicitly configured **local/testing backend** and
approved local origins. `environment:sandbox` and `allowLocalDevelopment:true` do
not relax the hosted backend's policy. Browsers supply Origin; use the actual
`window.location.origin`, not a spoofed header or page URL. A path is not an origin
boundary: shared S3/CDN game paths share an origin. Use separately approved
per-game hostnames; do not broaden allowlists as a workaround.

Fresh SDK contexts have no default auth. `Config.setAuthToken` and
`Requests.setAuthToken` cause `Requests.processRoute` to inherit global
Authorization, including on guest entry. `playerToken` overrides per request;
`checkoutToken` adds `X-Checkout-Token` without removing global account auth.
SDK3.15.0 also injects selected `community_id` as a query (not a body field), except
on self-history. SDK4 excludes commerce community context. Neither implementation
changes stored auth/context. Keep guest commerce contexts credential-free, hosted account
auth inside Glitch and scoped player credentials per request. Never fix a guest
401 by adding an admin JWT or clearing another context's global auth.

Administrative/developer credentials, MCP tokens and provider secrets must never
ship in a game. Existing supported install-purpose runtime tokens are separate:
use them only for their documented install, validation, heartbeat and telemetry
endpoints, never commerce authentication or paid ownership. Do not inject an
install-purpose token into guest commerce. These instructions do not require
removing an unrelated allowed runtime token or changing global SDK auth; preserve
the game's supported install/validation/heartbeat integration.

Tool availability is not credential scope. A missing-ability 403 from a connected
MCP credential is separate from guest-entry 401. Preserve its status/code and check
the effective connection's credential abilities. Do not change global connector credentials,
providers or permissions in response to tool discovery.

### Readiness is not a completed transaction

`ready` and optional `configuration_ready` retain configuration semantics.
Optional `readiness.integration_verified` means stored sandbox paid + fulfilled +
claimed evidence. Absent means unknown on older backends; do not synthesize it
from ready/configuration or treat absence as false. This evidence is not
browser/3DS certification and does not prove that a new order is delivered.
Record actual payment, fulfillment, claim and browser challenge evidence
separately. Tests of DTO forwarding do not prove backend deployment or purchases.

### Use the actual title's consumable key

Keys are title-scoped, not globally reserved. Another game may already use
consumable `timber` and should pass that exact key to the generic starter.
`timberGrantKey` must be explicit and follow the existing 1–100 character
alphanumeric/underscore/dot/hyphen grammar; namespacing is optional. Validate the
canonical kind from that title's catalog and server-verified inventory. The starter
rejects durable rows for the selected spendable resource; it never converts
ownership. Preserve the per-title key/kind invariant, order snapshots and inventory.

**WOTW-specific migration proposal:** WOTW (title ID prefix `ad467`, abbreviated)
already has durable `timber`. For that title, coordinate a new consumable key and
game-resource mapping; a new SKU cannot retype its existing key.
`wotw.resource.timber` is one possible new key, not an existing catalog fact or a
global naming rule. This proposal does not create/publish products or prices or
authorize a catalog mutation. Other titles may use their own existing consumable keys.

## Complete tool surface

Every operation is beneath `/mcp/v1/titles/{title_id}/microtransactions`.
Operation responses are `{data:{operation,result}}`; tools render structured and
human-readable results. Empty/malformed success envelopes are errors, not success.

| Tool | Operation | Ability | Effect |
| --- | --- | --- | --- |
| glitch_get_microtransaction_capabilities | GET capabilities | commerce:read | Read schemas/facts |
| glitch_get_microtransaction_settings | settings.get | commerce:read | Read |
| glitch_update_microtransaction_settings | settings.update | commerce:write | Write |
| glitch_list_microtransaction_products | products.list | commerce:read | Read |
| glitch_create_microtransaction_product | products.create | commerce:write | Create |
| glitch_update_microtransaction_product | products.update | commerce:write | Update/publish future catalog |
| glitch_archive_microtransaction_product | products.archive | commerce:write | Archive, not delete history |
| glitch_list_microtransaction_providers | providers.list | commerce:read | Read provider facts |
| glitch_update_microtransaction_provider | providers.update | commerce:finance | Configure title route |
| glitch_refresh_microtransaction_provider | providers.refresh | commerce:read | POST, refresh cached facts |
| glitch_create_microtransaction_provider_onboarding | providers.onboarding | commerce:finance | Owned Stripe onboarding |
| glitch_get_microtransaction_delivery_settings | delivery.settings.get | commerce:read | Read public verification config |
| glitch_update_microtransaction_delivery_settings | delivery.settings.update | commerce:fulfill | Configure URL/enabled |
| glitch_get_microtransaction_readiness | readiness.get | commerce:read | Read real blockers |
| glitch_list_microtransaction_orders | orders.list | commerce:read | Paginated order discovery |
| glitch_get_microtransaction_order | orders.get | commerce:read | Order/detail, role-redacted |
| glitch_reconcile_microtransaction_order | orders.reconcile | commerce:finance | Original-provider reconciliation |
| glitch_get_microtransaction_earnings | earnings.get | commerce:finance | Read financial state |
| glitch_list_microtransaction_refunds | refunds.list | commerce:finance | Paginated refund discovery |
| glitch_get_microtransaction_refund | refunds.get | commerce:finance | Read one refund |
| glitch_refund_microtransaction_order | refunds.create | commerce:finance | Execute idempotent refund |
| glitch_request_microtransaction_refund | refunds.request | commerce:finance | Compatibility alias; EXECUTES |
| glitch_reconcile_microtransaction_refund | refunds.reconcile | commerce:finance | Recover same operation/key |
| glitch_list_microtransaction_deliveries | deliveries.list | commerce:read | Paginated event discovery |
| glitch_replay_microtransaction_delivery | deliveries.replay | commerce:fulfill | Replay existing event |
| glitch_acknowledge_microtransaction_delivery | deliveries.acknowledge | commerce:fulfill | Acknowledge durable handling |
| glitch_list_microtransaction_payouts | payouts.list | commerce:finance | Paginated transfer/bank facts |
| glitch_get_microtransaction_integration | integration.get | commerce:read | Actual title/SKU instructions |
| glitch_verify_microtransaction_integration | integration.verify | commerce:write | Verify real sandbox evidence |
| glitch_upload_microtransaction_media | POST media | commerce:write | Title-owned Media upload |

A title token never escapes its title even when its creator owns another game.
Read-only credentials cannot perform writes or financial actions. No runtime
install token or arbitrary-player impersonation is accepted.

## Provider configuration and factual readiness

Use configured platform Stripe/Xsolla credentials; do not ask for or send platform
API keys. Provider output distinguishes:

- `configured` from `available`, plus enabled/priority/regions/currencies/minima;
- `account`: platform processing account facts;
- `payout_account`: the game's owned payout target, availability and requirements;
- tax status/missing fields, payment methods, reasons and checked time.

Never label the game's payouts ready because the platform account has payouts
enabled. No developer-writable `approved` or `available` field exists.

Provider update requires environment and supports enabled, priority0–100,
countries, supported currencies, integer minimum amounts, tax mode/code, owned
payout source, Xsolla project ID and SKU map. Minimums cannot lower provider
floors. Tax disabled is sandbox-only. Save preferences even while external setup
is incomplete, then refresh real facts and report actionable reasons. A global
sales emergency switch can block new sales without blocking configuration or
historical refunds.

For Stripe onboarding, provide country/environment and one stable
`idempotency_key`. The server reuses or creates a title/environment-owned account,
never a caller-selected payee ID. Response includes `onboarding_url`,
`account_id`, expiry, `status:requires_provider_onboarding` and `reused`.
A retry may issue a fresh single-use link for the SAME account. Do not log/store
that link; only the expected HTTPS connect.stripe.com provider origin is valid.
External KYC/account requirements are real provider prerequisites, not Glitch
human-approval gates.

A NEW owned title/environment Xsolla project may accept a write-only
`webhook_secret` (16–512 characters) under commerce:finance. This is not a platform
Stripe/Xsolla API key, MCP token, or game-runtime credential. Use protected input,
not a raw secret JSON editor or logs. Server storage is encrypted; the value is
never returned/audited, and existing platform/historical bindings cannot be
overwritten. Do not invent a placeholder secret or pretend missing global
Xsolla credentials/project verification is available.

The legacy `settings.update.webhook_url` alias needs **both commerce:write and
commerce:fulfill**. Prefer `delivery.settings.get/update` as authoritative delivery
configuration; a write-only catalog credential cannot change delivery URLs.

## Catalog and revenue

MCP can update the game's authorized revenue settings directly. The optional
browser switches Enable in-game purchases and Show ads remain on Pricing, not
the Microtransactions page. At least one valid revenue model must remain for
public games; an outage must not silently re-enable ads.

Required product fields are SKU*, Name*, Type*, Prices* and Grants*. Money uses
integer minor units; commission is1200bp of discounted pre-tax subtotal, provider
costs separate. A 100-Timber building resource is currency/consumable with
`{key:'timber',quantity:100,kind:'consumable'}`, not durable ownership. Durable
quantity is one; pass grants have bounded server-side duration. Historical orders
and grants remain immutable even as future catalog versions change.

`products.list` supports `page` (1–10000), `per_page` (1–200, default 200), optional
`status` (draft/active/archived), and exact `sku`. Responses retain `products` and
add `pagination:{page,per_page,total,last_page,has_more_pages}`. Follow all pages
or query the exact SKU before declaring a product absent or retrying an uncertain
create. Products sort by created_at DESC, id DESC. This 200-record default differs
from orders/refunds/deliveries/payouts (25, maximum 100) and own-player purchase
history (20, maximum 100).

Uploads reuse the existing Media pipeline and trusted title/actor ownership.
No scheduler/social post is created. Attach same-title Media IDs, not arbitrary
URLs or unowned IDs. Read existing products before retrying an uncertain create;
name-only updates must not reset omitted status/media/prices/defaults.

## Orders, refunds and delivery recovery

Administrative lists use page1–10000, per_page1–100(default25), returning
`pagination:{page,per_page,total,last_page,has_more_pages}`. Orders support
environment/payment_status (status alias)/product_id. Refund/delivery/payout lists
support environment/order_id/status. Get IDs from these lists rather than inventing
them. Player receipt `getOrder` remains available under own-player authentication;
management relationships may be absent or redacted without finance permission.

Refund execution requires one caller-created intent and stable key:

```json
{
  "order_id": "<existing-order-uuid>",
  "reason": "Customer refund",
  "amount_minor": 199,
  "idempotency_key": "<one-key-created-once-for-this-refund-intent>"
}
```

Call `glitch_refund_microtransaction_order` with this same object on retry.
Never generate another key in a catch/retry loop. Same key + changed input is409.
If the first response is lost, list refunds for the order and locate its stored
idempotency key, then get/reconcile that operation. Do not create a second refund
while the original is unknown. Partial amounts are bounded by remaining capture
and allocated pro rata across grants.

Refund request records are not execution proof. A request can be linked through
`execution_refund_id`; use record_type, execution_status, request_resolution,
order_refunded_minor and failure_code. `linked`, pending or unknown do not mean
the customer's money was returned. Query the original provider through
orders.reconcile/refunds.reconcile; never switch an old refund to another provider.
Transfers are not automatically bank-paid payouts.

Delivery replay preserves immutable event/grant identity. Acknowledge only after
durable handling, not on an arbitrary browser callback or payment-success guess.

## Complete Ed25519 receiver example

Read `glitch://microtransactions/delivery-receiver` or
[the runnable Node24+ receiver](../examples/commerce-delivery-receiver.mjs).
Core MCP still supports Node20; only this standalone SQLite example needs Node24+.

Get public configuration from authenticated delivery.settings.get and pin
title/environment, key_id and verification_public_key out of band. Never use a
public key supplied in a message/header. Managed signatures are:

- X-Glitch-Signature-Algorithm: ed25519;
- X-Glitch-Key-Id: configured UUID;
- X-Glitch-Timestamp: ASCII UNIX seconds, accepted within300 seconds;
- X-Glitch-Event-Id: the same UUID as JSON body.id;
- X-Glitch-Signature: base64 raw64-byte detached signature;
- verification_public_key: base64 raw32-byte public key;
- signed bytes: timestamp + "." + the EXACT raw JSON request body.

The example verifies before parsing, checks body/header/title/environment/key
binding, and transactionally queues IDs in a persistent database. It returns2xx
`{event_id}` only after commit. Reopen/replay tests prove durable deduplication.
Retry bodies can include refreshed authoritative facts, so event identity—not
an unstable whole-payload hash—is deduped.

Do NOT increment items or replace aggregate balances from the embedded snapshot:
an old event from another order can arrive later. A worker/connected game uses
its actual authorized player session to refresh current listEntitlements, or a
real server adapter with monotonic inventory revisions. Never pass user_id with
a developer MCP token to impersonate that player. The sample deliberately stores
no embedded inventory or credentials. Legacy HMAC endpoints remain a separate
configured algorithm with original secrets unchanged; do not accept algorithm
downgrades based on untrusted headers.

## Player runtime is separate

The setup resource/prompt includes a complete beginner `onVerified` example.
The callback associates the player profile, retains the short-lived player token
only in memory, and replaces verified inventory. It never adds product quantity
or automatically consumes. Explicit consumption retains its action ID across
failures, and restore does not issue tokens for fully refunded-only accounts.

Game checkout stays in the in-game modal; no top navigation. Exact iframe
origin/source/session/nonce checks protect ready/close/claim messages. UI ready
does not prove payment or provider-frame usability. Keep browser3DS success/cancel
evidence separate from API tests.

Own-player history is `listMyPurchases`, not an arbitrary-player MCP tool. It is
self-authenticated, page-based, and distinguishes promised/granted/consumed/
refunded/expired units; durable/pass is_used is null. Existing valid player tokens
or the owning account JWT in Glitch can read history; never expose account JWTs
to a game to bypass expired restore restrictions.

## Verification and development

Ordinary adapter tests use local protocol/HTTP fixtures. The opt-in
`microtransactions.local.e2e.test.ts` requires a separately verified isolated
PostgreSQL/loopback Laravel fixture, genuine full and read-only gl_mcp tokens,
and a real Stripe-test captured order for its financial test. Credentials are
runtime-only; normal npm test skips it. It proves no-confirm authorized writes,
read-only/cross-title denials, provider facts, ID discovery and stable refund keys.
It never targets normal browser/demo/production data.

After the backend test owner releases its isolated PostgreSQL window, have it
create the fixture and launch the isolated API. The test currently pins
`glitch_commerce_regression_20260914_01a0a11e`; never substitute the normal app DB.
The API must be `http://127.0.0.1:<nonstandard-port>/api` (HTTPS also works), with no
URL credentials/query/fragment. A caller-owned mode-0600 JSON file contains
`fixture_type:isolated-commerce-management`, `database`, `api_base_url`, `title_id`,
`other_title_id`, distinct `full_token`/`read_only_token` title MCP credentials,
a stable `run_id`, real Stripe-test `refund_order_id`, positive
`refund_amount_minor`, and a stable `refund_idempotency_key`. Optional fields are
`reconcile_order_id` and `media_id`. Never paste this JSON into task messages or
use a user JWT in place of an MCP credential.

```sh
npm run build
node scripts/test-microtransactions-local.mjs /absolute/private/fixture.json
```

The launcher reads only the private file into child-process memory; it does not
seed, migrate, reset, delete credentials, or touch the caller's shell environment.
The test also exercises page-two catalog discovery and exact SKU lookup. It keeps
the same real refund intent on repeat runs. Coordinate fixture cleanup with both
MCP testing and browser QA; test refund calls do not prove browser 3DS completion.

## Published baseline and independent checks

SDK `4.0.0` is a major administrative migration: required refund idempotency key,
factual provider DTO replacing `approved`, pagination, and no custom confirmation
workflow. Existing checkout/restore/self-history clients remain compatible.
Registry verification on September 16, 2026 confirmed SDK `3.15.0`, SDK `4.0.0`
and MCP `0.5.0` published. This supersedes the earlier same-day candidate-only
observation. SDK4/MCP0.5 management remains separate from guest player entry;
there is no SDK4 requirement merely to fix hosted sandbox 401. The additive
readiness and tutorial corrections are unreleased; local validation does not
establish hosted backend deployment.

The SDK regression command `npm run test:commerce-compat -- --published` fetches
the two pinned SDK tarballs from the public registry, verifies SHA-512 integrity,
and executes their unmodified bundles against an in-memory browser transport.
It checks guest bodies, auth/community inheritance, per-request credentials,
hosted-account binding and old/additive readiness responses; no Glitch/provider
requests or credentials are used. Published 3.15 CJS works, while its raw native
ESM entry has a legacy `require('crypto-js')` initialization dependency. The test
records that limitation and separately tests explicit CommonJS/bundler interop;
it does not claim bare script-module compatibility. SDK4 native ESM/CJS pass.

Before release, independently run SDK tests/typechecking, build, build-docs and
package exports; MCP lint/tests/build and commerce-contract parity; then the real
isolated Laravel stdio run when explicitly authorized. SDK build and build-docs
must succeed before updating package/lock versions for a release.
Publishing and updating a frontend registry dependency are separate authorized
release decisions; this SDK/MCP follow-up does neither.
Do not replace that order with a local SDK install or an unreviewed publish.

Run lint, the ordinary tests, build, and the backend capability parity audit after
the backend contract is ready. The parity audit compares real method/mutates
metadata, never infers read-only from removed confirmation gates. Only publish
reviewed artifacts; testing does not authorize production settings changes,
real-money charges, real emails or fabricated provider availability.
