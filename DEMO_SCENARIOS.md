# Demo scenarios

Setup: laptop (`START_DEMO`) + **Phone A** = kiosk, **Phone B** = customer. Both phones on the laptop's Wi-Fi, or run `START_ONLINE` so Phone B can scan from any network. On the laptop open `/staff` and `/kitchen` in two windows (sign in staff/1111, kitchen/2222). Run `RESET_DEMO` first for the original evening: 9 of 10 tables occupied, T03 cleaning, queue Q021–Q023, dishes cooking at T05 and T08.

## 1. Kiosk → personal QR → pre-order (the main story)
1. Phone A: open `http://<laptop>:5173/kiosk`, tap **Tap to join the queue**.
2. Enter a mobile number on the keypad (e.g. 98765 43210), party 4 → **Get my token & QR code**. Token (e.g. **Q024**), estimated wait and QR appear. The laptop's staff screen shows Q024 immediately.
3. Phone B: scan the QR with the camera (or, without a second phone, press **Simulate customer scan** / **Copy customer URL** and paste it in another browser). Phone A changes to "Connected to your phone"; Phone B shows the live queue page. The address contains a random secret, no phone number.
4. Phone B: pre-order Paneer Tikka, Dal Makhani, 2 × Butter Naan, Cold Coffee → Proceed to payment → **Pay**. "Payment successful" appears and the page moves on. The order is saved as paid in the database (`data/demo-db.json`) and instantly appears in the kitchen, staff and admin screens.
5. Kitchen: dishes appear as **Scheduled** with start times matched to the expected seating time. Nothing is cooked early.
6. Staff: *Guests left* on T04 → *Mark clean*; *Allocate table* to Q024. Phone B flips to "Your table is ready" and the kitchen cards show the table. *Mark seated*.
7. Kitchen: Start → Mark ready → Served; Phone B follows each step live. Phone B orders again from the same page (linked to the table).

## 2. Table QR ordering
Staff: seat a walk-in on a free table (or *Guests left* + walk-in). Open `/table/T02` (what the printed table QR opens). Order, pay, watch the kitchen.

## 3. Delay and rescheduling
Staff: *Edit* Q022 → set seating time +25 min. Kitchen: the pre-ordered dish start time moves automatically. In the kitchen press **+5 min** on a dish and watch estimates change.

## 4. Failure handling
- Stop Wi-Fi on Phone A: amber "Reconnecting" bar, registration pauses; restore Wi-Fi, it resumes.
- Register the same number twice: the second attempt is refused (no link hand-over). Staff can press **New QR** to issue a fresh link.
- `STOP_DEMO`, then `START_DEMO`: queue, orders and tables are unchanged.
- Kiosk exit: tap the logo 5×, wrong PIN refused, `1234` unlocks.
