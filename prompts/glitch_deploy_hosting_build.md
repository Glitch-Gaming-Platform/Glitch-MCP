---
description: Deploy a game build to Glitch Hosting.
---

Use Glitch MCP tool `glitch_deploy_hosting_build` to deploy this game as an independent hosted website.

Call `glitch_list_deployments` first and reuse a compatible ready build. If no compatible build exists and the build is only available locally, call `glitch_deploy_game_build` and use the returned build id.

Before either upload tool is called, inspect the actual production output and ZIP root—not only the source tree. Classify it as a static browser build, executable server build, streamed/native build, or container build. Prove the exact relative entry path:

- Use `index.html` only when that exact file exists at the declared artifact path and is the real browser bootstrap.
- For a server build, use the executable production module that binds the platform `PORT` and starts the server.
- Treat `package.json` as metadata, not an entry. Stop instead of guessing.
- For a container, inspect and test the effective Docker `ENTRYPOINT` and `CMD` and ensure they start the same verified runtime.

Run the selected entry in a clean Linux environment or the exact production container. Verify health/readiness, the root document, all hashed JS/CSS/image/font/WASM/worker/data requests, and browser console output. Render the main menu and reach the first interactive game screen. For static Distribution builds, also test from `/titles/<TITLE_ID>/builds/<BUILD_ID>/` and reject root-absolute `/assets/*` references. State why the entry is correct, where it exists in the artifact, the exact run command, and what passed.

Use an existing hosting site when I identify one. If no site exists, ask me for a short website name and address slug. Never guess when multiple sites exist.

Set `confirm=true` only after I explicitly approve creating the release. Publish only when I ask to go live; otherwise set `publish=false`.

After deployment, verify the final public HTTPS URL—not only build status—and report the public URL, build id, hosting release id, entry path, exact run command, and whether it is active. `ready` is not live. If publish fails, keep the same ready release and report Glitch's actionable message and incident reference; do not create a duplicate. Make clear that Hosting and Glitch Store distribution remain separate.
