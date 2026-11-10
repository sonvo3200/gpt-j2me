import React from 'react'

const paths = {
  upload: <><path d="M12 15V4m-4 4 4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></>,
  back: <path d="M19 12H5m6 6-6-6 6-6"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  reset: <path d="M4 11a8 8 0 1 1 2 6m-2-6V5m0 6h6"/>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  arrow: <path d="M12 19V5m-5 5 5-5 5 5"/>,
  keyboard: <><rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M6.5 9.5h.01m3.65 0h.01m3.65 0h.01m3.65 0h.01M6.5 13.5h.01m3.65 0h7.35"/></>,
  settings: <><path d="m10 3-.7 2.4-2 .9-2.3-1-2 3.4 1.7 1.8v2.9L3 15.2l2 3.5 2.3-1 2 .9L10 21h4l.7-2.4 2-.9 2.3 1 2-3.5-1.7-1.8v-2.9L21 8.7l-2-3.4-2.3 1-2-.9L14 3z"/><circle cx="12" cy="12" r="2.8"/></>,
  trash: <path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>,
  game: <><rect x="3" y="6" width="18" height="12" rx="5"/><path d="M7 12h5m-2.5-2.5v5m6-3.5h.01m2.5 2h.01"/></>,
}

export function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
