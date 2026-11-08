# Environment variables

All optional. Put them in `.env` (created from `.env.example` by the launcher). Restart (`STOP_DEMO` → `START_DEMO`) after changes. Nothing here is ever bundled into the website code.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `5173` | Port the app runs on |
| `HOST` | `0.0.0.0` | Interface to listen on (0.0.0.0 = reachable from phones) |
| `PUBLIC_BASE_URL` | auto (Wi-Fi address) | Address printed in QR codes. Set for an https tunnel/hosted site. Admin → Kitchen & settings → *Public base URL* overrides it. |
| `STAFF_PIN` / `KITCHEN_PIN` / `ADMIN_PIN` | 1111 / 2222 / 9999 | Sign-in PINs (usernames `staff`, `kitchen`, `admin`) |
| `POWER_AUTOMATE_WEBHOOK_URL` | – | Enables alert webhooks (see POWER_AUTOMATE.md) |
| `DATA_DIR` | `./data` | Where `demo-db.json`, `admin-secret.txt`, `server.log` live |
| `CLOUDFLARED_BIN` | auto | Path to your own `cloudflared` program for START_ONLINE (otherwise the PATH, then an automatic download) |
| `NO_BROWSER` | – | Set to `1` so START_DEMO does not open a browser |

Optional static-hosting mirror (build-time, public values only): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `.env.local`. Not needed for the local demo.
