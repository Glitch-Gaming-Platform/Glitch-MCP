# Ads conversion-source discovery across all supported providers

The read-only **glitch_marketing_operation** operation **conversions.sources**
(or compatible alias **conversions.actions**) requires a title-owned
**scheduler_id**, **platform**, and where necessary **account_id**. It uses the
existing provider OAuth configured through the Glitch dashboard. This operation
does NOT create ads, send conversion events, or change campaign budgets.

| Provider | platform | API model | Scheduler/account requirement |
| --- | --- | --- | --- |
| Google Ads | google | provider conversion actions (GAQL) | configured conversion customer and manager account |
| Meta/Facebook/Instagram | meta | Graph API ad-account pixels | explicit act_... ad account ID; social profile IDs are not accepted |
| TikTok Ads | tiktok | Business API advertiser pixel sources | saved TikTok Ads advertiser ID |
| Reddit Ads | reddit | Ads API ad-account pixels; standard/custom event mapping | saved Reddit Ads account ID, Ads OAuth |
| X/Twitter Ads | twitter (alias x) | Ads API website event tags | explicit X Ads account ID and Ads OAuth 1.0a |

Provider-native data is normalized to sources (the original Reddit pixels
and supported_standard_events fields are also retained). The returned
source_access_verified / pixel_access_verified field indicates whether the
saved default source appeared on the returned account page. It does not
verify event ingestion, matching, attribution, provider conversion-send
permissions, or real delivery. Unknown counts/values remain missing and do
not become zeros. The first page is returned where providers paginate; a
warning indicates possible additional pages (including Reddit).

Google uses conversion-action IDs, not pixel lists. Other networks each
have a different native source/event model. Always provide the actual Ads
account ID, never a user profile, social account or unrelated business ID.
Some provider permissions/developer access may need to be configured by
the advertiser before discovery succeeds. Google/TikTok credentials can
refresh using the existing scheduler refresh mechanisms.

**Read-only tests:** mocked HTTP route-contract tests for Meta, TikTok,
Reddit, X and mocked Google conversion actions; owner/title scope tests,
cross-account rejection, missing credentials, empty sources and secret
redaction. Real provider credentials, ingestion and production rollout are
**not** verified by these test fixtures.

**Rollout:** backend and Glitch MCP tool package must be released; local
code does not modify hosted MCP behavior.
