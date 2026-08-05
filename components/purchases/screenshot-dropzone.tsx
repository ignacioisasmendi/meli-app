'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { MAX_SCREENSHOTS, type ParsedOrder } from '@/lib/imports/amazon-order'

/** Claude's per-image ceiling is 5 MB; leave room for base64 overhead. */
const TARGET_BYTES = 4 * 1024 * 1024
/** Long edge Claude reads at full fidelity — bigger just costs tokens. */
const MAX_EDGE = 2576

interface Props {
  onParsed: (order: ParsedOrder, warnings: string[]) => void
  disabled?: boolean
}

/**
 * Drop / paste / pick an Amazon order screenshot and let the server read it
 * into draft lines. Images are downscaled here so a 4K screenshot doesn't get
 * rejected by the upload limit.
 */
export function ScreenshotDropzone({ onParsed, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [dragging, setDragging] = useState(false)

  const upload = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/'))
      if (images.length === 0) return
      if (images.length > MAX_SCREENSHOTS) {
        toast.error(`Attach at most ${MAX_SCREENSHOTS} screenshots at a time`)
        return
      }

      setPending(true)
      try {
        const body = new FormData()
        for (const image of images) body.append('images', await shrink(image))

        const res = await fetch('/api/imports/parse-screenshot', { method: 'POST', body })
        const json = await res.json()
        if (!res.ok) {
          toast.error(json.error ?? 'Could not read that screenshot')
          return
        }

        onParsed(json.order as ParsedOrder, (json.warnings as string[]) ?? [])
      } catch {
        toast.error('Could not read that screenshot')
      } finally {
        setPending(false)
      }
    },
    [onParsed]
  )

  // Screenshots usually arrive on the clipboard, so accept a plain paste
  // anywhere on the page rather than making the user find the drop target.
  useEffect(() => {
    if (disabled) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault()
        void upload(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [upload, disabled])

  const busy = pending || disabled

  return (
    <div
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-busy={pending}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!busy && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!busy) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!busy) void upload(Array.from(e.dataTransfer.files))
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
        busy && 'pointer-events-none opacity-60'
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />

      {pending ? (
        <>
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium">Reading the order…</p>
          <p className="text-xs text-muted-foreground">This takes a few seconds.</p>
        </>
      ) : (
        <>
          <ImageUp className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            Paste, drop, or click to add an Amazon order screenshot
          </p>
          <p className="text-xs text-muted-foreground">
            Order number, date, items, quantities, tax and shipping are filled in below for you to
            review. Add several screenshots at once for a long order.
          </p>
        </>
      )}
    </div>
  )
}

/** Downscales to the resolution Claude reads at, keeping uploads under the limit. */
async function shrink(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // Let the server reject it with a proper message.
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= TARGET_BYTES) {
    bitmap.close()
    return file
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  for (const quality of [0.92, 0.8, 0.65]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    )
    if (!blob) break
    if (blob.size <= TARGET_BYTES) {
      return new File([blob], `${file.name.replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' })
    }
  }
  return file
}
