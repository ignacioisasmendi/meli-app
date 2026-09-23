// Talks to the CRM on behalf of the Amazon page. Doing the request here rather
// than in the content script keeps the token out of Amazon's page and avoids
// CORS: an extension worker with host permission for the CRM can call it.

const ENDPOINT = '/api/imports/extension'

async function getConfig() {
  const { crmUrl, token } = await chrome.storage.local.get(['crmUrl', 'token'])
  return { crmUrl, token }
}

async function submitOrder(payload) {
  const { crmUrl, token } = await getConfig()
  if (!crmUrl || !token) {
    chrome.runtime.openOptionsPage()
    return { ok: false, message: 'Configurá la URL del CRM y el token en las opciones de la extensión.' }
  }

  let res
  try {
    res = await fetch(crmUrl + ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
  } catch {
    return {
      ok: false,
      message: 'No se pudo conectar con el CRM. ¿Está bien la URL y le diste permiso a la extensión?',
    }
  }

  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    return { ok: false, message: 'El CRM rechazó el token. Revisalo en las opciones de la extensión.' }
  }
  if (!res.ok) return { ok: false, message: data.error || `El CRM respondió con error ${res.status}.` }
  return { ok: true, ...data }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'meliapp:submit-order') return false
  submitOrder(message.payload).then(sendResponse)
  return true // responds asynchronously
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'meliapp:open-tab' && typeof message.url === 'string') {
    chrome.tabs.create({ url: message.url })
  }
})

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage())
