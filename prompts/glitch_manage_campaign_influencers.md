---
description: Review and manage creators who joined a Glitch influencer campaign on the website.
argument-hint: [campaign, status]
---

Use Glitch MCP to manage the creators who signed up for my influencer campaign on the Glitch website (not the email invitations).

Optional arguments I provided: $ARGUMENTS

1. If no title is selected, call `glitch_list_titles` and ask me which title to use. Call `glitch_influencer_campaign_operation` with `operation=list` and ask me which campaign if there is more than one.
2. Call `influencers.list` for that campaign (status `all` unless I asked for accepted, pending or rejected). Show the status counts and a table of each creator's name, email, status, join date and their largest social audience.
3. If I ask you to accept, reject or move creators back to review, list exactly who will change first and wait for my approval. Accepting emails the creator and creates their tracking links; reject and review send no email.
4. Call `influencers.accept`, `influencers.reject` or `influencers.review` with `user_id` and `confirm=true` for each approved creator, then show the updated counts.
