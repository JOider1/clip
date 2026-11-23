import type { LayoutConfig, LayoutId, Settings, SubtitleStyle } from './types'

export const DEFAULT_SUBTITLE: SubtitleStyle = {
  preset: 'bold',
  fontFamily: 'Arial Black',
  fontSize: 72,
  uppercase: true,
  accent: '#C6FF3D',
  position: 'bottom',
  maxWords: 4
}

export const DEFAULT_SETTINGS: Settings = {
  ai: {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.4
  },
  stt: {
    mode: 'api',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'whisper-1',
    language: '',
    binaryPath: '',
    modelPath: ''
  },
  ytdlpPath: '',
  cookiesFile: '',
  outputDir: '',
  clipDefaults: {
    minDuration: 15,
    maxDuration: 60,
    count: 8,
    layoutId: 'face-top',
    burnSubtitles: true,
    subtitle: DEFAULT_SUBTITLE
  },
  onboardingDone: false
}

export const LAYOUTS: { id: LayoutId; name: string; hint: string }[] = [
  { id: 'face-top', name: 'Обличчя зверху', hint: 'Вебка 1080×640 зверху, геймплей 1080×1280 знизу' },
  { id: 'face-bottom', name: 'Обличчя знизу', hint: 'Геймплей зверху, вебка знизу — класика TikTok' },
  { id: 'pip', name: 'Вебка в куті', hint: 'Геймплей на весь екран + обличчя поверх у куті' },
  { id: 'clean-vertical', name: 'Геймплей 9:16', hint: 'Блюр-фон + центральний кадр, без вебки' },
  { id: 'horizontal', name: 'Горизонталь', hint: 'Для YouTube та довших форматів, 16:9' }
]

export const DEFAULT_LAYOUT: LayoutConfig = {
  id: 'face-top',
  faceRect: { x: 0.7, y: 0.66, w: 0.3, h: 0.32 },
  gameRect: null
}

export function defaultLayoutFor(id: LayoutId, aspect: number): LayoutConfig {
  const base: LayoutConfig = { id, faceRect: { x: 0.7, y: 0.66, w: 0.3, h: 0.32 }, gameRect: null }
  if (id === 'clean-vertical' || id === 'horizontal') base.faceRect = null
  // Вертикальне джерело (мобільний стрім / вже готовий кліп) — вебки окремо немає
  if (aspect < 1.1 && id !== 'pip') base.faceRect = null
  if (id === 'pip') base.faceRect = { x: 0.68, y: 0.7, w: 0.3, h: 0.26 }
  return base
}

export const STEP_TEMPLATE = [
  { key: 'download', label: 'Завантаження' },
  { key: 'probe', label: 'Аналіз файлу' },
  { key: 'audio', label: 'Виділення звуку' },
  { key: 'transcribe', label: 'Транскрипція' },
  { key: 'analyze', label: 'Пошук моментів' },
  { key: 'ready', label: 'Готово' }
]

export const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  file: 'Файл',
  other: 'Посилання'
}
