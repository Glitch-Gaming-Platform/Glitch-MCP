---
description: Push a game build to itch.io, Amazon, Meta Quest, Instant Games, Steam and other stores with Glitch.
argument-hint: [title_id] [stores or request]
---

Use Glitch MCP to distribute this game to stores.

Optional arguments I provided: $ARGUMENTS

Start with `glitch_get_distribution`, then `glitch_list_distribution_platforms` for the stores I want. Explain each store's automation level in plain language: full (Glitch pushes), upload_only (Glitch uploads, I finish the release in the store console), handoff (I run a generated command), manual (Glitch only tracks the release). Keep the response short.

To connect a store, ask me for the credential fields the catalog lists. Credentials are write-only: Glitch stores them encrypted and never returns them. Never invent, log or repeat them. Call `glitch_connect_distribution_store` with `confirm=true` only after I approve.

For the build: reuse a ready artifact from `glitch_list_distribution_artifacts`; turn a ready HTML5 build into a web zip with `glitch_prepare_distribution_artifact_from_build`; or upload a local APK, AAB, OBB or zip (up to 5 GB) with `glitch_upload_distribution_artifact`. Fix every inspection error before submitting.

Always run `glitch_submit_distribution` as a dry run first and show me the result. A real push (`dry_run=false`, `confirm=true`) is public and may start store review; do it only after I approve that exact store, channel and version. Poll `glitch_get_distribution_submission`. When it is `needs_action`, show me the handoff actions. Run commands such as butler, ovr-platform-util or steamcmd only with my approval; I set any environment variable values from my store account myself. Then call `glitch_report_distribution_result` with the outcome and CLI output (no secrets).

Store limits: Google Play publishes with my own service account only after I tick the policy acknowledgement (Google's API policy forbids third-party publishing services, so the risk to my Play account is mine); mark Play releases live once Publishing overview shows them live. Steam is a steamcmd handoff and Glitch never sets the default branch live. Amazon takes APKs only and will not commit an edit left open in its console unless I allow `options.reuse_open_edit`. Meta Quest needs an age group or Meta saves a draft. Instant Games zips need index.html and fbapp-config.json at the root; itch.io HTML5 zips need index.html at the root.

Keep store distribution separate from Glitch Hosting when reporting releases and revenue.
