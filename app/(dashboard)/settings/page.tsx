import { PageHeader } from '@/components/dashboard/page-header'
import { RateForm } from '@/components/settings/rate-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getUsdArsRate } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const rate = await getUsdArsRate()

  return (
    <div>
      <PageHeader title="Settings" description="Application configuration." />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Currency</CardTitle>
          <CardDescription>
            Used to convert Mercado Libre revenue (ARS) into USD for profit calculations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RateForm rate={rate} />
        </CardContent>
      </Card>
    </div>
  )
}
