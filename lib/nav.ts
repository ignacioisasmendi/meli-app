import {
  LayoutDashboard,
  Package,
  Boxes,
  ShoppingCart,
  Plane,
  Warehouse,
  Receipt,
  Store,
  BarChart3,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  href: string
  labelKey:
    | 'dashboard'
    | 'products'
    | 'inventory'
    | 'purchases'
    | 'shipments'
    | 'fullShipments'
    | 'sales'
    | 'accounts'
    | 'reports'
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/products', labelKey: 'products', icon: Package },
  { href: '/inventory', labelKey: 'inventory', icon: Boxes },
  { href: '/purchases', labelKey: 'purchases', icon: ShoppingCart },
  { href: '/shipments', labelKey: 'shipments', icon: Plane },
  { href: '/full-shipments', labelKey: 'fullShipments', icon: Warehouse },
  { href: '/sales', labelKey: 'sales', icon: Receipt },
  { href: '/accounts', labelKey: 'accounts', icon: Store },
  { href: '/reports', labelKey: 'reports', icon: BarChart3 },
]
