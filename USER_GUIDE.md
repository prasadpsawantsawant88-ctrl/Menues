# User guide

**Customer.** Register at the kiosk (or `/join-queue`), scan the QR code with the phone camera. Your phone shows your token, groups ahead, estimated wait and updates (no SMS). Browse the menu and pre-order while waiting: dishes are timed to be ready when you sit down. When "Your table is ready" appears, tap *I'm on my way* and go to the host stand. Once seated you can keep ordering from the same page or from the table QR.

**Host / staff** (`/staff`, staff/1111). See the live queue and tables. *Add customer* shows a QR for walk-ups. *Allocate table* (suggested best fit, fairness protected), *Mark seated*, *Remind*, *+2 min*, *Release table*, *Edit* (party size, seating time, priority), *New QR* for a lost link, *Guests left* → *Mark clean*.

**Kitchen** (`/kitchen`, kitchen/2222). Cards per station: *Start*, *Mark ready*, *Served*, *+5 min*, *Rush*, *Out of stock*. Scheduled dishes show their start time and the guest's expected seating time.

**Admin** (`/admin`, admin/9999). Analytics, menu, tables & QR (print table QR codes), chefs per station, kiosk PIN, public base URL, session lifetime. *Reset demo data* in the sidebar.

**Kiosk.** See `KIOSK_GUIDE.md`. Exit: tap the logo 5 times, enter the PIN.


## Admin: changing the restaurant (new)

Sign in at `/admin` (admin / 9999). Everything below saves to the shared database and appears on every screen at once.

1. **Add a dish or change a price**: Menu → *Add dish* or the pencil icon. Fill name, category, station, price and prep time. In *Recipe* add each raw material and how much ONE portion uses; cost and margin update as you type.
2. **Stock**: Inventory → *Receive* when a delivery arrives, *Waste* for spoilage, *Count* after a shelf count. Items marked *Running low* or *Out of stock* are at the top of your shopping list. When something runs out, dishes that need it show *Sold out* to customers.
3. **Floor plan**: Floor plan → drag tables, click one to change seats, shape or zone, add zones such as *Terrace*, then *Save plan*.
4. **Prep-time AI**: shows how accurate the learned cooking times are. *Retrain now* after a busy week; untick the box to go back to standard times.
5. **Loyalty**: Loyalty → set points per rupee, welcome bonus, tiers and rewards; search a member by phone or name; *Adjust* to give an apology bonus. Guests see their points on their own queue page (QR from the kiosk) and choose a reward when paying for a pre-order.
