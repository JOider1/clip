import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 18, children, ...rest }: P): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconLogo = ({ size = 22, ...p }: P): React.ReactElement => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
    <path d="M6.5 8.2 18 3.5l-5.2 8.5H18l-11.5 8 4.8-8.2H6.5Z" fill="currentColor" />
  </svg>
)

export const IconLibrary = (p: P): React.ReactElement => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.6" />
    <rect x="14" y="3" width="7" height="7" rx="1.6" />
    <rect x="3" y="14" width="7" height="7" rx="1.6" />
    <rect x="14" y="14" width="7" height="7" rx="1.6" />
  </Svg>
)

export const IconPlus = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconSettings = (p: P): React.ReactElement => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.03 4.1l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
  </Svg>
)

export const IconSparkles = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="m12 3 1.9 4.8L19 9.7l-4.2 3.1L15.8 18 12 15.2 8.2 18l1-5.2L5 9.7l5.1-1.9Z" />
    <path d="M19 3v3M17.5 4.5h3M5 18v3M3.5 19.5h3" />
  </Svg>
)

export const IconPlay = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M7 4.8v14.4a.7.7 0 0 0 1.06.6l11.3-7.2a.7.7 0 0 0 0-1.2L8.06 4.2A.7.7 0 0 0 7 4.8Z" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconPause = (p: P): React.ReactElement => (
  <Svg {...p}>
    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconTrash = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" />
  </Svg>
)

export const IconFolder = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />
  </Svg>
)

export const IconRefresh = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  </Svg>
)

export const IconBack = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M15 5 8 12l7 7" />
  </Svg>
)

export const IconCheck = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Svg>
)

export const IconDownload = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20h16" />
  </Svg>
)

export const IconClock = (p: P): React.ReactElement => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 2" />
  </Svg>
)

export const IconFilm = (p: P): React.ReactElement => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 4v16M16 4v16M3 9h5M16 9h5M3 15h5M16 15h5" />
  </Svg>
)

export const IconCaptions = (p: P): React.ReactElement => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M11 10.2a2.6 2.6 0 1 0 0 3.6M19 10.2a2.6 2.6 0 1 0 0 3.6" />
  </Svg>
)

export const IconLayout = (p: P): React.ReactElement => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 11h18M12 11v10" />
  </Svg>
)

export const IconUpload = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 20h16" />
  </Svg>
)

export const IconX = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

export const IconAlert = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M12 3.5 21 20H3Z" />
    <path d="M12 9.5v4.5M12 17.2v.1" />
  </Svg>
)

export const IconExternal = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
)

export const IconSearch = (p: P): React.ReactElement => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
)

export const IconCopy = (p: P): React.ReactElement => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h.5" />
  </Svg>
)

export const IconWand = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="m4 20 10-10M13 4l.9 2.1L16 7l-2.1.9L13 10l-.9-2.1L10 7l2.1-.9ZM19 12l.7 1.6L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.4Z" />
    <path d="m6 4 .5 1.2L8 6l-1.5.5L6 8l-.5-1.5L4 6l1.5-.8Z" />
  </Svg>
)

export const IconLink = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.4 6" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.4-1.4" />
  </Svg>
)

export const IconFile = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8Z" />
    <path d="M14 3v5h5" />
  </Svg>
)

export const IconChevronDown = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

export const IconChevronRight = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
)

export const IconStop = (p: P): React.ReactElement => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconScissors = (p: P): React.ReactElement => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2.6" />
    <circle cx="6" cy="18" r="2.6" />
    <path d="M8.4 7.8 20 19M8.4 16.2 20 5" />
  </Svg>
)

export const IconCrop = (p: P): React.ReactElement => (
  <Svg {...p}>
    <path d="M6 3v13a2 2 0 0 0 2 2h13M3 6h13a2 2 0 0 1 2 2v13" />
  </Svg>
)
