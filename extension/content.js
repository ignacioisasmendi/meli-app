// Runs on Amazon "Order Details" pages. Adds a floating "Enviar al CRM" button
// that sends the page's visible text (plus the product links, for ASINs) to the
// CRM, which reads it into a purchase draft. The text — not the HTML — is what
// gets sent, so Amazon reshuffling its markup doesn't break the import.

;(() => {
  if (document.getElementById('meliapp-import-root')) return

  const MAX_TEXT = 60000
  const ASIN_IN_URL = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/

  /** Page text with the obviously sensitive bits (card digits) masked. */
  function pageText() {
    return document.body.innerText
      .replace(/(ending in|terminada en)\s*\d{4}/gi, '$1 ****')
      .replace(/\n{3,}/g, '\n\n')
      .slice(0, MAX_TEXT)
  }

  /** One entry per distinct ASIN linked from the page, with the best title found. */
  function productLinks() {
    const byAsin = new Map()
    for (const a of document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]')) {
      const match = a.getAttribute('href').match(ASIN_IN_URL)
      if (!match) continue
      const asin = match[1]
      const title = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500)
      const current = byAsin.get(asin)
      if (!current || title.length > current.title.length) byAsin.set(asin, { asin, title })
    }
    return [...byAsin.values()].slice(0, 200)
  }

  // A shadow root keeps Amazon's CSS off the button, and keeps the button's own
  // text out of document.body.innerText.
  const host = document.createElement('div')
  host.id = 'meliapp-import-root'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>
      .box { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
        font: 14px/1.4 system-ui, -apple-system, sans-serif; display: flex;
        flex-direction: column; align-items: flex-end; gap: 8px; max-width: 320px; }
      button { border: 0; border-radius: 999px; padding: 10px 16px; cursor: pointer;
        background: #2d3277; color: #fff; font: inherit; font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,.25); }
      button:disabled { opacity: .7; cursor: progress; }
      .msg { background: #fff; color: #111; border-radius: 10px; padding: 10px 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,.2); border-left: 4px solid #2d3277; }
      .msg.error { border-left-color: #c62828; }
      .msg.ok { border-left-color: #2e7d32; }
      .msg a { color: #2d3277; font-weight: 600; cursor: pointer; }
      [hidden] { display: none; }
    </style>
    <div class="box">
      <div class="msg" hidden></div>
      <button type="button">Enviar al CRM</button>
    </div>`
  document.body.appendChild(host)

  const button = root.querySelector('button')
  const msg = root.querySelector('.msg')

  function show(kind, text, link) {
    msg.hidden = false
    msg.className = `msg ${kind}`
    msg.textContent = text
    if (link) {
      msg.append(' ')
      const a = document.createElement('a')
      a.textContent = link.label
      a.addEventListener('click', () =>
        chrome.runtime.sendMessage({ type: 'meliapp:open-tab', url: link.url })
      )
      msg.append(a)
    }
  }

  button.addEventListener('click', async () => {
    button.disabled = true
    button.textContent = 'Leyendo la orden…'
    msg.hidden = true

    let res
    try {
      res = await chrome.runtime.sendMessage({
        type: 'meliapp:submit-order',
        payload: { url: location.href, text: pageText(), items: productLinks() },
      })
    } catch {
      res = { ok: false, message: 'La extensión se actualizó: recargá la página y probá de nuevo.' }
    }

    button.disabled = false
    button.textContent = 'Enviar al CRM'

    if (!res?.ok) {
      show('error', res?.message || 'Algo salió mal.')
      return
    }
    const order = res.orderNumber ? `La orden ${res.orderNumber}` : 'La orden'
    if (res.status === 'already_imported') {
      show('ok', `${order} ya está importada en el CRM.`, { label: 'Ver', url: res.url })
    } else if (res.status === 'pending') {
      show('ok', `${order} ya tiene un borrador esperando revisión.`, { label: 'Revisar', url: res.url })
    } else {
      const warn = res.warningCount > 0 ? ' Hay totales que no cierran: revisala con cuidado.' : ''
      show('ok', `Borrador creado con ${res.itemCount} ítem(s).${warn}`, {
        label: 'Revisar en el CRM',
        url: res.url,
      })
      button.textContent = 'Enviado ✓'
    }
  })
})()
