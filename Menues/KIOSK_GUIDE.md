# DineFlow Kiosk guide

The kiosk is a normal website page at `/kiosk`. Put a phone or tablet at the entrance and open it in the browser. Nothing to install.

1. Start DineFlow on the laptop (`START_DEMO`) and note the **PHONE KIOSK** address, e.g. `http://192.168.1.20:5173/kiosk`.
2. Connect the phone to the **same Wi-Fi** and open that address in Chrome or Safari.
3. Optional: browser menu → **Add to Home Screen** for a one-tap shortcut.

## Make the QR open from any phone (public link)
By default the QR code holds the laptop's Wi-Fi address, so the customer's phone must be on the same Wi-Fi. To let **any** phone (mobile data included) open it, start DineFlow with `START_ONLINE` instead of `START_DEMO`. It creates a free Cloudflare tunnel, prints `PUBLIC KIOSK: https://….trycloudflare.com/kiosk`, and every QR code then opens that https link. Open the PUBLIC KIOSK address on the kiosk phone, keep the START_ONLINE window open, press Ctrl+C to stop. The address changes each time.

Why not Vercel? Vercel and Cloudflare Pages host static sites or short serverless functions. DineFlow needs one always-running server that holds the shared queue and pushes live updates, so a Vercel copy would give every visitor their own empty data. The tunnel keeps your laptop as that one server. (A permanent address needs a small always-on host or a named Cloudflare tunnel with your own domain; set it as **Public base URL**.)

## How it saves data
When a customer enters their number and details and taps **Get my token & QR code**, the kiosk sends the registration to the DineFlow server, which writes it to the database (`data/demo-db.json`) at once. The staff, kitchen and admin screens and the customer's phone update live from the same data.

## Keep it on the screen
- **Expand** (top right) gives full screen where the browser allows it. The kiosk also asks the phone to keep the screen awake and shows "screen may sleep" if the phone refuses. Set the phone's screen timeout to maximum and keep it charging.
- To stop customers leaving the page, use the phone's own feature: **Android App Pinning** (Settings → Security → App pinning, then pin the browser from Recents) or **iPhone Guided Access** (Settings → Accessibility → Guided Access, triple-click the side button). DineFlow does not bypass OS restrictions.

## Staff exit
Tap the **restaurant logo** 5 times quickly and enter the kiosk PIN (default `1234`; change it in Admin → Kitchen & settings).

## If something fails
| Symptom | Fix |
|---|---|
| Amber "Reconnecting…" bar | Wi-Fi dropped or laptop asleep. Registration pauses and resumes by itself. |
| Page does not open on the phone | Same Wi-Fi? Allow Node through the firewall (Private networks). Guest Wi-Fi often blocks phone-to-laptop traffic; use a phone hotspot for the laptop instead. |
| QR opens the wrong address | Admin → Kitchen & settings → Public base URL (or `PUBLIC_BASE_URL` in `.env`). |
| Customer's link expired | Staff → customer row → **New QR**. |
