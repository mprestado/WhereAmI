export type OverlayMode = 'expanded' | 'collapsed'

type DesktopWindow = Window & {
  __TAURI__?: { core?: { invoke<T = void>(command: string, args?: Record<string, string>): Promise<T> } }
}

function desktopCore() {
  return /Windows/i.test(navigator.userAgent) ? (window as DesktopWindow).__TAURI__?.core : undefined
}

export function hasTaskOverlay() {
  return Boolean(desktopCore())
}

export async function readTaskOverlay(): Promise<OverlayMode> {
  const mode = await desktopCore()?.invoke<string>('get_task_overlay')
  return mode === 'collapsed' ? 'collapsed' : 'expanded'
}

export async function openTaskOverlay() {
  const core = desktopCore()
  if (!core) throw new Error('The task overlay is available in the Windows app.')
  await core.invoke('open_task_overlay')
}

export async function setTaskOverlay(mode: OverlayMode) {
  await desktopCore()?.invoke('set_task_overlay', { mode })
}

export async function closeTaskOverlay() {
  await desktopCore()?.invoke('close_task_overlay')
}

export async function showMainWindow() {
  await desktopCore()?.invoke('show_main_window')
}

export async function dragTaskOverlay() {
  await desktopCore()?.invoke('drag_task_overlay')
}

export async function resizeTaskOverlay() {
  await desktopCore()?.invoke('plugin:window|start_resize_dragging', { value: 'SouthWest' })
}
