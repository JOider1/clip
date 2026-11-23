import type { Settings } from '../../../shared/types'
import { IconFolder, IconLibrary, IconScissors, IconSettings, IconSparkles } from '../icons'
import { fmtBytes } from '../utils'

export function Sidebar({
  page,
  settings,
  clips,
  storageBytes,
  onNavigate,
  onNew,
  onOpenOutput
}: {
  page: 'library' | 'settings' | 'job'
  settings: Settings
  clips: number
  storageBytes: number
  onNavigate: (page: 'library' | 'settings') => void
  onNew: () => void
  onOpenOutput: () => void
}): React.ReactElement {
  const aiOn = settings.ai.enabled && Boolean(settings.ai.apiKey)

  return (
    <aside className="sidebar">
      <button className="new-clip-btn" onClick={onNew}>
        <span className="new-clip-icon">
          <IconScissors size={19} />
        </span>
        <span>Новий кліп</span>
        <kbd>＋</kbd>
      </button>

      <nav className="side-nav">
        <button
          className={page === 'library' ? 'active' : ''}
          onClick={() => onNavigate('library')}
        >
          <IconLibrary size={19} />
          Бібліотека
        </button>
        <button
          className={page === 'settings' ? 'active' : ''}
          onClick={() => onNavigate('settings')}
        >
          <IconSettings size={19} />
          Налаштування
        </button>
      </nav>

      <div className="side-block">
        <div className="side-label">Режим відбору</div>
        <div className={`mode-card ${aiOn ? 'mode-ai' : 'mode-heur'}`}>
          <span className="mode-ico">
            <IconSparkles size={17} />
          </span>
          <span>
            <strong>{aiOn ? 'AI-редактор' : 'Евристика'}</strong>
            <small>
              {aiOn ? settings.ai.model || 'модель не вказана' : 'гучність + ключові слова'}
            </small>
          </span>
        </div>
      </div>

      <div className="side-block side-tips">
        <div className="side-label">Швидка порада</div>
        <p>
          Відкалібруй зону вебки на вкладці <strong>Шаблон</strong> — тоді обличчя завжди буде
          зверху, а геймплей знизу.
        </p>
      </div>

      <div className="side-foot">
        <button className="link-btn" onClick={onOpenOutput}>
          <IconFolder size={17} />
          Папка з кліпами
        </button>
        <div className="side-meta">
          {clips} кліпів · {fmtBytes(storageBytes)}
        </div>
        <div className="side-meta dim">ClipForge 1.0 · локальна обробка</div>
      </div>
    </aside>
  )
}
