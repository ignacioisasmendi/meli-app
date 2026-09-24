const $ = (id) => document.getElementById(id)

function setStatus(kind, text) {
  $('status').className = kind
  $('status').textContent = text
}

/** "https://crm.example.com/purchases" → "https://crm.example.com", or null. */
function normalizeOrigin(value) {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.origin : null
  } catch {
    return null
  }
}

async function load() {
  const { crmUrl = '', token = '' } = await chrome.storage.local.get(['crmUrl', 'token'])
  $('crmUrl').value = crmUrl
  $('token').value = token
}

/** Saves the settings and asks Chrome for permission to call that one origin. */
async function save() {
  const origin = normalizeOrigin($('crmUrl').value)
  const token = $('token').value.trim()
  if (!origin) return setStatus('error', 'La URL tiene que ser https:// (o http://localhost).'), false
  if (!token) return setStatus('error', 'Falta el token.'), false

  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
  if (!granted) return setStatus('error', 'Sin permiso para esa URL la extensión no puede llegar al CRM.'), false

  await chrome.storage.local.set({ crmUrl: origin, token })
  $('crmUrl').value = origin
  setStatus('ok', 'Guardado.')
  return true
}

async function test() {
  if (!(await save())) return
  const { crmUrl, token } = await chrome.storage.local.get(['crmUrl', 'token'])
  try {
    const res = await fetch(`${crmUrl}/api/imports/extension`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setStatus('ok', 'Conexión OK — ya podés usar el botón en Amazon.')
    else if (res.status === 401) setStatus('error', 'El CRM rechazó el token.')
    else setStatus('error', `El CRM respondió con error ${res.status}.`)
  } catch {
    setStatus('error', 'No se pudo conectar con el CRM.')
  }
}

$('save').addEventListener('click', save)
$('test').addEventListener('click', test)
load()
