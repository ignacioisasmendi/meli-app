# Importing Amazon orders

Three ways to turn an Amazon "Order Details" page into purchase lines. All
land in the same place: the form at `/purchases/import`, pre-filled and still
editable, with a review panel showing what was read before anything is saved.

## A. Paste from Claude (no API key, no per-order cost)

Set this up once as a **Claude Project**, then every import is drag-and-drop:

1. On [claude.ai](https://claude.ai), create a project — call it *Amazon order import*.
2. Paste the instructions below into the project's **custom instructions**.
3. From then on: start a chat in that project, attach the screenshot, send it with
   no message at all. Claude replies with the JSON.
4. Copy the reply, open **Purchases → Import → Paste from Claude**, paste, and press
   **Read pasted order**.

For a one-off without a project, the **Copy prompt** button on that tab puts the
same text on your clipboard — send it together with the screenshot.

Long orders: attach several screenshots to the same message. They are treated as
one order and each item is listed once.

### The instructions

```text
You extract purchase-order data from screenshots of Amazon "Order Details" pages so it can be imported into an inventory system.

How to read the page:
- The order number is next to "Order #", and the purchase date is next to "Order placed" — return it as YYYY-MM-DD.
- The "Order Summary" box holds "Item(s) Subtotal", "Shipping & Handling", the estimated/collected tax, and the "Grand Total". Report the amounts actually charged; if shipping is free it is 0.
- Each shipment block lists its items. The price shown under an item title is the price for ONE unit, before tax.
- Quantity is the small number in a circle overlaid on the item's thumbnail. When there is no badge, the quantity is 1.
- "Sold by: X" is the seller, not the product name.
- Ignore button labels ("Buy it again", "Track package", "Return or replace items"), delivery status lines, and return-eligibility text.

For each item return two names: "fullTitle" is the listing title exactly as printed, and "name" is a short catalog name a warehouse would use — brand, model, and the variant that distinguishes it (capacity, colour, pack size), under 60 characters, with marketing adjectives dropped. Example: the listing "DJI Mic Mini (1 TX + 1 RX), Ultralight, Detail-Rich Audio" becomes "DJI Mic Mini (1 TX + 1 RX)".

Before answering, check that the sum of quantity × unitPrice across all items equals the printed "Item(s) Subtotal". If it does not, re-read the quantity badges and prices — a mismatch almost always means a quantity was missed.

Amounts are numbers, without currency symbols or thousands separators. Report a field as null only when it is genuinely not visible.

Reply with the JSON object and nothing else — no explanation before or after it. Use exactly this shape:

{
  "orderNumber": "112-8247265-8713054",
  "purchasedAt": "2026-07-28",
  "itemsSubtotal": 234.50,
  "tax": 9.45,
  "shipping": 0,
  "grandTotal": 243.95,
  "currency": "USD",
  "items": [
    {
      "name": "DJI Mic Mini (1 TX + 1 RX)",
      "fullTitle": "DJI Mic Mini (1 TX + 1 RX), Ultralight, Detail-Rich Audio",
      "quantity": 3,
      "unitPrice": 45.00,
      "seller": "Hibikin-US"
    }
  ]
}

If I give you more than one screenshot, they are parts of the same order page — return one JSON object and list each item once.
```

> Canonical copy lives in `lib/imports/amazon-prompt.ts` (`WEB_PROMPT`) — the app
> and this document read from the same constant, so edit it there.

## B. Upload the screenshot directly

Requires `ANTHROPIC_API_KEY` in `.env.local`; the tab is hidden when it is unset.
Drop, paste, or pick the image on **Purchases → Import → Upload screenshot** and
the server calls Claude for you. Costs a few cents per order, saves the round trip
through claude.ai.

## C. One click from the Amazon page (browser extension)

The extension in `extension/` adds an **Enviar al CRM** button to Amazon's
"Order Details" page. It reads the order **straight from the page** — no AI,
no screenshot — and sends it to `/api/imports/extension`, which checks the
totals and parks it as an **ImportDraft**. A Telegram message links straight
to it; it also shows up at the top of **Purchases → Import** under *captured
orders to review*. Opening one pre-fills the form below; **Import** works
exactly as for the other two paths and marks the draft imported. Pressing the
button again on the same order answers "already imported" / "already waiting
for review".

What is read, and from where (`extension/parse-order.js`):

| Field | Where on the page |
| --- | --- |
| Order number | the URL's `orderID`, else `[data-component="orderId"]` |
| Order date | `[data-component="orderDate"]`, else the text after "Order placed" |
| Items | each `[data-component="itemTitle"] a` — the link text is the title, its `/dp/<ASIN>` the ASIN |
| Quantity | the badge over the thumbnail (`.od-item-view-qty`), else "Qty: N", else 1 |
| Unit price | `[data-component="unitPrice"] .a-offscreen` |
| Seller | the "Sold by:" line |
| Subtotal, tax, shipping, grand total | the Order Summary rows, by label ("Item(s) Subtotal:", "Estimated tax to be collected:", "Shipping & Handling:" net of "Free Shipping:", "Grand Total:") |

Each field falls back to a looser lookup (older `yohtmlc-*` markup, then the
printed label) when the specific markup isn't there. If an item has no price,
the button says what's missing and sends nothing. Promotions and coupons aren't
split across the items: the grand total then won't match, and the draft shows
it as a warning to fix by hand. The item's short **name** is the listing title
up to its first comma or dash ("DJI Mic Mini (1 TX + 1 RX), Wireless…" → "DJI
Mic Mini (1 TX + 1 RX)"); it only matters for new products, and it's editable.

On import, each line's **ASIN** is saved as a `ProductAlias` of the product it
was imported into — so the next order with that ASIN maps straight onto the
product (*Known ASIN* in the form), whatever its listing title says. Re-mapping
a line by hand before importing corrects the alias.

Nothing but the order itself leaves the page: no address, no payment method.

Setup (once):

1. Set `EXTENSION_TOKEN` on the server — `openssl rand -hex 32` gives a good
   token.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, press
   **Load unpacked** and pick the `extension/` folder.
3. The options page opens from the extension's toolbar icon: enter the CRM's
   URL and the token, press **Probar conexión** and accept the permission prompt.

To update the extension after pulling changes, press the reload icon on its
card in `chrome://extensions` and reload the Amazon tab.

If Amazon changes the page and a field stops being read, the fix is in
`extension/parse-order.js`: save the order page (Ctrl+S) and adjust the
selector for that field.

## What gets checked

Whichever path you use, the app re-adds the lines and compares them with the
totals printed on the screenshot:

- `Σ(quantity × unit price)` against **Item(s) Subtotal** — this is what catches a
  missed quantity badge, the most common extraction error.
- items + tax + shipping against **Grand Total**.
- currency, which must be USD.

Anything off shows as an amber warning on the review panel. Nothing is written to
the database until you press **Import**.
