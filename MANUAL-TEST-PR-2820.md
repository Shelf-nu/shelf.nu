# Manual test guide — PR #2820

**Model reservations: counts, fulfilment, activity log**

Time needed: about 15 minutes for the core path, 25 minutes for everything.

---

## What you are testing

A booking can reserve **units of an asset model** without naming which physical
items. For example "3 of PT-DZ21K projector, any 3". The booking then owes 3
units, and Shelf blocks check-out until all of them are matched to real assets.

This PR changes four things about that.

| # | Before | After |
|---|---|---|
| 1 | Bookings list said `7 assets`, the booking page said `11 items` | Both agree. Reserved units sit in their own section. |
| 2 | Only the camera scanner could match a reserved unit | Any way of adding the asset matches it |
| 3 | Adding one asset wrote the activity line twice | Writes once |
| 4 | Adding a kit from the kit page wrote no activity line | Writes one |

**Fix 2 is the one that matters most.** Before this PR, a workspace with no
working scanner could create a reservation and then had no way to check the
booking out. The only escape was to delete the reservation.

---

## Before you start

You need, in one workspace:

- An **asset model** with at least **4 INDIVIDUAL assets** attached to it, all
  Available (not in custody, not booked over your test dates).
- A second asset model with at least 1 asset, for the multi-model check.
- One **kit** with at least one asset in it.

> Model reservations only work with `INDIVIDUAL` assets. Quantity-tracked
> assets are not part of this flow.

If you need to create a model: **Assets → Asset models → New**, then open an
asset and set its model.

---

## 1. The count the customer reported

**Setup**

1. Create a booking. Give it dates in the future. Do not add anything yet.
2. Open **Manage assets → Models** tab.
3. Reserve **3** of your model. Save.
4. Go back into **Manage assets → Assets** and add **2 ordinary assets** that
   are NOT of that model.

**Check the booking page**

- [ ] A section titled **"Unassigned model reservations"** sits **above** the
      Assets & Kits list.
- [ ] Its subtitle reads **`3 of 3 units still to assign, across 1 model`**.
- [ ] The row underneath reads **`3 of 3 units still to assign`**.
- [ ] The **Assets & Kits** header below reads **`2 assets`**, and there are
      exactly 2 rows.
- [ ] In **Booking statistics** on the right, **Unassigned model units** shows
      an amber **3**.

The point: every number describes the rows directly beneath it. Nothing to
reconcile.

**Check the bookings list**

- [ ] Go to **Bookings**. That booking shows **`2 assets`** and an amber
      **`3 units unassigned`** pill.
- [ ] The `2 assets` here matches the `2 assets` on the booking page exactly.

**Check the drawer**

- [ ] In the bookings list, open the assets drawer for that booking (click the
      asset count).
- [ ] It shows the same reservations section and the same wording as the
      booking page.

---

## 2. The main fix: matching a reserved unit without a scanner

This is the part that was broken.

1. Stay on the same booking.
2. Open **Manage assets → Assets**.
3. Tick **one asset that belongs to your reserved model**.
4. **Confirm**.

**Check**

- [ ] The reservations section now reads **`2 of 3 units still to assign`**.
- [ ] The header reads **`2 of 3 units still to assign, across 1 model`**.
- [ ] **Assets & Kits** now says **`3 assets`**.
- [ ] **Booking statistics** shows **Unassigned model units: 2**.

> On `main` this number would still say **3**. The asset would be on the
> booking, but the reservation would be untouched.

**Now finish it**

5. Add the remaining **2 assets** of that model the same way.

**Check**

- [ ] The **"Unassigned model reservations" section disappears completely.**
- [ ] The **Unassigned model units** row disappears from Booking statistics.
- [ ] The bookings list no longer shows the amber pill for this booking.
- [ ] **Reserve** the booking, then **Check out**. It goes through with no
      error.

That last step is the whole point. Before this PR you could not reach it
without a scanner.

---

## 3. The entry point

1. On a booking that still has an outstanding reservation, click the **⋮** menu
   on a reservation row.

**Check**

- [ ] The menu offers **"Select assets to assign"** first, then
      **"Scan to assign"**.
- [ ] "Select assets to assign" opens **Manage assets**.
- [ ] "Scan to assign" opens the scanner as before.

---

## 4. The scanner still works and agrees

If you have a scanner or a phone handy.

1. New booking, reserve **2** of your model.
2. Scan one matching asset in **Scan to assign**.

