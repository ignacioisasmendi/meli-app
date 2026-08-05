import Image from 'next/image'
import { Package } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Square product thumbnail with a neutral placeholder for the products that
 * have no image yet (never listed on ML, or synced before the picture existed).
 * `object-contain` on a muted tile because ML pictures are already matted on
 * white and cropping them tends to cut the product in half.
 */
export function ProductThumb({
  src,
  alt,
  size = 40,
  className,
}: {
  src: string | null
  alt: string
  size?: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-md border bg-muted',
        className
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={`${size}px`}
          className="object-contain"
          unoptimized={process.env.NODE_ENV === 'development'}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Package className="size-1/2" aria-hidden />
        </div>
      )}
    </div>
  )
}
