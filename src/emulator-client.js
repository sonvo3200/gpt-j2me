const sessions = new URL('api/sessions', location.href).href
const profileKey = 'microemu-browser-id'

function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function browserId() {
  let id = localStorage.getItem(profileKey)
  if (!/^[a-f0-9]{32}$/.test(id)) {
    id = newId()
    localStorage.setItem(profileKey, id)
  }
  return id
}

function request(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { 'X-MicroEmu-Client': browserId(), ...options.headers },
  })
}

function gameUrl(game, reset = false) {
  const url = new URL(sessions)
  url.searchParams.set('game', game)
  if (reset) url.searchParams.set('reset', '1')
  return url
}

async function responseError(response) {
  const data = await response.json().catch(() => null)
  return new Error(data?.error || 'Không kết nối được máy chủ giả lập.')
}

export async function listRunningGames(signal) {
  const response = await request(sessions, { signal })
  if (!response.ok) throw await responseError(response)
  return (await response.json()).map(({ game }) => game)
}

export async function stopGame(game) {
  const response = await request(gameUrl(game), { method: 'DELETE', keepalive: true })
  if (!response.ok) throw await responseError(response)
}

export function playJar(game, loadFiles, { reset, screenSize, onFrame, onError }) {
  const abort = new AbortController()
  const { signal } = abort
  const controllerHeaders = { 'X-MicroEmu-Controller': newId() }
  let sessionUrl = null
  let inputQueue = Promise.resolve()
  let pendingKeys = 0

  function release() {
    if (sessionUrl) {
      void request(sessionUrl + '/release', {
        method: 'POST', headers: controllerHeaders, keepalive: true,
      }).catch(() => {})
    }
  }

  function detach() {
    if (signal.aborted) return
    abort.abort()
    release()
  }

  function fail(error) {
    if (signal.aborted) return
    detach()
    onError(error)
  }

  async function findActive() {
    const response = await request(gameUrl(game), { signal })
    if (!response.ok) throw await responseError(response)
    return (await response.json())[0]
  }

  async function run() {
    try {
      const active = reset ? null : await findActive()
      const restart = reset || Boolean(active && active.screenSize !== screenSize)
      let id = restart ? null : active?.id
      if (!id) {
        const { jar, jad } = await loadFiles()
        if (signal.aborted) return
        const body = new FormData()
        body.set('jar', jar)
        if (jad) body.set('jad', jad)
        body.set('screenSize', screenSize)
        const created = await request(gameUrl(game, restart), { method: 'POST', body, signal })
        if (!created.ok) throw await responseError(created)
        const started = await created.json()
        id = started.id
      }
      sessionUrl = sessions + '/' + id

      let sequence = 0
      while (!signal.aborted) {
        const response = await request(sessionUrl + '/frame?after=' + sequence, {
          headers: controllerHeaders, signal,
        })
        if (response.status === 404) {
          const nextId = (await findActive())?.id
          if (nextId && nextId !== id) {
            id = nextId
            sessionUrl = sessions + '/' + id
            sequence = 0
            continue
          }
        }
        if (!response.ok) throw await responseError(response)
        if (response.status !== 204) {
          sequence = Number(response.headers.get('X-Frame-Sequence'))
          const frame = await createImageBitmap(await response.blob())
          try {
            if (!signal.aborted) onFrame(frame)
          } finally {
            frame.close()
          }
        }
        if (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, 65))
      }
    } catch (error) {
      fail(error)
    }
  }

  function sendKey(key, down, repeat = false) {
    if (!sessionUrl || signal.aborted || (repeat && pendingKeys > 1)) return
    pendingKeys += 1
    inputQueue = inputQueue.then(async () => {
      if (signal.aborted) return
      const response = await request(sessionUrl + '/key', {
        method: 'POST',
        headers: { ...controllerHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, down }),
        signal,
      })
      if (!response.ok && response.status !== 404) throw await responseError(response)
    }).catch(fail).finally(() => { pendingKeys -= 1 })
  }

  void run()
  return { detach, release, sendKey }
}
