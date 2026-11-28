# Glitch public OpenAI plugin

This directory is the source of the public ChatGPT/Codex submission package. The stable package ID is glitch-mcp; the display name is Glitch. Uses hosted OAuth with CIMD preference and DCR fallback, scope mcp:use. No secret is bundled.

Build: from this directory, run `zip -X ../../../glitch-openai.zip plugin.json mcp.json assets/glitch.png` (or choose a separate output path).

Before submission:
- Set the portal's current public challenge in the production backend environment and verify the domain. Do not put challenge values in this repository.
- Connect through the developer portal and scan live tools. Compare the catalog against the declared review cases.
- Run the five positive and three negative cases using a dedicated sample account, with no real creator outreach or production data.
- Enter reviewer sign-in details privately in the portal; provide a reviewer-accessible walkthrough recording and certify only verified requirements.
- Upload each changed package version to the existing listing. Do not create duplicate listings.

Review test cases are illustrative until validated on the live deployed catalog.
