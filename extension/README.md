# MeliApp — Amazon import extension

Chrome (Manifest V3) extension that adds an **Enviar al CRM** button to Amazon's
"Order Details" page and sends the order to the CRM as a draft to review.
Setup and the full flow are in [`docs/amazon-import.md`](../docs/amazon-import.md#c-one-click-from-the-amazon-page-browser-extension).

- `parse-order.js` — reads the order off the page's DOM (no AI): header,
  summary totals, and each item with its ASIN, quantity, price and seller.
- `content.js` — shows the button on order-details pages and sends what
  `parse-order.js` read.
- `background.js` — calls `POST /api/imports/extension` with the token (from the
  worker, so the token never enters Amazon's page and CORS doesn't apply).
- `options.html` / `options.js` — CRM URL + token, and the host permission for it.

No build step: load the folder as an unpacked extension.
