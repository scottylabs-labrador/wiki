---
status: accepted
---

# A Slack mention may search public messages; the website may not

The wiki agent answers from published Pages. A Slack mention may also call `assistant.search.context` once, with the bot token and that event's `action_token`, when the model decides the documentation does not answer the question. The website never receives the tool. Slack messages are not a Source and are not ingested. Citations stay links to Pages. Permalinks of messages the tool actually returned are a separate footer.

The bot token cannot use Slack's search without an `action_token`, and that token exists only on a mention. Scope is `search:read.public`, so the search covers every public channel and not private channels or DMs. There is no channel allowlist: a mention in one public channel can quote messages from another, and the quote is posted in the mention's thread.

## Consequences

- The Slack app must be internal or directory-published, and the bot needs `search:read.public`. An unlisted distributed app is rejected.
- A missing `action_token`, or a Slack error, still produces the wiki Answer. The model cannot call the tool a second time.
- A checkmark means wiki Chunks or Slack messages were given to the model. A warning means neither was.
- Anyone who can mention the bot can cause a public-channel message to be copied into that thread. That is the cost of leaving the search unscoped.
