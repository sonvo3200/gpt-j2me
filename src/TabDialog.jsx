import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { listSavedFiles } from './games.js'
import { defaultScreen, screenSizes } from './midlet-files.js'

function fileLabel(file) {
  return file.jadName ? file.jarName + ' + ' + file.jadName : file.jarName
}

export function TabDialog({ games, editing, busy, error, onClose, onSave, onDelete }) {
  const dialog = useRef(null)
  const upload = useRef(null)
  const cancelDelete = useRef(null)
  const [confirming, setConfirming] = useState(false)
  const [tabName, setTabName] = useState(editing?.tabName ?? '')
  const [files, setFiles] = useState([])
  const [savedFileId, setSavedFileId] = useState('')
  const [savedFiles, setSavedFiles] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [screenSize, setScreenSize] = useState(editing?.screenSize ?? defaultScreen)

  useEffect(() => {
    dialog.current.showModal()
    if (editing) return
    let cancelled = false
    listSavedFiles().then((items) => {
      if (!cancelled) setSavedFiles(items)
    }).catch(() => {
      if (!cancelled) setLoadError(true)
    })
    return () => { cancelled = true }
  }, [editing])

  useEffect(() => {
    if (confirming) cancelDelete.current.focus()
  }, [confirming])

  function dismiss() {
    if (busy) return
    if (confirming) setConfirming(false)
    else onClose()
  }

  const savedPlaceholder = loadError ? 'Không đọc được tệp đã lưu'
    : savedFiles === null ? 'Đang đọc tệp đã lưu…'
    : savedFiles.length ? 'Chọn tệp đã upload' : 'Chưa có tệp đã upload'

  return (
    <dialog className="tab-dialog" ref={dialog} aria-labelledby="tab-dialog-title" onCancel={(event) => {
      event.preventDefault()
      dismiss()
    }}>
      {confirming ? (
        <div className="delete-confirmation">
          <div className="dialog-header">
            <h2 id="tab-dialog-title">Xoá tab này?</h2>
          </div>
          <p>Tab <strong>{editing.tabName}</strong> sẽ bị xoá vĩnh viễn cùng dữ liệu riêng. Nếu đang chạy, phiên của tab sẽ dừng.</p>
          {error && <p className="home-error" role="alert">{error}</p>}
          <div className="confirmation-actions">
            <button ref={cancelDelete} type="button" className="toolbar-button" disabled={busy} onClick={dismiss}>Huỷ</button>
            <button type="button" className="toolbar-button confirm-delete" disabled={busy} onClick={onDelete}>
              {busy ? 'Đang xoá…' : 'Xoá tab'}
            </button>
          </div>
        </div>
      ) : <form onSubmit={(event) => {
        event.preventDefault()
        if (!busy) onSave({ tabName, files, savedFileId, screenSize })
      }}>
        <div className="dialog-header">
          <h2 id="tab-dialog-title">{editing ? 'Cài đặt tab' : 'Tạo tab mới'}</h2>
          <button className="dialog-close" type="button" aria-label="Đóng modal" disabled={busy} onClick={onClose}><Icon name="close" size={20}/></button>
        </div>
        <label className="dialog-field">
          <strong>Tên tab</strong>
          <input type="text" placeholder="Ví dụ: Ninja sáng" autoFocus required maxLength={48}
            value={tabName} disabled={busy} onChange={(event) => setTabName(event.target.value)}/>
        </label>
        {!editing && <>
        <div className="dialog-field">
          <label htmlFor="tab-upload"><strong>Upload</strong></label>
          <input id="tab-upload" className="file-input" ref={upload} type="file" accept=".jar,.jad" multiple
            disabled={busy} aria-describedby="tab-upload-note" onChange={(event) => {
              const chosen = Array.from(event.target.files)
              setFiles(chosen)
              if (chosen.length) setSavedFileId('')
            }}/>
          <small className="field-note" id="tab-upload-note">Chọn JAR, kèm JAD nếu có.</small>
        </div>
        <label className="dialog-field">
          <strong>Chọn file đã có</strong>
          <select value={savedFileId} disabled={busy || !savedFiles?.length} onChange={(event) => {
            setSavedFileId(event.target.value)
            if (event.target.value) {
              upload.current.value = ''
              setFiles([])
            }
          }}>
            <option value="">{savedPlaceholder}</option>
            {savedFiles?.map((file) => {
              const label = fileLabel(file)
              const duplicate = savedFiles.some((other) => other.id !== file.id && fileLabel(other) === label)
              const sourceTab = games.find((game) => game.id === file.id)
              const suffix = duplicate ? ' · ' + (sourceTab?.tabName || String(file.id).slice(-6)) : ''
              return <option key={file.id} value={file.id}>{label + suffix}</option>
            })}
          </select>
        </label>
        </>}
        <label className="dialog-field">
          <strong>Kích thước màn hình</strong>
          <select value={screenSize} disabled={busy} onChange={(event) => setScreenSize(event.target.value)}>
            {Object.entries(screenSizes).map(([size, [width, height]]) => (
              <option key={size} value={size}>{width} × {height}</option>
            ))}
          </select>
        </label>
        {error && <p className="home-error" role="alert">{error}</p>}
        <button type="submit" className="upload launch-button" disabled={busy || (!editing && !files.length && !savedFileId) || !tabName.trim()}>
          {busy ? 'Đang lưu…' : 'Lưu và khởi chạy'}
        </button>
        {editing && (
          <button type="button" className="delete-tab-button" disabled={busy} onClick={() => setConfirming(true)}>
            <Icon name="trash" size={17}/> Xoá tab này
          </button>
        )}
      </form>}
    </dialog>
  )
}
