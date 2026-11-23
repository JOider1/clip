import { useEffect, useRef } from 'react'
import { Modal } from './ui'
import { fmtDuration, fmtRange } from '../utils'

export function PlayerModal({
  title,
  src,
  start,
  end,
  onClose
}: {
  title: string
  src: string
  start: number
  end: number
  onClose: () => void
}): React.ReactElement {
  const ref = useRef<HTMLVideoElement>(null)
  const looping = end > start + 0.5

  useEffect(() => {
    const video = ref.current
    if (!video) return
    const onLoaded = (): void => {
      video.currentTime = Math.max(0, start)
      void video.play().catch(() => undefined)
    }
    video.addEventListener('loadedmetadata', onLoaded)
    return () => video.removeEventListener('loadedmetadata', onLoaded)
  }, [start, src])

  useEffect(() => {
    const video = ref.current
    if (!video || !looping) return
    const onTime = (): void => {
      if (video.currentTime >= end || video.currentTime < start - 1) {
        video.currentTime = start
      }
    }
    video.addEventListener('timeupdate', onTime)
    return () => video.removeEventListener('timeupdate', onTime)
  }, [start, end, looping])

  return (
    <Modal
      title={title}
      subtitle={looping ? `${fmtRange(start, end)} · ${fmtDuration(end - start)}` : undefined}
      onClose={onClose}
      width={900}
    >
      <div className="player-wrap">
        <video ref={ref} src={src} controls playsInline className="player" />
      </div>
    </Modal>
  )
}
