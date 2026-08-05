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
            The USD/ARS rate auto-updates daily from Saldo — what it actually costs you
            to buy USD. Used to convert Mercado Libre revenue and peso-denominated costs
            (like local shipping on a shipment) into USD. The manual value below is only
            a fallback if Saldo is unreachable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RateForm rate={rate} />
        </CardContent>
      </Card>
    </div>
  )
}
