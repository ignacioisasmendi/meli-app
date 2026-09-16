import { getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/dashboard/page-header'
import { RateForm } from '@/components/settings/rate-form'
import { LocaleSwitcher } from '@/components/settings/locale-switcher'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getUsdArsRate } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const t = await getTranslations('Settings')
  const rate = await getUsdArsRate()

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      <div className="space-y-6">
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>{t('language')}</CardTitle>
            <CardDescription>{t('languageDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <LocaleSwitcher />
          </CardContent>
        </Card>

        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>{t('currency')}</CardTitle>
            <CardDescription>{t('currencyDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <RateForm rate={rate} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
