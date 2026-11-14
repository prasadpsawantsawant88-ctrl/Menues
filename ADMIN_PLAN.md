# Admin plan: what the restaurant owner can change

This is the plan behind the **Admin** area of Menues (DineFlow). It was written after looking at how
established restaurant systems organise the back office, mainly Odoo Point of Sale – Restaurant
(https://www.odoo.com/app/point-of-sale-restaurant), and at how restaurant platforms such as Toast
link recipes to inventory. Nothing was copied; the ideas were reduced to what a single-restaurant
demo needs and built into the app.

## 1. What similar systems do, and what we took from it

| Idea seen in similar apps | Where it is in Menues |
|---|---|
| **Floor plan editor** with tables you place, resize and group into floors/zones (Odoo: "restaurant floors and tables") | Admin → **Floor plan**: drag tables and areas on a canvas, set seats, shape, size and zone, add zones with a colour. Staff see the same plan with live table status. |
| **Kitchen display** with per-station tickets and preparation times (Odoo: Kitchen Display) | Already present (Kitchen screen). Admin sets chefs per station in Kitchen & settings. |
| **Products and recipes linked to stock** so selling a dish uses up raw materials (Odoo Inventory/Manufacturing "bill of materials", Toast recipe inventory) | Admin → **Menu**: every dish has a recipe (ingredient + quantity per portion). Admin → **Inventory** holds raw materials. A paid order takes the ingredients out. |
| **Sold-out handling**: a product disappears from ordering when stock runs out | A dish whose ingredient is short shows "Sold out" or "Only N left" on the customer menu, and cannot be ordered. |
| **Plate cost and margin** per dish (Toast "recipe costing") | The dish form shows cost per portion and margin live while you edit the recipe. |
| **Purchases, waste and stock counts** with a movement history | Inventory: *Receive*, *Waste*, *Count* (variance logged) and a stock-movement log. |
| **Loyalty programs** tied to a customer, with points, rewards and tiers (Odoo Loyalty & Rewards) | Admin → **Loyalty**: points per ₹, welcome bonus, tiers, rewards, member search by phone, manual adjustment. |
| **Reports**: sales, product mix, stock value | Analytics (existing) plus Inventory stock value and days-of-stock-left. |

Not built, on purpose (out of scope for a course demo): real payment terminals, supplier purchase
orders, multi-branch, staff rotas and payroll, tax filing, printing to kitchen printers.

## 2. Who can do what

| Role | Can |
|---|---|
| Customer (phone, kiosk) | Join the queue, order, pay (simulated), see **own** loyalty balance through their personal link |
| Staff | Queue, tables, floor plan view, seat guests; **cannot** see recipes, ingredient prices or loyalty balances, **cannot** change menu, settings or stock |
| Kitchen | Dish tickets only |
| Admin | Everything below |

This is enforced on the server (not only hidden in the screens): admin-only actions are refused for
other roles, and the data sent to staff, kitchen and public screens has the recipes, stock, supplier
prices and loyalty records removed.

## 3. Admin screens

1. **Overview**: today's orders and revenue, queue, tables, kitchen workload, shortcuts.
2. **Menu**: add, edit, hide, delete dishes; categories; price; station; prep time; options; photo; **recipe**; live cost and margin.
3. **Inventory**: raw materials with In stock / Running low / Out of stock, uses per day, days left, receive delivery, record waste, stock count, new/edit ingredient, movement history. Dishes that cannot be made are listed as sold out.
4. **Floor plan**: drag-and-drop editor with zones; Save applies it everywhere; tables with guests cannot be removed.
5. **Prep-time AI**: shows how the estimate is learned (below), accuracy against the standard times, per-dish learned time, retrain and on/off switch.
6. **Loyalty**: programme rules, members (searchable by phone, phone masked), adjust points.
7. **Tables & QR**: QR codes for each table, block/unblock.
8. **Kitchen & settings**: chefs per station, opening hours, dining times, GST, kiosk PIN, public link.
9. **Analytics**: sales, peak hours, dish popularity, wait times.

## 4. How inventory is connected to dishes

* Recipe = list of `ingredient, quantity per ONE portion` on each dish.
* **Order created** (unpaid): stock is checked, nothing is taken. The whole cart is checked together, because two dishes may share paneer.
* **Payment succeeds**: ingredients are taken out and a movement "Sold" is logged.
* **Item cancelled before cooking**: ingredients are put back ("Order cancelled").
* **Portions left** for a dish = the smallest `floor(stock / quantity)` over its ingredients. At 0 the dish is sold out; at 5 or fewer the menu says "Only N left".
* A dish without a recipe is not tracked and never sells out by itself (the older manual stock count still works).
* Seed data has 32 ingredients, a recipe for all 29 dishes, and a few materials already low or out (fish, cream, coffee, mutton) so the effect can be shown.

## 5. How the prep-time estimate is learned (machine learning)

* **Data**: every finished dish records when the chef pressed *Start* and when it became *Ready*.
* **Model**: ridge regression (a linear model with a small penalty), solved exactly in plain JavaScript on the server; no outside service, trains in milliseconds.
* **Inputs**: which dish, its station, number of portions (and complexity), peak hour or not, weekend or not.
* **Used for**: wait-time estimates on the customer menu, the pre-order schedule (when each dish should start so everything is ready when guests sit down) and the kitchen plan.
* **Safe by design**: predictions are limited to between half and three times the standard time; a dish with fewer than 3 cooks uses its station average; with fewer than 40 finished dishes there is no model and standard times are used; admin can switch it off.
* **Honest accuracy**: trained on the oldest 80%, scored on the newest 20%, and compared with the standard-time rule. It retrains by itself after 25 new finished dishes, or on demand.
* **Limit**: the demo history is *generated* with a hidden pattern for the model to find, so the accuracy shown in the demo (about 0.9 min average error vs 3.4 min) is flattering. On real data expect less.

## 6. Loyalty by phone number

* The phone number the guest gives at the kiosk or on the join page **is** the account. No card, app or password.
* First time: welcome bonus (default 50 points). Every paid order: points = amount × rate × tier multiplier (default 1 point per ₹10; Silver ×1, Gold ×1.25 from 500, Platinum ×1.5 from 1500 lifetime points).
* Rewards (default 100 points = ₹50 off, 250 = ₹150, 600 = ₹400) are chosen at checkout of a pre-order. The discount comes off before GST, and points are used only when payment succeeds.
* A guest sees points only on their own personal queue page (the link from the QR code). The kiosk, staff and public screens never show points.
* No SMS is sent anywhere. Phone numbers are masked on admin screens and are never put in QR URLs.

## 7. Dummy data that ships

Ten days of past orders (about 750 finished dishes) with a hidden "true" cooking-time pattern, 32 ingredients with stock and supplier prices, a recipe per dish, about 100 members with points history and a few redemptions, a floor plan with three zones, and a live evening with guests in the queue. *Reset demo data* brings it all back.

## 8. Build order that was followed

1. Shared logic with tests: inventory, ML, loyalty, floor plan validation (`src/lib`).
2. Server rules: admin-only actions, redaction, private loyalty lookup.
3. Admin screens, then customer changes (sold out, rewards, loyalty card).
4. Tests at three levels (logic, API, real browsers on several devices), then documentation.

## 9. Ideas for later

Supplier purchase orders and auto-reorder, per-day specials, happy-hour pricing, table merge/split, reservation slots on the floor plan, tip handling, a printed kitchen ticket, and replacing the JSON file with a hosted database (the Supabase schema is already in `DATABASE_SCHEMA.sql`).
