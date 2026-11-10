import { defaultScreen, maxJadSize, maxJarSize, midletEntry, readJad, readManifest, screenSizes, zipEntry } from './midlet-files.js'

let database

function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('microemu-games', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('games', { keyPath: 'id' })
      request.result.createObjectStore('jars')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error) => {
    database = null
    throw error
  })
  return database
}

async function transaction(stores, mode, action) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    const request = action(tx)
    tx.oncomplete = () => resolve(request?.result)
    tx.onabort = () => reject(tx.error)
  })
}

export async function listGames() {
  const games = await transaction('games', 'readonly', (tx) => tx.objectStore('games').getAll())
  return games.sort((a, b) => b.addedAt - a.addedAt).map((game) => ({
    ...game, tabName: game.tabName ?? game.name, screenSize: game.screenSize ?? defaultScreen,
  }))
}

function pickedFiles(files) {
  const jar = files.find((file) => /\.jar$/i.test(file.name))
  const jad = files.find((file) => /\.jad$/i.test(file.name))
  if (files.length !== Number(Boolean(jar)) + Number(Boolean(jad))) {
    throw new Error('Chọn một tệp JAR và tối đa một tệp JAD.')
  }
  return { jar, jad }
}

function unpackFiles(files) {
  // Earlier versions stored a single File in this store.
  return files instanceof Blob ? { jar: files, jad: null } : files
}

export async function listSavedFiles() {
  const items = []
  await transaction('jars', 'readonly', (tx) => {
    const request = tx.objectStore('jars').openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const { jar, jad } = unpackFiles(cursor.value)
      if (jar) items.push({ id: cursor.key, jarName: jar.name, jadName: jad?.name })
      cursor.continue()
    }
  })
  return items.sort((a, b) => a.jarName.localeCompare(b.jarName, 'vi'))
}

function tabSettings(tabName, screenSize) {
  const label = tabName.trim()
  if (!label || label.length > 48) throw new Error('Tên tab cần có từ 1 đến 48 ký tự.')
  if (!Object.hasOwn(screenSizes, screenSize)) throw new Error('Kích thước màn hình không hợp lệ.')
  return { tabName: label, screenSize }
}

export async function addGame({ tabName, files, savedFileId, screenSize }) {
  const settings = tabSettings(tabName, screenSize)
  const { jar, jad } = savedFileId ? await gameFiles(savedFileId) : pickedFiles(files)
  if (!jar || !/\.jar$/i.test(jar.name)) throw new Error('Hãy chọn tệp JAR của trò chơi.')
  if (jar.size > maxJarSize) throw new Error('Tệp JAR vượt quá giới hạn 25 MB.')
  if (jad && (!/\.jad$/i.test(jad.name) || jad.size > maxJadSize)) {
    throw new Error('Tệp JAD cần có đuôi .jad và dung lượng tối đa 128 KB.')
  }
  const bytes = new Uint8Array(await jar.arrayBuffer())
  const manifest = readManifest(bytes)
  const descriptor = jad ? readJad(await jad.text()) : null
  const jadEntry = descriptor?.get('midlet-1')
  const midlet = midletEntry(manifest) ?? (jadEntry && midletEntry(jadEntry.join(': ')))
  if (!midlet) throw new Error('Tệp JAR hoặc JAD cần khai báo MIDlet-1.')

  const suite = manifest.match(/^MIDlet-Name:[ \t]*([^\r\n]+)/im)?.[1].trim() ?? descriptor?.get('midlet-name')?.[1].trim()
  const name = suite?.replace(/\s+MIDlet Suite$/i, '') || midlet[1].trim() || jar.name.replace(/\.jar$/i, '')
  const iconPath = midlet[2].trim().replace(/^\/+/, '')
  let icon
  if (/\.png$/i.test(iconPath)) {
    try {
      const image = zipEntry(bytes, iconPath, 128 * 1024)
      if (image) icon = new Blob([image], { type: 'image/png' })
    } catch {
      // The game can still be listed if its optional icon is unreadable.
    }
  }

  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const game = { id, sourceId: savedFileId || id, name, icon, addedAt: Date.now(), ...settings }
  const retainedSource = await transaction(['games', 'jars'], 'readwrite', (tx) => {
    const games = tx.objectStore('games')
    const jars = tx.objectStore('jars')
    if (savedFileId) {
      const source = jars.getKey(savedFileId)
      source.onsuccess = () => {
        if (source.result !== undefined) games.add(game)
      }
      return source
    }
    games.add(game)
    jars.add({ jar, jad }, id)
  })
  if (savedFileId && retainedSource === undefined) throw new Error('Tệp đã được xoá. Hãy chọn tệp khác.')
  return game
}

export async function updateGameSettings(id, { tabName, screenSize }) {
  const settings = tabSettings(tabName, screenSize)
  let updated
  await transaction('games', 'readwrite', (tx) => {
    const games = tx.objectStore('games')
    const request = games.get(id)
    request.onsuccess = () => {
      if (!request.result) return
      updated = { ...request.result, ...settings }
      games.put(updated)
    }
  })
  if (!updated) throw new Error('Tab này đã được xoá.')
  return updated
}

export async function deleteGame(id) {
  await transaction(['games', 'jars'], 'readwrite', (tx) => {
    const games = tx.objectStore('games')
    const request = games.getAll()
    request.onsuccess = () => {
      const tab = request.result.find((game) => game.id === id)
      if (!tab) return
      const sourceId = tab.sourceId ?? tab.id
      games.delete(id)
      const shared = request.result.some((game) => game.id !== id && (game.sourceId ?? game.id) === sourceId)
      if (!shared) tx.objectStore('jars').delete(sourceId)
    }
  })
}

export async function gameFiles(id) {
  const files = await transaction('jars', 'readonly', (tx) => tx.objectStore('jars').get(id))
  if (!files) throw new Error('Không tìm thấy tệp JAR. Hãy tải lại tệp.')
  return unpackFiles(files)
}
