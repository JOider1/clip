import type { LayoutId } from '../../../shared/types'

export function LayoutThumb({ id, active = false }: { id: LayoutId; active?: boolean }): React.ReactElement {
  return (
    <div className={`layout-thumb lt-${id} ${active ? 'active' : ''}`}>
      {id === 'face-top' ? (
        <>
          <div className="lt-el-face" />
          <div className="lt-el-game">
            <span className="lt-el-caption" />
          </div>
        </>
      ) : null}
      {id === 'face-bottom' ? (
        <>
          <div className="lt-el-game">
            <span className="lt-el-caption" />
          </div>
          <div className="lt-el-face" />
        </>
      ) : null}
      {id === 'pip' ? (
        <div className="lt-el-game lt-el-full">
          <span className="lt-el-pip" />
          <span className="lt-el-caption" />
        </div>
      ) : null}
      {id === 'clean-vertical' ? (
        <div className="lt-el-blur">
          <span className="lt-el-inner" />
          <span className="lt-el-caption" />
        </div>
      ) : null}
      {id === 'horizontal' ? (
        <div className="lt-el-game lt-el-wide">
          <span className="lt-el-caption" />
        </div>
      ) : null}
    </div>
  )
}
