import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Icon } from './icons.jsx'
import { phoneKey } from './keys.js'
import { listRunningGames, playJar, stopGame } from './emulator-client.js'
import { addGame, deleteGame, gameFiles, listGames, updateGameSettings } from './games.js'
import { TabDialog } from './TabDialog.jsx'
import { screenSizes } from './midlet-files.js'
import './styles.css'

const directions = [
  ['ArrowUp', 'Lên', 'up'], ['ArrowLeft', 'Trái', 'left'],
  ['Enter', 'Chọn', 'center'], ['ArrowRight', 'Phải', 'right'], ['ArrowDown', 'Xuống', 'down'],
]

function GameIcon({ icon }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (!icon) return
    const url = URL.createObjectURL(icon)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [icon])

  return (
    <span className="game-icon" aria-hidden="true">
      {src ? <img src={src} alt="" /> : <Icon name="game" size={23}/>}
    </span>
  )
}

function Home({ games, runningGames, onPlay, onUpload, onSettings, error }) {
  return (
    <main className="home">
      <header className="home-header">
        <h1>Trò chơi Java ME</h1>
        <button className="upload" type="button" onClick={onUpload}>
          <Icon name="upload" size={18}/> Upload
        </button>
      </header>

      {error && <p className="home-error" role="alert">{error}</p>}
      <ul className="games" aria-label="Trò chơi đã tải lên">
        {games.map((game) => (
          <li className="game-item" key={game.id}>
            <button className="game-row" type="button" onClick={() => onPlay(game)}>
              <GameIcon key={game.addedAt} icon={game.icon}/>
              <span className="game-details"><strong>{game.tabName}</strong><small>{game.name}</small></span>
              {runningGames.has(game.id) && (
                <span className="running-dot" role="img" aria-label="Đang chạy nền" title="Đang chạy nền"/>
              )}
              <span className="game-open"><Icon name="chevron" size={18}/></span>
            </button>
            <button type="button" className="game-settings" title="Cài đặt tab"
              aria-label={'Cài đặt tab ' + game.tabName} onClick={() => onSettings(game)}>
              <Icon name="settings" size={17}/>
            </button>
          </li>
        ))}
        {games.length === 0 && <li className="empty">Chưa có trò chơi.</li>}
      </ul>
    </main>
  )
}

