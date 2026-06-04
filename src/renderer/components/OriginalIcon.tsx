import type { CSSProperties } from 'react'

export type OriginalIconName =
  | 'add'
  | 'agent'
  | 'all'
  | 'archive'
  | 'assets'
  | 'chapters'
  | 'delete'
  | 'edit'
  | 'file'
  | 'folder'
  | 'help'
  | 'inspiration'
  | 'knowledge'
  | 'more'
  | 'move'
  | 'outline'
  | 'records'
  | 'refresh'
  | 'roles'
  | 'rules'
  | 'save'
  | 'search'
  | 'settings'
  | 'sidebar-close'
  | 'sidebar-open'
  | 'skill'
  | 'snapshot'
  | 'switch-project'
  | 'toolbox'

type OriginalIconProps = {
  name: OriginalIconName
  size?: number
  className?: string
}

export function OriginalIcon({ name, size = 16, className = '' }: OriginalIconProps) {
  const style = { '--wy-icon-size': `${size}px` } as CSSProperties
  return (
    <span
      aria-hidden="true"
      className={className ? `wy-icon wy-icon-${name} ${className}` : `wy-icon wy-icon-${name}`}
      style={style}
    >
      <span />
    </span>
  )
}
