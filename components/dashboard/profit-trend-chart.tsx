'use client'

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

const config = {
  profitUsd: { label: 'Profit (USD)', color: 'var(--chart-1)' },
} satisfies ChartConfig

export function ProfitTrendChart({ data }: { data: { date: string; profitUsd: number }[] }) {
  return (
    <ChartContainer config={config} className="h-[240px] w-full">
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={48} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          dataKey="profitUsd"
          type="monotone"
          fill="var(--color-profitUsd)"
          fillOpacity={0.2}
          stroke="var(--color-profitUsd)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  )
}