function Controller({ game, screen, phase, error, closing, closeError, onBack, onReset, onClose, sendKey, releaseKeys, activeKeys }) {
  const [keyboardVisible, setKeyboardVisible] = useState(true)
  const [width, height] = screenSizes[game.screenSize]
  const keyProps = (key) => ({
    type: 'button',
    disabled: phase !== 'running',
    'data-pressed': activeKeys.has(key),
    onPointerDown(event) {
      if (event.button !== 0 || phase !== 'running') return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      sendKey(key, true)
    },
    onPointerUp: () => sendKey(key, false),
    onPointerCancel: () => sendKey(key, false),
    onLostPointerCapture: () => sendKey(key, false),
    onClick(event) {
      if (event.detail === 0) {
        sendKey(key, true)
        sendKey(key, false)
      }
    },
  })

  return (
    <main className="controller" aria-label="Trang điều khiển">
      <nav className="toolbar" aria-label="Điều khiển phiên">
        <div className="toolbar-start">
          <button className="toolbar-button" type="button" disabled={closing} onClick={onBack}><Icon name="back" size={19}/> Quay lại</button>
          <span className="tab-title" title={game.tabName}>{game.tabName}</span>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="toolbar-button keyboard-toggle" aria-label="Bàn phím ảo"
            aria-expanded={keyboardVisible} aria-controls="virtual-keys"
            title={keyboardVisible ? 'Ẩn bàn phím ảo' : 'Hiện bàn phím ảo'} onClick={() => {
              if (keyboardVisible) releaseKeys()
              setKeyboardVisible(!keyboardVisible)
            }}><Icon name="keyboard" size={19}/></button>
          <button className="toolbar-button" type="button" disabled={closing || phase === 'starting'} onClick={onReset}><Icon name="reset" size={19}/> Reset</button>
          <button className="toolbar-button close-button" type="button" disabled={closing || phase === 'starting'} onClick={onClose}><Icon name="close" size={19}/> Đóng</button>
        </div>
      </nav>

      {closeError && <p className="home-error" role="alert">{closeError}</p>}
      <div className={width > height ? "play-area landscape" : "play-area"}>
        <div className="screen-shell">
          <canvas ref={screen} width={width} height={height} role="img" aria-label="Màn hình trò chơi"/>
          {phase !== 'running' && (
            <div className="screen-status" role={error ? 'alert' : 'status'}>
              {phase === 'starting' && <span className="spinner" aria-hidden="true"/>}
              <strong>{error ? 'Không mở được trò chơi' : 'Đang mở trò chơi…'}</strong>
              {error && <span>{error}</span>}
            </div>
          )}
        </div>
        <div className="virtual-keys" id="virtual-keys" data-mobile-hidden={!keyboardVisible} role="group" aria-label="Phím ảo">
          <button className="soft-key" aria-label="Phím mềm trái (Q)" title="Phím mềm trái (Q)" {...keyProps('F1')}><span/></button>
          <div className="dpad">
            {directions.map(([key, label, place]) => (
              <button className={'direction ' + place} key={key} aria-label={label} title={label} {...keyProps(key)}>
                {place === 'center' ? 'OK' : <Icon name="arrow" size={19}/>}
              </button>
            ))}
          </div>
          <button className="soft-key" aria-label="Phím mềm phải (E)" title="Phím mềm phải (E)" {...keyProps('F2')}><span/></button>
        </div>
      </div>
    </main>
  )
}

