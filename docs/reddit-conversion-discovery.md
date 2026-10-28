# Reddit Ads conversion discovery through Glitch MCP

The read-only marketing operations **conversions.sources** and **conversions.actions** is available through
**glitch_marketing_operation**, with arguments (either operation name):

    {"scheduler_id":"<title-owned-scheduler-uuid>","platform":"reddit"}

First run **glitch_get_marketing_capabilities** to discover the operation.

The backend resolves the scheduler's connected Reddit Ads account and requests
**GET /api/v3/ad_accounts/{ad_account_id}/pixels** using its existing Ads OAuth
(requires the adsread scope). It returns actual provider pixel IDs, names,
statuses, which one is selected for the schedule, and the eight documented Reddit
standard conversion event types. It also returns locally configured custom
conversion names, without claiming they were accepted by Reddit. It refuses
a different ad account or a scheduler outside the selected title.

**Critical distinction:** Standard event types are *available* tracking types,
not remotely created Google-style conversion-action IDs and not proof that any
event was received or attributed. A saved pixel missing from the provider list
produces a warning. No OAuth or CAPI token, PII, or raw provider payload is
returned.

Related operations:
- **conversions.status**: which pixel and mapping fields exist, not secret values.
- **conversions.configure**: confirmed (confirm=true) updates of non-secret
  pixel IDs and conversion mappings. OAuth setup stays in the Glitch UI.
- **conversions.events** and **conversions.report**: Glitch's recorded events.
- The existing backend AdConversionService and ProcessRedditConversionEvents
  job send actual conversion events via Reddit CAPI. MCP does not generate
  fabricated conversion events to test delivery.

To verify delivery, check real events in Reddit Events Manager or an authorized
report. Pixel discovery uses the adsread scope. Sending requires adsconversions
or a suitable dedicated CAPI token. Successful discovery does not establish
that the connected token can send events.

The authenticated scheduler route
**GET /api/schedulers/{scheduler_id}/conversion-actions?platform=reddit**
returns this same pixel/event capability object. Other ad networks have
separate implementations and may still lack conversion discovery.

Tests cover the title ownership checks, OAuth validation, wrong-account
rejection, read-only provider calls, secret redaction, blank pixel lists,
the scheduler endpoint, and the MCP adapter.

**Rollout:** Publishing the backend and MCP adapter is required. Editing local
source code does not update deployed Glitch MCP tools.

For the unified Google, Meta, TikTok, Reddit and X Ads operation, see
[all-ad-platform conversion discovery](./ad-conversion-sources.md).
