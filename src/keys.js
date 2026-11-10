const namedKeys = {
  ArrowUp: [38, 65535],
  ArrowDown: [40, 65535],
  ArrowLeft: [37, 65535],
  ArrowRight: [39, 65535],
  Enter: [10, 10],
  F1: [112, 65535],
  F2: [113, 65535],
  '*': [56, 42],
  '#': [51, 35],
}

export function phoneKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (event.key === ' ') return 'Enter'
  if (event.key.toLowerCase() === 'q') return 'F1'
  if (event.key.toLowerCase() === 'e') return 'F2'
  return keyCodes(event.key) ? event.key : null
}

export function keyCodes(key) {
  if (/^[0-9]$/.test(key)) return [96 + Number(key), key.charCodeAt(0)]
  return Object.hasOwn(namedKeys, key) ? namedKeys[key] : null
}