function App() {
  const [games, setGames] = useState([])
  const [runningGames, setRunningGames] = useState(new Set())
  const [selected, setSelected] = useState(null)
  const [phase, setPhase] = useState('starting')
  const [dialog, setDialog] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [listError, setListError] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [playError, setPlayError] = useState(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState(null)
  const [activeKeys, setActiveKeys] = useState(new Set())
  const screen = useRef(null)
  const session = useRef(null)
  const generation = useRef(0)
  const held = useRef(new Set())

  function detachSession() {
    generation.current += 1
    session.current?.detach()
    session.current = null
  }

  useEffect(() => {
    let cancelled = false
    listGames().then((items) => { if (!cancelled) setGames(items) }).catch(() => {
      if (!cancelled) setListError('Không đọc được danh sách trò chơi trên trình duyệt này.')
    })
    function pagehide(event) {
      if (event.persisted) {
        session.current?.release()
        clearKeys()
      } else detachSession()
    }
    window.addEventListener('pagehide', pagehide)
    return () => {
      cancelled = true
      window.removeEventListener('pagehide', pagehide)
      detachSession()
    }
  }, [])

  useEffect(() => {
    if (selected) return
    const abort = new AbortController()
    let timer
    async function refresh() {
      try {
        const active = await listRunningGames(abort.signal)
        if (!abort.signal.aborted) setRunningGames(new Set(active))
      } catch {
        if (!abort.signal.aborted) setRunningGames(new Set())
      }
      if (!abort.signal.aborted) timer = setTimeout(refresh, 1500)
    }
    void refresh()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [selected])

  function clearKeys() {
    held.current.clear()
    setActiveKeys(new Set())
  }

  function releaseKeys() {
    for (const key of held.current) session.current?.sendKey(key, false)
    clearKeys()
  }

  function sendKey(key, down, repeat = false) {
    if (phase !== 'running' || !session.current) return
    if (!repeat && held.current.has(key) === down) return
    if (down) held.current.add(key)
    else held.current.delete(key)
    if (!repeat) setActiveKeys(new Set(held.current))
    session.current.sendKey(key, down, repeat)
  }

  useEffect(() => {
    if (!selected || phase !== 'running') return
    function keyboard(event) {
      if (event.target.closest?.('button') && [' ', 'Enter'].includes(event.key)) return
      const key = phoneKey(event)
      if (!key) return
      event.preventDefault()
      sendKey(key, event.type === 'keydown', event.repeat)
    }
    window.addEventListener('keydown', keyboard)
    window.addEventListener('keyup', keyboard)
    window.addEventListener('blur', releaseKeys)
    return () => {
      window.removeEventListener('keydown', keyboard)
      window.removeEventListener('keyup', keyboard)
      window.removeEventListener('blur', releaseKeys)
    }
  }, [selected, phase])

  function showDialog(game = null) {
    setUploadError(null)
    setDialog({ game })
  }

  async function saveTab(details) {
    const editing = dialog?.game
    setUploadError(null)
    setUploading(true)
    try {
      const game = editing ? await updateGameSettings(editing.id, details) : await addGame(details)
      setGames((items) => editing ? items.map((item) => item.id === game.id ? game : item) : [game, ...items])
      setDialog(null)
      openGame(game, Boolean(editing && editing.screenSize !== game.screenSize))
    } catch (error) {
      setUploadError(error.message || 'Không lưu được trò chơi.')
    } finally {
      setUploading(false)
    }
  }

  async function removeTab() {
    const game = dialog?.game
    if (!game) return
    setUploadError(null)
    setUploading(true)
    try {
      await stopGame(game.id)
      await deleteGame(game.id)
      setGames((items) => items.filter((item) => item.id !== game.id))
      setRunningGames((items) => {
        const next = new Set(items)
        next.delete(game.id)
        return next
      })
      setDialog(null)
    } catch (error) {
      setUploadError(error.message || 'Không xoá được tab này.')
    } finally {
      setUploading(false)
    }
  }

  function openGame(game, reset = false) {
    detachSession()
    const current = generation.current
    clearKeys()
    setCloseError(null)
    setPlayError(null)
    setPhase('starting')
    setSelected(game)

    session.current = playJar(game.id, () => gameFiles(game.sourceId ?? game.id), {
      reset,
      screenSize: game.screenSize,
      onFrame(frame) {
        if (current !== generation.current) return
        screen.current?.getContext('2d').drawImage(frame, 0, 0)
        setRunningGames((items) => items.has(game.id) ? items : new Set([...items, game.id]))
        setPhase('running')
      },
      onError(error) {
        if (current !== generation.current) return
        session.current = null
        clearKeys()
        setPlayError(error.message)
        setPhase('error')
      },
    })
  }

  function goBack() {
    detachSession()
    clearKeys()
    setSelected(null)
  }

  async function closeGame() {
    if (!selected || closing) return
    setClosing(true)
    setCloseError(null)
    try {
      await stopGame(selected.id)
      setRunningGames((items) => {
        const next = new Set(items)
        next.delete(selected.id)
        return next
      })
      goBack()
    } catch (error) {
      setCloseError(error.message)
    } finally {
      setClosing(false)
    }
  }

  return selected
    ? <Controller game={selected} screen={screen} phase={phase} error={playError} closing={closing} closeError={closeError} onBack={goBack}
        onReset={() => openGame(selected, true)} onClose={closeGame} sendKey={sendKey} releaseKeys={releaseKeys} activeKeys={activeKeys}/>
    : <>
        <Home games={games} runningGames={runningGames} onPlay={openGame} error={listError}
          onUpload={() => showDialog()} onSettings={showDialog}/>
        {dialog && <TabDialog games={games} editing={dialog.game} busy={uploading} error={uploadError}
          onClose={() => setDialog(null)} onSave={saveTab} onDelete={removeTab}/>}
      </>
}

createRoot(document.querySelector('#root')).render(<App />)
