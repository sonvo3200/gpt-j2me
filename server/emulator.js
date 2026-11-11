import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defaultScreen, maxJadSize, maxJarSize, midletEntry, readJad, readManifest, screenSizes } from '../src/midlet-files.js'
import { keyCodes } from '../src/keys.js'

const root = dirname(fileURLToPath(import.meta.url))
const engine = join(root, 'runtime/microemulator.jar')
const player = join(root, 'runtime/server-player.jar')
const scratch = join(root, '../.sessions')
const maxSessions = 2
const startupTimeout = 20_000
const keyLease = 2500
const errorRetention = 60_000
const clientId = /^[a-f0-9]{32}$/

class RequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function respond(res, status, data) {
  res.setHeader('Cache-Control', 'no-store')
  if (data === undefined) return res.writeHead(status).end()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.writeHead(status).end(JSON.stringify(data))
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  if (Number(req.headers['content-length']) > limit) {
    req.resume()
    throw new RequestError(413, 'Dữ liệu gửi lên vượt quá giới hạn.')
  }
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > limit) {
      req.resume()
      throw new RequestError(413, 'Dữ liệu gửi lên vượt quá giới hạn.')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

async function readLaunch(req) {
  const contentType = req.headers['content-type']
  let bytes
  let jad = null
  let screenSize = defaultScreen

  if (contentType === 'application/java-archive') {
    bytes = await readBody(req, maxJarSize)
  } else if (contentType?.startsWith('multipart/form-data;')) {
    const body = await readBody(req, maxJarSize + maxJadSize + 8192)
    let form
    try {
      form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData()
    } catch {
      throw new RequestError(400, 'Không đọc được dữ liệu tải lên.')
    }
    const file = form.get('jar')
    const descriptor = form.get('jad')
    screenSize = form.get('screenSize')
    if (!(file instanceof Blob) || !/\.jar$/i.test(file.name ?? '')) {
      throw new RequestError(400, 'Hãy gửi tệp JAR của trò chơi.')
    }
    if (file.size > maxJarSize) throw new RequestError(413, 'Tệp JAR vượt quá giới hạn 25 MB.')
    if (descriptor !== null && (!(descriptor instanceof Blob) || !/\.jad$/i.test(descriptor.name ?? '') || descriptor.size > maxJadSize)) {
      throw new RequestError(400, 'Tệp JAD không hợp lệ.')
    }
    bytes = new Uint8Array(await file.arrayBuffer())
    jad = descriptor ? await descriptor.text() : null
  } else {
    throw new RequestError(415, 'Vui lòng gửi một tệp JAR.')
  }

  if (typeof screenSize !== 'string' || !Object.hasOwn(screenSizes, screenSize)) {
    throw new RequestError(400, 'Kích thước màn hình không hợp lệ.')
  }

  let descriptor = null
  try {
    const manifest = readManifest(bytes)
    const fields = jad === null ? null : readJad(jad)
    const jadEntry = fields?.get('midlet-1')
    if (!midletEntry(manifest) && !(jadEntry && midletEntry(jadEntry.join(': ')))) {
      throw new Error('Tệp JAR hoặc JAD cần khai báo MIDlet-1.')
    }
    if (fields) {
      fields.set('midlet-jar-url', ['MIDlet-Jar-URL', 'midlet.jar'])
      fields.set('midlet-jar-size', ['MIDlet-Jar-Size', String(bytes.length)])
      descriptor = [...fields.values()].map((field) => field.join(': ')).join('\r\n') + '\r\n'
    }
  } catch (error) {
    throw new RequestError(400, error.message)
  }
  return { bytes, descriptor, screenSize, dimensions: screenSizes[screenSize] }
}

export function microemuServer() {
  const sessions = new Map()
  const pending = new Set()

  function findSession(owner, game) {
    return [...sessions.values()].find((session) => session.owner === owner && session.game === game)
  }

  function writeKey(session, key, down) {
    session.child.stdin.write((down ? 'down ' : 'up ') + keyCodes(key).join(' ') + '\n')
  }

  function writePointer(session, type, x, y) {
    session.child.stdin.write(`pointer ${type} ${x} ${y}\n`)
  }

  function releaseKeys(session) {
    if (!session.input) return
    for (const key of session.input.held) writeKey(session, key, false)
    session.input = null
  }

  function failSession(session, message) {
    if (session.error !== null) return
    session.error = message || 'Không khởi động được MicroEmulator.'
    session.failedAt = Date.now()
    session.child.kill('SIGKILL')
  }

  function stop(id) {
    const session = sessions.get(id)
    if (!session) return
    sessions.delete(id)
    session.child.kill('SIGKILL')
    return session.cleaned
  }

  async function openSession({ bytes, descriptor, screenSize, dimensions }, owner, game, previous) {
    await mkdir(scratch, { recursive: true, mode: 0o700 })
    const directory = await mkdtemp(join(scratch, 'midlet-'))
    const jar = join(directory, 'midlet.jar')
    try {
      await writeFile(jar, bytes, { mode: 0o600, flag: 'wx' })
      const entry = descriptor === null ? jar : join(directory, 'midlet.jad')
      if (descriptor !== null) await writeFile(entry, descriptor, { mode: 0o600, flag: 'wx' })
      if (previous) await stop(previous.id)
      const id = randomUUID()
      const child = spawn('java', [
        '-Xmx128m', '-XX:ActiveProcessorCount=2', '-Djava.awt.headless=true',
        '-Djava.security.manager=default', '-Djava.security.policy==' + join(root, 'player.policy'),
        '-Dmicroemu.runner=' + pathToFileURL(player).href, '-Dmicroemu.engine=' + pathToFileURL(engine).href,
        '-Duser.home=' + directory, '-Djava.io.tmpdir=' + directory,
        '-cp', [player, engine].join(delimiter), 'studio.ServerPlayer', entry, ...dimensions.map(String),
      ], {
        cwd: directory,
        env: { PATH: process.env.PATH, HOME: directory, LANG: 'C.UTF-8' },
        stdio: ['pipe', 'pipe', 'ignore'],
      })
      const session = { id, owner, game, screenSize, child, frame: null, sequence: 0, error: null, started: Date.now(), input: null }
      sessions.set(id, session)
      child.stdin.on('error', () => {})
      child.on('error', () => failSession(session, 'Không khởi động được Java trên máy chủ.'))
      session.cleaned = new Promise((resolve) => {
        child.once('close', async () => {
          failSession(session, 'Phiên MicroEmulator đã kết thúc.')
          await rm(directory, { recursive: true, force: true }).catch(console.error)
          resolve()
        })
      })
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (line.startsWith('FRAME ') && line.length <= 500_000) {
          session.frame = Buffer.from(line.slice(6), 'base64')
          session.sequence += 1
        } else if (line.startsWith('ERROR ')) {
          failSession(session, Buffer.from(line.slice(6, 1400), 'base64').toString('utf8').slice(0, 600))
        }
      })
      return id
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  async function route(req, res, url) {
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      throw new RequestError(403, 'Yêu cầu cần được gửi từ giao diện MicroEmu Studio.')
    }
    const owner = req.headers['x-microemu-client']
    if (!clientId.test(owner)) throw new RequestError(400, 'Thiếu mã trình duyệt.')

    if (url.pathname === '/api/sessions') {
      const game = url.searchParams.get('game')
      if (req.method === 'GET') {
        const games = [...sessions.values()]
          .filter((session) => session.owner === owner && session.error === null && (game === null || session.game === game))
          .map((session) => game === null ? { id: session.id, game: session.game }
            : { id: session.id, game: session.game, screenSize: session.screenSize })
        return respond(res, 200, games)
      }
      if (!game || game.length > 500) throw new RequestError(400, 'Thiếu mã trò chơi.')
      const slot = JSON.stringify([owner, game])
      if (pending.has(slot)) throw new RequestError(409, 'Trò chơi đang khởi động. Hãy thử lại sau.')
      const previous = findSession(owner, game)
      if (req.method === 'DELETE') {
        pending.add(slot)
        try {
          if (previous) await stop(previous.id)
          return respond(res, 204)
        } finally {
          pending.delete(slot)
        }
      }
      if (req.method !== 'POST') throw new RequestError(405, 'Phương thức không được hỗ trợ.')
      if (previous?.error === null && url.searchParams.get('reset') !== '1') {
        req.resume()
        return respond(res, 200, { id: previous.id })
      }

      const active = [...sessions.values()].filter((session) => session.error === null && session !== previous).length
      if (pending.size + active >= maxSessions) {
        throw new RequestError(503, 'Máy chủ tạm đã đủ phiên. Hãy đóng một trò chơi rồi thử lại.')
      }

      pending.add(slot)
      try {
        const launch = await readLaunch(req)
        const id = await openSession(launch, owner, game, previous)
        if (!res.destroyed) return respond(res, 201, { id })
      } finally {
        pending.delete(slot)
      }
      return
    }

    const match = /^\/api\/sessions\/([0-9a-f-]{36})\/(frame|key|release|pointer)$/.exec(url.pathname)
    const session = match && sessions.get(match[1])
    if (!session || session.owner !== owner) throw new RequestError(404, 'Phiên giả lập đã đóng.')
    if (session.error !== null) throw new RequestError(422, session.error)
    const controller = req.headers['x-microemu-controller']
    if (!clientId.test(controller)) throw new RequestError(400, 'Thiếu mã điều khiển.')
    if (session.input?.controller === controller) session.input.touched = Date.now()
    if (match[2] === 'frame' && req.method === 'GET') {
      if (!session.frame || session.sequence <= Number(url.searchParams.get('after'))) {
        return respond(res, 204)
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': session.frame.length,
        'Cache-Control': 'no-store',
        'X-Frame-Sequence': session.sequence,
      }).end(session.frame)
      return
    }

    if (match[2] === 'release' && req.method === 'POST') {
      if (session.input?.controller === controller) releaseKeys(session)
      return respond(res, 204)
    }

    if (match[2] === 'pointer' && req.method === 'POST') {
      let command
      try {
        command = JSON.parse(await readBody(req, 128))
      } catch (error) {
        if (error instanceof RequestError) throw error
        throw new RequestError(400, 'Dữ liệu chuột không hợp lệ.')
      }
      const { type, x, y } = command || {}
      if (!['pressed', 'released', 'dragged'].includes(type) || !Number.isInteger(x) || !Number.isInteger(y)) {
        throw new RequestError(400, 'Tọa độ hoặc sự kiện chuột không hợp lệ.')
      }
      if (session.input?.controller === controller) {
        session.input.touched = Date.now()
      } else if (!session.input) {
        session.input = { controller, held: new Set(), touched: Date.now() }
      }
      writePointer(session, type, x, y)
      return respond(res, 204)
    }

    if (match[2] === 'key' && req.method === 'POST') {
      let command
      try {
        command = JSON.parse(await readBody(req, 128))
      } catch (error) {
        if (error instanceof RequestError) throw error
        throw new RequestError(400, 'Dữ liệu phím không hợp lệ.')
      }
      const key = command?.key
      if (typeof key !== 'string' || !keyCodes(key) || typeof command.down !== 'boolean') {
        throw new RequestError(400, 'Phím không hợp lệ.')
      }
      if (session.input?.controller !== controller) {
        if (!command.down) return respond(res, 204)
        releaseKeys(session)
        session.input = { controller, held: new Set(), touched: Date.now() }
      }
      if (command.down) session.input.held.add(key)
      else if (!session.input.held.delete(key)) return respond(res, 204)
      writeKey(session, key, command.down)
      return respond(res, 204)
    }
    throw new RequestError(405, 'Phương thức không được hỗ trợ.')
  }

  function configure(vite) {
    const timer = setInterval(() => {
      const now = Date.now()
      for (const [id, session] of sessions) {
        if (session.error !== null) {
          if (now - session.failedAt > errorRetention) stop(id)
          continue
        }
        if (!session.frame && now - session.started > startupTimeout) {
          failSession(session, 'MicroEmulator mất quá nhiều thời gian để mở tệp này.')
        } else if (session.input && now - session.input.touched > keyLease) {
          releaseKeys(session)
        }
      }
    }, 1000)
    timer.unref()
    vite.httpServer.once('close', () => {
      clearInterval(timer)
      for (const id of sessions.keys()) stop(id)
    })
    vite.middlewares.use((req, res, next) => {
      const url = new URL(req.url, 'http://localhost')
      if (!url.pathname.startsWith('/api/')) return next()
      route(req, res, url).catch((error) => {
        if (res.destroyed) return
        if (error instanceof RequestError) return respond(res, error.status, { error: error.message })
        console.error(error)
        respond(res, 500, { error: 'Máy chủ giả lập gặp lỗi.' })
      })
    })
  }

  return { name: 'microemu-local-server', configureServer: configure, configurePreviewServer: configure }
}
