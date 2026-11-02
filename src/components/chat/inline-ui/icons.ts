import {
  ArrowDown, ArrowRight, ArrowUp, BadgeCheck, Ban, Book, Bug, Calendar, ChartBar, Check, CircleAlert, CircleCheck,
  CircleHelp, CircleX, Clock, Cloud, Code, Cpu, Database, DollarSign, Download, ExternalLink, File, FileText, Flag,
  Flame, Folder, Gift, Globe, Heart, Info, Key, Lightbulb, Link, Lock, Mail, MapPin, MessageSquare, Minus, Package,
  Phone, Plus, Rocket, Search, Server, Settings, Shield, Sparkles, Star, Target, Terminal, ThumbsDown, ThumbsUp,
  TrendingDown, TrendingUp, TriangleAlert, Trophy, User, Users, Wrench, X, Zap, type LucideIcon,
} from "lucide-react";

/** Curated icon set available to inline UI as <ui-icon name="…">. Keep in sync with the prompt. */
export const INLINE_UI_ICONS: Record<string, LucideIcon> = {
  "arrow-down": ArrowDown, "arrow-right": ArrowRight, "arrow-up": ArrowUp, "badge-check": BadgeCheck, ban: Ban,
  book: Book, bug: Bug, calendar: Calendar, chart: ChartBar, check: Check, "alert-circle": CircleAlert,
  "check-circle": CircleCheck, help: CircleHelp, "x-circle": CircleX, clock: Clock, cloud: Cloud, code: Code, cpu: Cpu,
  database: Database, dollar: DollarSign, download: Download, "external-link": ExternalLink, file: File,
  "file-text": FileText, flag: Flag, flame: Flame, folder: Folder, gift: Gift, globe: Globe, heart: Heart, info: Info,
  key: Key, lightbulb: Lightbulb, link: Link, lock: Lock, mail: Mail, "map-pin": MapPin, message: MessageSquare,
  minus: Minus, package: Package, phone: Phone, plus: Plus, rocket: Rocket, search: Search, server: Server,
  settings: Settings, shield: Shield, sparkles: Sparkles, star: Star, target: Target, terminal: Terminal,
  "thumbs-down": ThumbsDown, "thumbs-up": ThumbsUp, "trending-down": TrendingDown, "trending-up": TrendingUp,
  warning: TriangleAlert, trophy: Trophy, user: User, users: Users, wrench: Wrench, x: X, zap: Zap,
};
