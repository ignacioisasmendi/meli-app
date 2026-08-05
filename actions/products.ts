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
  // Blank is meaningful: it means "no weight on file", which makes shipments
  // holding this product fall back to splitting freight by value.
  weightGrams: z
    .union([z.literal(''), z.coerce.number().positive('Weight must be positive')])
    .optional(),
})

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function createProduct(formData: FormData): Promise<ActionResult> {
  await requireUser()
  const parsed = productSchema.safeParse({
    sku: formData.get('sku'),
    name: formData.get('name'),
    brand: formData.get('brand'),
    minStock: formData.get('minStock'),
    weightGrams: formData.get('weightGrams'),
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
      weightGrams: parsed.data.weightGrams || null,
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
    weightGrams: formData.get('weightGrams') ?? undefined,
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const current = await prisma.product.findUnique({ where: { id } })
  if (!current) return { ok: false, error: 'Product not found' }

  // `sku` is unique — check before writing so a collision surfaces as a toast
  // instead of an unhandled Prisma P2002.
  if (parsed.data.sku && parsed.data.sku !== current.sku) {
    const clash = await prisma.product.findUnique({ where: { sku: parsed.data.sku } })
    if (clash) return { ok: false, error: `SKU "${parsed.data.sku}" already exists` }
  }

  await prisma.product.update({
    where: { id },
    data: {
      ...(parsed.data.sku ? { sku: parsed.data.sku } : {}),
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.brand !== undefined ? { brand: parsed.data.brand || null } : {}),
      ...(parsed.data.minStock !== undefined ? { minStock: parsed.data.minStock } : {}),
      ...(parsed.data.weightGrams !== undefined
        ? { weightGrams: parsed.data.weightGrams || null }
        : {}),
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
  const current = await prisma.product.findUnique({ where: { id } })
  if (!current) return { ok: false, error: 'Product not found' }

  await prisma.product.update({ where: { id }, data: { archived } })
  revalidatePath('/products')
  revalidatePath(`/products/${id}`)
  return { ok: true }
}
