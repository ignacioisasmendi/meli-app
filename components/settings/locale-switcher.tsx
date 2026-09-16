'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { setLocale } from '@/actions/settings'
import type { Locale } from '@/i18n/request'

export function LocaleSwitcher() {
  const locale = useLocale()
  const t = useTranslations('Settings')
  const [isPending, startTransition] = useTransition()

  function onChange(value: string) {
    startTransition(async () => {
      const result = await setLocale(value as Locale)
      if (!result.ok) toast.error(result.error)
    })
  }

  return (
    <Select defaultValue={locale} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">{t('english')}</SelectItem>
        <SelectItem value="es">{t('spanish')}</SelectItem>
      </SelectContent>
    </Select>
  )
}
