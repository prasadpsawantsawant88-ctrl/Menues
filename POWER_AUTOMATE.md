# Power Automate (optional)

DineFlow can post alerts to a Microsoft Power Automate flow. **Off by default; the demo needs none of this.**

1. In Power Automate create a flow with trigger **When an HTTP request is received**. Copy its URL.
2. Put it in `.env`: `POWER_AUTOMATE_WEBHOOK_URL=https://prod-…`  and restart (`STOP_DEMO`, `START_DEMO`).
3. Add actions as you like (Teams message, email, Excel row). The URL is a secret: it stays on the laptop and is never sent to a browser.

Each alert is a JSON POST:
```json
{ "event": "queue_threshold_exceeded", "restaurant": "Menues", "at": "2026-11-07T17:30:00.000Z", "waiting": 7, "threshold": 6 }
```
| `event` | When |
|---|---|
| `queue_threshold_exceeded` | Waiting groups reach the threshold (Admin setting, default 6) |
| `kitchen_order_delayed` | A dish runs 3+ minutes past its expected time |
| `payment_failed` | A payment attempt fails (the simulated Pay button always succeeds, so this fires only for API-level failures) |
| `customer_no_show` | A called group did not arrive in time |
| `table_available` | A table becomes available |

Failures to reach Power Automate are ignored (they never affect the restaurant). Not tested against a live flow in the build environment; `table_available`, `queue_threshold_exceeded` and `payment_failed` are verified against a local mock receiver in `npm run test:server`; `kitchen_order_delayed` and `customer_no_show` are implemented but not exercised by the tests.
