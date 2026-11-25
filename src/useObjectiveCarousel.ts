import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type Drag = { pointerId: number; x: number; start: number; originId: string | null; active: boolean }

function slides(track: HTMLDivElement) {
  return Array.from(track.querySelectorAll<HTMLElement>('[data-objective-id]'))
}

function centerOffset(track: HTMLDivElement, slide: HTMLElement) {
  return slide.offsetLeft + (slide.offsetWidth - track.clientWidth) / 2
}

function nearestSlide(track: HTMLDivElement) {
  let nearest: HTMLElement | undefined
  let distance = Infinity
  for (const slide of slides(track)) {
    const next = Math.abs(centerOffset(track, slide) - track.scrollLeft)
    if (next < distance) {
      nearest = slide
      distance = next
    }
  }
  return nearest
}

export function useObjectiveCarousel(initialId: string | null, idSequence: string) {
  const track = useRef<HTMLDivElement>(null)
  const selected = useRef(initialId)
  const pending = useRef<string | null>(null)
  const settled = useRef(initialId)
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const [selectedId, setSelectedId] = useState(initialId)
  const [announcedId, setAnnouncedId] = useState<string | null>(null)

  function select(id: string | null) {
    selected.current = id
    setSelectedId(id)
  }

  function settle(id: string | null) {
    pending.current = null
    select(id)
    if (id !== settled.current) {
      settled.current = id
      setAnnouncedId(id)
    }
  }

  function goTo(id: string, instant = false) {
    const element = track.current
    if (!element) return
    const slide = slides(element).find(candidate => candidate.dataset.objectiveId === id)
    if (!slide) return
    const offset = centerOffset(element, slide)
    select(id)
    if (Math.abs(offset - element.scrollLeft) < 1) {
      settle(id)
      return
    }
    pending.current = id
    element.scrollTo({ left: offset, behavior: instant ? 'instant' : 'auto' })
    if (instant) settle(id)
  }

  function step(direction: -1 | 1, instant = false) {
    const element = track.current
    if (!element) return
    const items = slides(element)
    const id = pending.current ?? nearestSlide(element)?.dataset.objectiveId
    const index = items.findIndex(slide => slide.dataset.objectiveId === id)
    const target = items[index + direction]?.dataset.objectiveId
    if (target) goTo(target, instant)
  }

  useLayoutEffect(() => {
    const element = track.current
    if (!element) return
    const target = slides(element).find(slide => slide.dataset.objectiveId === selected.current)
      ?? slides(element)[0]
    if (target?.dataset.objectiveId) goTo(target.dataset.objectiveId, true)
  }, [idSequence])

  useEffect(() => {
    const element = track.current
    if (!element) return
    let frame = 0
    let fallbackTimer = 0
    let wheelDelta = 0
    let lastWheel = 0
    let lastWheelStep = -Infinity
    let previousWidth = element.clientWidth
    const supportsScrollEnd = 'onscrollend' in element
    const resize = new ResizeObserver(() => {
      if (previousWidth === element.clientWidth) return
      previousWidth = element.clientWidth
      if (selected.current) goTo(selected.current, true)
    })
    resize.observe(element)

    function onScrollEnd() {
      if (drag.current?.active) return
      const nearestId = nearestSlide(element!)?.dataset.objectiveId ?? null
      if (pending.current && pending.current !== nearestId) return
      settle(nearestId)
    }

    function onScroll() {
      if (!pending.current && !frame) {
        frame = requestAnimationFrame(() => {
          frame = 0
          if (!pending.current) select(nearestSlide(element!)?.dataset.objectiveId ?? null)
        })
      }
      if (!supportsScrollEnd) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = window.setTimeout(onScrollEnd, 140)
      }
    }

    function onWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
        if (!event.ctrlKey && !event.metaKey) pending.current = null
        return
      }
      if (event.target instanceof Element && event.target.closest('.journey-slide-content')) {
        const pane = event.target.closest('.journey-slide')!
        if (pane.scrollHeight - pane.clientHeight > 1) return
      }
      if (slides(element!).length < 2) return
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1)
      const now = performance.now()
      if (now - lastWheel > 180 || Math.sign(wheelDelta) !== Math.sign(delta)) wheelDelta = 0
      lastWheel = now
      wheelDelta += delta
      if (Math.abs(wheelDelta) < 42 || now - lastWheelStep < 170) return
      step(wheelDelta < 0 ? -1 : 1)
      wheelDelta = 0
      lastWheelStep = now
    }

    function startTouch(event: PointerEvent) {
      if (event.pointerType !== 'mouse') pending.current = null
    }

    element.addEventListener('scroll', onScroll, { passive: true })
    element.addEventListener('wheel', onWheel, { passive: false })
    element.addEventListener('pointerdown', startTouch, { passive: true })
    if (supportsScrollEnd) element.addEventListener('scrollend', onScrollEnd)
    return () => {
      element.removeEventListener('scroll', onScroll)
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('pointerdown', startTouch)
      element.removeEventListener('scrollend', onScrollEnd)
      resize.disconnect()
      cancelAnimationFrame(frame)
      window.clearTimeout(fallbackTimer)
    }
  }, [idSequence])

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    suppressClick.current = false
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('input, button, a, label')) return
    const element = event.currentTarget
    if (element.scrollWidth <= element.clientWidth + 1) return
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      start: element.scrollLeft,
      originId: nearestSlide(element)?.dataset.objectiveId ?? null,
      active: false,
    }
    element.dataset.holding = ''
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = drag.current
    if (gesture?.pointerId !== event.pointerId) return
    const delta = event.clientX - gesture.x
    const element = event.currentTarget
    if (!gesture.active) {
      if (Math.abs(delta) < 7) return
      gesture.active = true
      pending.current = null
      suppressClick.current = true
      element.setPointerCapture(event.pointerId)
      element.dataset.dragging = ''
    }
    element.scrollLeft = gesture.start - delta
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = drag.current
    if (gesture?.pointerId !== event.pointerId) return
    if (event.type === 'pointerleave' && gesture.active) return
    const element = event.currentTarget
    drag.current = null
    delete element.dataset.holding
    if (!gesture.active) return
    const nearestId = nearestSlide(element)?.dataset.objectiveId
    delete element.dataset.dragging
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    const delta = event.clientX - gesture.x
    if (event.type === 'pointerup' && nearestId === gesture.originId && Math.abs(delta) > 65) {
      step(delta < 0 ? 1 : -1)
    } else if (nearestId) {
      goTo(nearestId)
    }
  }

  return { track, selectedId, announcedId, goTo, step, startDrag, moveDrag, endDrag, suppressClick }
}
