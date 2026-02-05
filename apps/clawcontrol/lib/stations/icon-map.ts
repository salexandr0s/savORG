import {
  Hammer,
  Wrench,
  Code,
  Terminal,
  FileText,
  ClipboardList,
  Map,
  CheckCircle,
  ShieldCheck,
  Bug,
  TestTube,
  Settings,
  Server,
  Database,
  FlaskConical,
  Search,
  Brain,
  MessageCircle,
  Users,
  Star,
  Zap,
  Clock,
  Folder,
  Tag,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const STATION_ICON_KEYS = [
  'hammer',
  'wrench',
  'code',
  'terminal',
  'file-text',
  'clipboard-list',
  'map',
  'check-circle',
  'shield-check',
  'bug',
  'test-tube',
  'settings',
  'server',
  'database',
  'flask',
  'search',
  'brain',
  'message-circle',
  'users',
  'star',
  'zap',
  'clock',
  'folder',
  'tag',
] as const

export type StationIconKey = (typeof STATION_ICON_KEYS)[number]

export const STATION_ICON_SET: ReadonlySet<string> = new Set(STATION_ICON_KEYS)

export function isStationIconKey(value: unknown): value is StationIconKey {
  return typeof value === 'string' && STATION_ICON_SET.has(value)
}

export const STATION_ICON_COMPONENTS: Record<StationIconKey, LucideIcon> = {
  hammer: Hammer,
  wrench: Wrench,
  code: Code,
  terminal: Terminal,
  'file-text': FileText,
  'clipboard-list': ClipboardList,
  map: Map,
  'check-circle': CheckCircle,
  'shield-check': ShieldCheck,
  bug: Bug,
  'test-tube': TestTube,
  settings: Settings,
  server: Server,
  database: Database,
  flask: FlaskConical,
  search: Search,
  brain: Brain,
  'message-circle': MessageCircle,
  users: Users,
  star: Star,
  zap: Zap,
  clock: Clock,
  folder: Folder,
  tag: Tag,
}
