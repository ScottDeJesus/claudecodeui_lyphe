import {
  BookOpen,
  Bot,
  Briefcase,
  Bug,
  Calendar,
  Camera,
  Code,
  Database,
  Flame,
  FlaskConical,
  Globe,
  Heart,
  House,
  Lightbulb,
  MessageSquare,
  Music,
  Palette,
  PenLine,
  Rocket,
  Shield,
  Sparkles,
  Star,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The icons a simple-list chat can wear, keyed by the kebab-case name the server stores in
 * `sessions.icon`. Map order is the picker's grid order. Read by SidebarSimpleListRow.tsx and
 * SidebarSimpleIconPicker.tsx. It lives beside its glyph on purpose; the cost of waiving
 * only-export-components is a full reload, in development, when this file is edited.
 */
// oxlint-disable-next-line react/only-export-components
export const SIMPLE_CHAT_ICONS: Readonly<Record<string, LucideIcon>> = {
  'bot': Bot,
  'code': Code,
  'terminal': Terminal,
  'bug': Bug,
  'rocket': Rocket,
  'lightbulb': Lightbulb,
  'book-open': BookOpen,
  'pen-line': PenLine,
  'wrench': Wrench,
  'database': Database,
  'globe': Globe,
  'shield': Shield,
  'star': Star,
  'heart': Heart,
  'flame': Flame,
  'zap': Zap,
  'music': Music,
  'camera': Camera,
  'briefcase': Briefcase,
  'house': House,
  'calendar': Calendar,
  'flask-conical': FlaskConical,
  'sparkles': Sparkles,
  'palette': Palette,
};

/**
 * One chat icon glyph: the named icon, or MessageSquare when the name is null or not in the map
 * (an own-key check, so a stored name like "constructor" never reaches the prototype). Decorative;
 * the caller carries the text. Read by SidebarSimpleListRow.tsx and SidebarSimpleIconPicker.tsx.
 */
export function SimpleChatIconGlyph({ icon, className }: { icon: string | null; className?: string }) {
  const Glyph = icon !== null && Object.prototype.hasOwnProperty.call(SIMPLE_CHAT_ICONS, icon)
    ? SIMPLE_CHAT_ICONS[icon]
    : MessageSquare;
  return <Glyph className={className} aria-hidden />;
}
