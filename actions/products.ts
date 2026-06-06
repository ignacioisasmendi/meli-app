'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/session'

const productSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required'),
  name: z.string().trim().min(1, 'Name is required'),
  brand: z.string().trim().optional().or(z.literal('')),
  minStock: z.coerce.number().int().min(0).default(5),
})

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function createProduct(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = productSchema.safeParse({
    sku: formData.get('sku'),
    name: formData.get('name'),
    brand: formData.get('brand'),
    minStock: formData.get('minStock'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const existing = await prisma.product.findUnique({ where: { sku: parsed.data.sku } })
  if (existing) return { ok: false, error: `SKU "${parsed.data.sku}" already exists` }

  await prisma.product.create({
    data: {
      sku: parsed.data.sku,
      name: parsed.data.name,
      brand: parsed.data.brand || null,
      minStock: parsed.data.minStock,
    },
  })

  revalidatePath('/products')
  return { ok: true }
}

export async function updateProduct(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireUser()
  const parsed = productSchema.partial().safeParse({
    sku: formData.get('sku') ?? undefined,
    name: formData.get('name') ?? undefined,
    brand: formData.get('brand') ?? undefined,
    minStock: formData.get('minStock') ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  await prisma.product.update({
    where: { id },
    data: {
      ...(parsed.data.sku ? { sku: parsed.data.sku } : {}),
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.brand !== undefined ? { brand: parsed.data.brand || null } : {}),
      ...(parsed.data.minStock !== undefined ? { minStock: parsed.data.minStock } : {}),
    },
  })

  revalidatePath('/products')
  revalidatePath(`/products/${id}`)
  return { ok: true }
}

export async function setProductArchived(
  id: string,
  archived: boolean
): Promise<ActionResult> {
  await requireUser()
  await prisma.product.update({ where: { id }, data: { archived } })
  revalidatePath('/products')
  return { ok: true }
}
