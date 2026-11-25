import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/manrope'
import './styles.css'
import { hasTaskOverlay } from './desktopOverlay'

const overlay = hasTaskOverlay() && window.location.hash === '#task-overlay'
const app = overlay ? import('./OverlayWindow') : import('./App')
void app.then(({ default: WindowContent }) => {
  createRoot(document.getElementById('root')!).render(<StrictMode><WindowContent /></StrictMode>)
})
