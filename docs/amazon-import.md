# Importing Amazon orders from a screenshot

Two ways to turn an Amazon "Order Details" screenshot into purchase lines. Both
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

## What gets checked

Whichever path you use, the app re-adds the lines and compares them with the
totals printed on the screenshot:

- `Σ(quantity × unit price)` against **Item(s) Subtotal** — this is what catches a
  missed quantity badge, the most common extraction error.
- items + tax + shipping against **Grand Total**.
- currency, which must be USD.

Anything off shows as an amber warning on the review panel. Nothing is written to
the database until you press **Import**.