**Check**

- [ ] Reservation drops to **`1 of 2 units still to assign`**.
- [ ] The result is identical to what the picker produced in step 2.

Both doors, same outcome. That is the design.

---

## 5. Activity log: no duplicates, nothing missing

**Duplicate check**

1. On any booking, add **one single asset** through **Manage assets**.
2. Open the **Activity** tab.

- [ ] There is exactly **ONE** line saying `<you> added <asset> to the booking.`
- [ ] On `main` there would be **two identical lines**.

**Quantity edit check**

3. On a booking with a quantity-tracked asset, change only its **quantity**
   through Manage assets.

- [ ] The log records the **quantity change**.
- [ ] It does **NOT** say "added ... to the booking" for an asset that was
      already there.

**Missing note check**

4. Go to a **kit's page → Assets → Add to existing booking**, and pick a
   booking.
5. Open that booking's **Activity** tab.

- [ ] There is a line naming the **kit by name**, e.g.
      `<you> added <Kit name> to the booking.`
- [ ] On `main` there would be **nothing at all** here.

**Reservation match check**

6. On a booking where you matched a reserved unit in step 2, open **Activity**.

- [ ] There is a line like
      `<you> assigned <asset> (<model>) to this booking — 2 × <model> remaining.`
- [ ] The countdown in that line matches what the page shows.

---

## 6. Edge cases worth a minute

**Over-adding**

1. Reserve **1** unit of a model, then add **3** assets of that model at once.

- [ ] Reservation shows fulfilled and the section disappears.
- [ ] All **3** assets are on the booking. The extras are ordinary assets.
- [ ] Nothing shows a negative or a count above the reserved amount.

**Re-saving without changing anything**

2. On a booking with a **partly** matched reservation (say `1 of 3` matched),
   open Manage assets and press **Confirm** without changing the selection.

- [ ] The reservation count does **not** move.

> This is the one that would corrupt data silently if it were wrong. The dialog
> resends the whole selection each time, so a careless fix would count the same
> assets again.

**Finished bookings**

3. Find or make a booking with a reservation, then **Cancel** it.

- [ ] The reservation row turns **grey**, not amber.
- [ ] Wording changes to **`never assigned`**, not "still to assign".
- [ ] The bookings list shows **no amber pill** for it.
- [ ] The **⋮** menu offers no assign actions.

Same for **Complete** and **Archived**.

**Two models at once**

4. Reserve **3** of model A and **2** of model B on one booking.

- [ ] Header reads **`5 of 5 units still to assign, across 2 models`**.
- [ ] Match one asset of model A. Header becomes **`4 of 5 ...`**, model A's row
      becomes `2 of 3`, model B's row stays `2 of 2`.
- [ ] The row numbers always add up to the header numbers.

---

## 7. Other places the numbers appear

- [ ] **PDF**: booking page → **Actions → Generate PDF**. Outstanding
      reservations are listed and the counts match the screen.
- [ ] **Mobile / narrow window**: shrink the browser to phone width. The
      reservations section is readable and the counts still match.
- [ ] **Booking update email**: if you trigger one, outstanding reservations
      appear with the same numbers.

---

## 8. Permissions

Worth one pass as a non-owner.

1. Sign in as a **BASE** or **SELF_SERVICE** user who can see the booking.

- [ ] They can **see** the reservations section and the counts.
- [ ] They do **not** get assign or remove actions they are not allowed to use.
- [ ] Nothing renders blank or broken for them.

---

## Deploy notes

**This PR contains a database migration.**

```
20260810120000_add_booking_asset_model_request_provenance
```

It adds one nullable column to `BookingAsset`, one partial index, and one
foreign key with `ON DELETE SET NULL`. It only adds. It changes and removes
nothing, and existing rows get `NULL`, which is the correct value for every
asset that was added directly.

Fly runs migrations automatically on release, so no manual step is needed.

The column records **which reservation each asset filled**. Before, that link
only existed as a sentence in the activity log, so "which assets filled the
projector reservation?" could not be answered from the data.

---

## If something looks wrong

Useful things to capture:

- The booking id from the URL.
- A screenshot of the reservations section **and** the Booking statistics panel
  together, so the two counts can be compared.
- The Activity tab for that booking.

The number to distrust first is any count that does not match the rows directly
under it. That was the original bug and it is the shape this PR is built to
prevent.
