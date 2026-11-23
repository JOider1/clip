import { useEffect, useState } from 'react'
import type { LayoutId, Settings, SttSettings } from '../../../shared/types'
import { DEFAULT_SETTINGS, LAYOUTS } from '../../../shared/defaults'
import { api } from '../api'
import {
  IconAlert,
  IconCaptions,
  IconCheck,
  IconDownload,
  IconExternal,
  IconFolder,
  IconScissors,
  IconSparkles,
  IconWand
} from '../icons'
import { Field, Segmented, Spinner, Toggle } from './ui'
import { LayoutThumb } from './LayoutThumb'
import { fmtBytes } from '../utils'

const AI_PRESETS = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', model: 'local-model' }
]

const STT_LANGUAGES = [
  ['', 'Авто'],
  ['uk', 'Українська'],
  ['en', 'English'],
  ['ru', 'Русский'],
  ['pl', 'Polski'],
  ['de', 'Deutsch'],
  ['es', 'Español']
]

export function SettingsPage({
  settings,
  metrics,
  onSave,
  onToast,
  onOpenOutput
}: {
  settings: Settings
  metrics: { clips: number; storageBytes: number }
  onSave: (settings: Settings) => Promise<void>
  onToast: (message: string) => void
  onOpenOutput: () => void
}): React.ReactElement {
  const [draft, setDraft] = useState<Settings>(settings)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [ytdlpBusy, setYtdlpBusy] = useState(false)
  const [ytdlpResult, setYtdlpResult] = useState<string | null>(null)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  const setAi = (patch: Partial<Settings['ai']>): void =>
    setDraft((d) => ({ ...d, ai: { ...d.ai, ...patch } }))
  const setStt = (patch: Partial<SttSettings>): void =>
    setDraft((d) => ({ ...d, stt: { ...d.stt, ...patch } }))
  const setDefaults = (patch: Partial<Settings['clipDefaults']>): void =>
    setDraft((d) => ({ ...d, clipDefaults: { ...d.clipDefaults, ...patch } }))
  const setSubtitle = (patch: Partial<Settings['clipDefaults']['subtitle']>): void =>
    setDraft((d) => ({
      ...d,
      clipDefaults: {
        ...d.clipDefaults,
        subtitle: { ...d.clipDefaults.subtitle, ...patch }
      }
    }))

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSave(draft)
      onToast('Налаштування збережено')
    } catch (err) {
      onToast((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const testAi = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.testAi(draft)
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const downloadYtdlp = async (): Promise<void> => {
    setYtdlpBusy(true)
    setYtdlpResult(null)
    try {
      const res = await api.ensureYtdlp()
      setYtdlpResult(`Готово: ${res.path} (${res.version})`)
      onToast('yt-dlp готовий')
    } catch (err) {
      setYtdlpResult(`Помилка: ${(err as Error).message}`)
    } finally {
      setYtdlpBusy(false)
    }
  }

  return (
    <div className="page settings-page">
      <header className="page-head compact">
        <div>
          <div className="eyebrow">Конфігурація</div>
          <h1>Налаштування</h1>
          <p className="page-sub">Ключі, транскрипція та параметри кліпів. Усе зберігається локально.</p>
        </div>
        <div className="settings-head-actions">
          <button
            className="btn btn-ghost"
            onClick={() => setDraft(structuredClone({ ...DEFAULT_SETTINGS, outputDir: draft.outputDir }))}
          >
            Скинути
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <Spinner size={15} /> : <IconCheck size={16} />}
            {saving ? 'Зберігаю…' : dirty ? 'Зберегти зміни' : 'Збережено'}
          </button>
        </div>
      </header>

      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="panel-head">
            <div>
              <h2>
                <IconSparkles size={18} /> AI-відбір моментів
              </h2>
              <p className="muted small">
                Модель оцінює сцени за потенціалом переглядів і лайків. Без ключа працює евристика.
              </p>
            </div>
            <Toggle
              checked={draft.ai.enabled}
              onChange={(enabled) => setAi({ enabled })}
              label=""
            />
          </div>

          <div className="preset-row">
            {AI_PRESETS.map((preset) => (
              <button
                key={preset.name}
                className={`preset-chip ${
                  draft.ai.baseUrl === preset.baseUrl ? 'active' : ''
                }`}
                onClick={() => setAi({ baseUrl: preset.baseUrl, model: preset.model })}
              >
                {preset.name}
              </button>
            ))}
          </div>

          <details className="key-help">
            <summary>Де взяти API-ключ?</summary>
            <ol>
              <li>Відкрий консоль провайдера й створи ключ — він показується лише один раз.</li>
              <li>Встав ключ у поле «API-ключ» нижче.</li>
              <li>Натисни «Перевірити підключення», потім збережи налаштування.</li>
            </ol>
            <div className="key-links">
              <button
                className="link-btn"
                onClick={() => void api.openExternal('https://platform.openai.com/api-keys')}
              >
                OpenAI ↗
              </button>
              <button
                className="link-btn"
                onClick={() => void api.openExternal('https://console.groq.com/keys')}
              >
                Groq (безкоштовний ліміт) ↗
              </button>
              <button
                className="link-btn"
                onClick={() => void api.openExternal('https://openrouter.ai/settings/keys')}
              >
                OpenRouter ↗
              </button>
            </div>
            <p className="hint muted">
              Один ключ Groq працює і для відбору моментів, і для транскрипції Whisper. Ключ
              зберігається лише на цьому комп’ютері.
            </p>
          </details>

          <Field label="Base URL" hint="OpenAI-сумісний API">
            <input
              className="input"
              value={draft.ai.baseUrl}
              onChange={(e) => setAi({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </Field>

          <div className="two-fields">
            <Field label="API-ключ" hint="зберігається локально">
              <input
                className="input"
                type="password"
                value={draft.ai.apiKey}
                onChange={(e) => setAi({ apiKey: e.target.value })}
                placeholder="sk-…"
                spellCheck={false}
              />
            </Field>
            <Field label="Модель">
              <input
                className="input"
                value={draft.ai.model}
                onChange={(e) => setAi({ model: e.target.value })}
                placeholder="gpt-4o-mini"
                spellCheck={false}
              />
            </Field>
          </div>

          <Field label="Температура" hint={draft.ai.temperature.toFixed(1)}>
            <input
              className="range"
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={draft.ai.temperature}
              onChange={(e) => setAi({ temperature: Number(e.target.value) })}
            />
          </Field>

          <div className="test-row">
            <button className="btn btn-ghost btn-sm" onClick={() => void testAi()} disabled={testing}>
              {testing ? <Spinner size={14} /> : <IconWand size={14} />}
              Перевірити підключення
            </button>
            {testResult ? (
              <span className={`test-result ${testResult.ok ? 'ok' : 'bad'}`}>
                {testResult.ok ? <IconCheck size={13} /> : <IconAlert size={13} />}
                {testResult.message}
              </span>
            ) : null}
          </div>
        </section>

        <section className="panel settings-card">
          <div className="panel-head">
            <div>
              <h2>
                <IconCaptions size={18} /> Транскрипція та субтитри
              </h2>
              <p className="muted small">Whisper API або локальний whisper.cpp. Потрібна для субтитрів.</p>
            </div>
          </div>

          <Segmented
            value={draft.stt.mode}
            onChange={(mode) => setStt({ mode })}
            options={[
              { value: 'api', label: 'Whisper API' },
              { value: 'local', label: 'Локально' },
              { value: 'off', label: 'Вимкнено' }
            ]}
          />

          {draft.stt.mode === 'api' ? (
            <>
              <Field label="Base URL" hint="OpenAI / Groq / інший сумісний">
                <input
                  className="input"
                  value={draft.stt.baseUrl}
                  onChange={(e) => setStt({ baseUrl: e.target.value })}
                  spellCheck={false}
                />
              </Field>
              <div className="two-fields">
                <Field label="API-ключ">
                  <input
                    className="input"
                    type="password"
                    value={draft.stt.apiKey}
                    onChange={(e) => setStt({ apiKey: e.target.value })}
                    placeholder="можна той самий, що для AI"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Модель">
                  <input
                    className="input"
                    value={draft.stt.model}
                    onChange={(e) => setStt({ model: e.target.value })}
                    placeholder="whisper-1"
                    spellCheck={false}
                  />
                </Field>
              </div>
              <div className="inline-presets">
                <button
                  className="link-btn"
                  onClick={() => setStt({ baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' })}
                >
                  OpenAI whisper-1
                </button>
                <button
                  className="link-btn"
                  onClick={() =>
                    setStt({ baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3' })
                  }
                >
                  Groq whisper-large-v3
                </button>
                <button
                  className="link-btn"
                  onClick={() => setStt({ apiKey: draft.ai.apiKey })}
                  disabled={!draft.ai.apiKey}
                >
                  Взяти ключ з AI
                </button>
              </div>
            </>
          ) : null}

          {draft.stt.mode === 'local' ? (
            <>
              <Field label="whisper-cli.exe" hint="бінарник whisper.cpp">
                <div className="input-row">
                  <input
                    className="input"
                    value={draft.stt.binaryPath}
                    onChange={(e) => setStt({ binaryPath: e.target.value })}
                    placeholder="C:\\whisper\\whisper-cli.exe"
                    spellCheck={false}
                  />
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      const p = await api.pickFile('executable')
                      if (p) setStt({ binaryPath: p })
                    }}
                  >
                    Обрати
                  </button>
                </div>
              </Field>
              <Field label="Модель .bin" hint="ggml-base / small / medium">
                <div className="input-row">
                  <input
                    className="input"
                    value={draft.stt.modelPath}
                    onChange={(e) => setStt({ modelPath: e.target.value })}
                    placeholder="C:\\whisper\\ggml-small.bin"
                    spellCheck={false}
                  />
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      const p = await api.pickFile('model')
                      if (p) setStt({ modelPath: p })
                    }}
                  >
                    Обрати
                  </button>
                </div>
              </Field>
              <p className="hint muted">
                Локальний режим безкоштовний, але потребує встановленого whisper.cpp. Для стрімів на
                2+ години краще API.
              </p>
            </>
          ) : null}

          {draft.stt.mode === 'off' ? (
            <p className="hint muted">
              Транскрипція вимкнена — кліпи створяться без субтитрів, а моменти оцінюватимуться за
              гучністю та сценами.
            </p>
          ) : null}

          <Field label="Мова мовлення">
            <select
              className="input"
              value={draft.stt.language}
              onChange={(e) => setStt({ language: e.target.value })}
            >
              {STT_LANGUAGES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <section className="panel settings-card">
          <div className="panel-head">
            <div>
              <h2>
                <IconDownload size={18} /> Завантаження та файли
              </h2>
              <p className="muted small">yt-dlp, cookies для YouTube та папка з результатами.</p>
            </div>
          </div>

          <Field label="yt-dlp" hint="порожньо = авто (PATH або локальна тека)">
            <div className="input-row">
              <input
                className="input"
                value={draft.ytdlpPath}
                onChange={(e) => setDraft({ ...draft, ytdlpPath: e.target.value })}
                placeholder="автоматично"
                spellCheck={false}
              />
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  const p = await api.pickFile('executable')
                  if (p) setDraft({ ...draft, ytdlpPath: p })
                }}
              >
                Обрати
              </button>
            </div>
          </Field>
          <div className="test-row">
            <button className="btn btn-ghost btn-sm" onClick={() => void downloadYtdlp()} disabled={ytdlpBusy}>
              {ytdlpBusy ? <Spinner size={14} /> : <IconDownload size={14} />}
              {ytdlpBusy ? 'Завантажую…' : 'Завантажити yt-dlp'}
            </button>
            <span className="muted small">~20 МБ, один раз</span>
          </div>
          {ytdlpResult ? <div className="test-result ok wrap">{ytdlpResult}</div> : null}

          <Field
            label="Cookies для YouTube"
            hint="якщо відео просить вхід або «бот-перевірку»"
          >
            <div className="input-row">
              <input
                className="input"
                value={draft.cookiesFile}
                onChange={(e) => setDraft({ ...draft, cookiesFile: e.target.value })}
                placeholder="cookies.txt (експорт із браузера)"
                spellCheck={false}
              />
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  const p = await api.pickFile('cookies')
                  if (p) setDraft({ ...draft, cookiesFile: p })
                }}
              >
                Обрати
              </button>
            </div>
          </Field>

          <Field label="Папка для кліпів">
            <div className="input-row">
              <input
                className="input"
                value={draft.outputDir}
                onChange={(e) => setDraft({ ...draft, outputDir: e.target.value })}
                spellCheck={false}
              />
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  const p = await api.pickDirectory()
                  if (p) setDraft({ ...draft, outputDir: p })
                }}
              >
                Обрати
              </button>
            </div>
          </Field>
          <div className="test-row">
            <button className="btn btn-ghost btn-sm" onClick={onOpenOutput}>
              <IconFolder size={14} />
              Відкрити папку
            </button>
            <span className="muted small">
              {metrics.clips} кліпів · {fmtBytes(metrics.storageBytes)}
            </span>
          </div>
        </section>

        <section className="panel settings-card">
          <div className="panel-head">
            <div>
              <h2>
                <IconScissors size={18} /> Кліпи за замовчуванням
              </h2>
              <p className="muted small">Застосовується до нових проєктів.</p>
            </div>
          </div>

          <div className="two-fields">
            <Field label="Кількість моментів" hint={`${draft.clipDefaults.count}`}>
              <input
                className="range"
                type="range"
                min={1}
                max={20}
                value={draft.clipDefaults.count}
                onChange={(e) => setDefaults({ count: Number(e.target.value) })}
              />
            </Field>
            <Field label="Довжина, сек">
              <div className="two-inputs">
                <input
                  className="input"
                  type="number"
                  value={draft.clipDefaults.minDuration}
                  onChange={(e) => setDefaults({ minDuration: Number(e.target.value) })}
                />
                <span>—</span>
                <input
                  className="input"
                  type="number"
                  value={draft.clipDefaults.maxDuration}
                  onChange={(e) => setDefaults({ maxDuration: Number(e.target.value) })}
                />
              </div>
            </Field>
          </div>

          <Field label="Шаблон">
            <div className="layout-picker compact">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  className={`layout-option ${draft.clipDefaults.layoutId === l.id ? 'active' : ''}`}
                  onClick={() => setDefaults({ layoutId: l.id as LayoutId })}
                  title={l.hint}
                >
                  <LayoutThumb id={l.id} active={draft.clipDefaults.layoutId === l.id} />
                  <span>{l.name}</span>
                </button>
              ))}
            </div>
          </Field>

          <div className="two-fields">
            <Field label="Стиль субтитрів">
              <Segmented
                size="sm"
                value={draft.clipDefaults.subtitle.preset}
                onChange={(preset) => setSubtitle({ preset })}
                options={[
                  { value: 'bold', label: 'Жирний' },
                  { value: 'boxed', label: 'Плашка' },
                  { value: 'karaoke', label: 'Караоке' },
                  { value: 'minimal', label: 'Мінімал' }
                ]}
              />
            </Field>
            <Field label="Розмір" hint={`${draft.clipDefaults.subtitle.fontSize}px`}>
              <input
                className="range"
                type="range"
                min={36}
                max={120}
                value={draft.clipDefaults.subtitle.fontSize}
                onChange={(e) => setSubtitle({ fontSize: Number(e.target.value) })}
              />
            </Field>
          </div>

          <div className="two-fields">
            <Field label="Позиція">
              <Segmented
                size="sm"
                value={draft.clipDefaults.subtitle.position}
                onChange={(position) => setSubtitle({ position })}
                options={[
                  { value: 'bottom', label: 'Знизу' },
                  { value: 'center', label: 'Центр' },
                  { value: 'top', label: 'Зверху' }
                ]}
              />
            </Field>
            <Field label="Акцент">
              <div className="color-input">
                <input
                  type="color"
                  value={draft.clipDefaults.subtitle.accent}
                  onChange={(e) => setSubtitle({ accent: e.target.value })}
                />
                <code>{draft.clipDefaults.subtitle.accent.toUpperCase()}</code>
              </div>
            </Field>
          </div>

          <Toggle
            checked={draft.clipDefaults.subtitle.uppercase}
            onChange={(uppercase) => setSubtitle({ uppercase })}
            label="ВЕЛИКІ ЛІТЕРИ"
          />
        </section>

        <section className="panel settings-card info-card">
          <h2>Система</h2>
          <div className="fact-grid">
            <div>
              <span>FFmpeg</span>
              <strong>вбудований</strong>
            </div>
            <div>
              <span>Рендер</span>
              <strong>H.264 · 1080×1920</strong>
            </div>
            <div>
              <span>Гучність</span>
              <strong>−14 LUFS</strong>
            </div>
            <div>
              <span>Дані</span>
              <strong>локально</strong>
            </div>
          </div>
          <p className="hint muted">
            Ключі зберігаються у локальному файлі налаштувань і не передаються нікуди, крім обраного
            API.
          </p>
          <button className="link-btn" onClick={() => void api.openPath('')} style={{ display: 'none' }}>
            <IconExternal size={13} /> документація
          </button>
        </section>
      </div>

      {dirty ? (
        <div className="save-bar">
          <span>Є незбережені зміни</span>
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => setDraft(settings)}>
              Відхилити
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner size={14} /> : <IconCheck size={15} />}
              Зберегти
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
