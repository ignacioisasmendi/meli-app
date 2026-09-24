// Runs on amazon.com. On an "Order Details" page it shows a floating "Enviar
// al CRM" button that reads the order straight from the page (parse-order.js —
// no AI) and sends it to the CRM as a purchase draft to review.
//
// It watches the URL rather than relying on page loads: Amazon can move from
// the order list to an order's details without reloading the page.

;(() => {
  if (document.getElementById('meliapp-import-root')) return

  const isOrderDetails = () => /order-details/i.test(location.pathname + location.search)
  const formatUsd = (n) => (n == null ? '—' : `US$${n.toFixed(2)}`)

  // A shadow root keeps Amazon's CSS off the button.
  const host = document.createElement('div')
  host.id = 'meliapp-import-root'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>
      .box { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;
        font: 14px/1.4 system-ui, -apple-system, sans-serif; display: flex;
        flex-direction: column; align-items: flex-end; gap: 8px; max-width: 340px; }
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
    msg.hidden = true
    // meliappParseOrder comes from parse-order.js, loaded first (manifest.json).
    const { order, problems } = meliappParseOrder(document, location.href)
    // A line without a price can't be imported: say what's missing instead of
    // sending half an order.
    if (order.items.length === 0 || order.items.some((i) => i.unitPrice == null)) {
      show('error', `No pude leer la orden (${problems.join(', ')}). Avisame para ajustar la extensión.`)
      return
    }

    button.disabled = true
    button.textContent = 'Enviando…'
    let res
    try {
      res = await chrome.runtime.sendMessage({
        type: 'meliapp:submit-order',
        payload: { url: location.href, order },
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
    const label = order.orderNumber ? `La orden ${order.orderNumber}` : 'La orden'
    if (res.status === 'already_imported') {
      show('ok', `${label} ya está importada en el CRM.`, { label: 'Ver', url: res.url })
    } else if (res.status === 'pending') {
      show('ok', `${label} ya tiene un borrador esperando revisión.`, { label: 'Revisar', url: res.url })
    } else {
      const units = order.items.reduce((n, i) => n + i.quantity, 0)
      const warn = res.warningCount > 0 ? ' Hay totales que no cierran: revisala con cuidado.' : ''
      show(
        'ok',
        `Borrador creado: ${order.items.length} producto(s), ${units} unidad(es), total ${formatUsd(order.grandTotal)}.${warn}`,
        { label: 'Revisar en el CRM', url: res.url }
      )
      button.textContent = 'Enviado ✓'
    }
  })

  // Show the button only on an order's details, and follow in-page navigation.
  let lastUrl = null
  function sync() {
    if (location.href === lastUrl) return
    lastUrl = location.href
    msg.hidden = true
    button.textContent = 'Enviar al CRM'
    if (isOrderDetails()) {
      if (!host.isConnected) document.body.appendChild(host)
    } else if (host.isConnected) {
      host.remove()
    }
  }
  sync()
  setInterval(sync, 1000)
})()
