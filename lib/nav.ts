import {
  LayoutDashboard,
  Package,
  Boxes,
  ShoppingCart,
  Plane,
  Receipt,
  Store,
  BarChart3,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/products', label: 'Products', icon: Package },
  { href: '/inventory', label: 'Inventory', icon: Boxes },
  { href: '/purchases', label: 'Purchases', icon: ShoppingCart },
  { href: '/shipments', label: 'Shipments', icon: Plane },
  { href: '/sales', label: 'Sales', icon: Receipt },
  { href: '/accounts', label: 'Accounts', icon: Store },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
]
