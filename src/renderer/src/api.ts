import type { ClipperApi } from '../../shared/types'

declare global {
  interface Window {
    clipper: ClipperApi
  }
}

export const api: ClipperApi = window.clipper
