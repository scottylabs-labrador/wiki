---
status: accepted
---

# Slack Asks skip Member auth and the hourly quota

The web surface requires a signed-in Member and spends one of their sixty questions per hour before the model is called. Slack is a second surface for the same Wiki Agent, and an Ask there is open: anyone in a channel the app is invited to may Ask, and there is no quota.

That is a deliberate trade-off against turning Slack into an unpaid faucet, chosen so a mention can be answered without mapping a Slack identity to an Andrew ID. The Answer path is still `openAnswerStream`; only the web adapter (`POST /chat/answers`) authenticates and meters.

## Consequences

- Slack Asks spend OpenRouter credit with no per-person ceiling. The key's credit limit is the only backstop.
- A future reader who sees session-gated `/chat/answers` will assume Slack is gated the same way. It is not.
- Closing Slack later (Member mapping, a quota) is a product change for everyone already using the app in channels.
