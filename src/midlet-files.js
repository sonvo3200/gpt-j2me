import { strFromU8, unzipSync } from 'fflate'

export const maxJarSize = 25 * 1024 * 1024
export const maxJadSize = 128 * 1024
export const defaultScreen = '240x320'
export const screenSizes = {
  '176x220': [176, 220],
  '240x320': [240, 320],
  '320x240': [320, 240],
  '320x480': [320, 480],
}

export function zipEntry(bytes, path, limit) {
  let found = false
  return unzipSync(bytes, {
    filter: ({ name, originalSize }) => {
      if (found || name !== path || originalSize > limit) return false
      found = true
      return true
    },
  })[path]
}

export function readManifest(bytes) {
  let entry
  try {
    entry = zipEntry(bytes, 'META-INF/MANIFEST.MF', 128 * 1024)
  } catch {
    throw new Error('Không đọc được tệp JAR.')
  }
  if (!entry) throw new Error('Tệp JAR thiếu manifest Java ME.')
  return strFromU8(entry).replace(/\r?\n /g, '').split(/\r?\n\r?\n/, 1)[0]
}

export function midletEntry(text) {
  return text?.match(/^MIDlet-1:[ \t]*([^,\r\n]*),([^,\r\n]*),[ \t]*\S+/im)
}

export function readJad(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?|\n/g, '\n').replace(/\n /g, '').split('\n')
  const fields = new Map()
  for (const line of lines) {
    if (!line.trim()) break
    const match = /^([A-Za-z0-9_-]{1,70}):[ \t]*([^\u0000-\u0008\u000b-\u001f]*)$/.exec(line)
    if (!match) throw new Error('Tệp JAD có thuộc tính không hợp lệ.')
    fields.set(match[1].toLowerCase(), [match[1], match[2]])
  }
  if (!fields.size) throw new Error('Tệp JAD không có thuộc tính Java ME.')
  return fields
}
