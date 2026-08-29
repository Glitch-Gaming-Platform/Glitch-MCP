---
description: Deploy a game build to Glitch Hosting.
---

Use Glitch MCP tool `glitch_deploy_hosting_build` to deploy this game as an independent hosted website.

Call `glitch_list_deployments` first and reuse a compatible processing or ready build. If the build is processing, preserve its id and pass that id to `glitch_deploy_hosting_build`; the tool waits for it to become ready. Never call `glitch_update_deployment_status` with `ready` while processing—Glitch returns HTTP 400. If the client restarts, list deployments and resume the same build id instead of re-uploading the unchanged artifact.

No developer-authored smoke-test suite is required. Glitch runs mandatory deployment-type acceptance gates that build variables cannot disable. While waiting, report `processing_stage`; on failure, report the build id, `error_code`, `failure_stage`, `retryable`, `error_message`, and `remediation`.

If this browser surface is embedded in the Glitch Store, verify Aegis bridge ownership. Glitch automatically patches exact static HTML/HTM entries and discovered standard Pixel Streaming `player.html`/`player.htm` pages. Node/SSR, streamed-native/noVNC, generic container, non-HTML static, and custom Pixel Streaming frontends must add `<script src="https://api.glitch.fun/js/aegis-bridge.js" defer></script>` once to their real browser layout. A Hosting-only page does not need the Store parent bridge unless the same surface is also Store-embedded.

If no compatible build exists and the build is only available locally, call `glitch_deploy_game_build` once and persist the returned build id.

Before either upload tool is called, inspect the actual production output and ZIP root—not only the source tree. Classify it as a static browser build, executable server build, streamed/native build, or container build. Prove the exact relative entry path:

- Use `index.html` only when that exact file exists at the declared artifact path and is the real browser bootstrap.
- For a server build, use the executable production module that binds the platform `PORT` and starts the server.
- Treat `package.json` as metadata, not an entry. Stop instead of guessing.
- For a container, inspect and test the effective Docker `ENTRYPOINT` and `CMD` and ensure they start the same verified runtime.
- For a Node build, include `package.json`, the executable production entry, and a production `Dockerfile` in the same build context. Put `Dockerfile` at the ZIP root by default; otherwise pass exact `build_context` and `dockerfile` paths.
- Bind Node to `0.0.0.0` and align one explicit port across application `PORT`, Dockerfile `EXPOSE`, and `custom_variables.target_port`. Use `HOST=0.0.0.0`, `PORT=3000`, `EXPOSE 3000`, and `target_port=3000` unless another port is proven end to end.

Run the selected entry in a clean Linux environment or the exact production container. Verify health/readiness, the root document, all hashed JS/CSS/image/font/WASM/worker/data requests, and browser console output. Render the main menu and reach the first interactive game screen. For static Distribution builds, also test from `/titles/<TITLE_ID>/builds/<BUILD_ID>/` and reject root-absolute `/assets/*` references. State why the entry is correct, where it exists in the artifact, the exact run command, and what passed.

Use an existing hosting site when I identify one. If no site exists, ask me for a short website name and address slug. Never guess when multiple sites exist.

Set `confirm=true` only after I explicitly approve creating the release. Publish only when I ask to go live; otherwise set `publish=false`.

After deployment, verify the final public HTTPS URL—not only build status—and report the public URL, build id, hosting release id, entry path, exact run command, and whether it is active. `ready` is not live. If publish fails, keep the same ready release and report Glitch's actionable message and incident reference; do not create a duplicate. Make clear that Hosting and Glitch Store distribution remain separate.
