'use client'

import { useState } from 'react'
import { Check, ClipboardPaste, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { WEB_PROMPT } from '@/lib/imports/amazon-prompt'
import {
  parsePastedOrder,
  reconcileOrder,
  type OrderWarning,
  type ParsedOrder,
  type PasteError,
} from '@/lib/imports/amazon-order'

interface Props {
  onParsed: (order: ParsedOrder, warnings: OrderWarning[]) => void
  disabled?: boolean
}

/**
 * Import path that costs nothing: hand the screenshot to Claude on the web with
 * the prompt below, paste the JSON it replies with back in here.
 */
export function PasteOrderImport({ onParsed, disabled }: Props) {
  const t = useTranslations('PasteOrderImport')
  const [text, setText] = useState('')
  const [error, setError] = useState<PasteError | null>(null)
  const [copied, setCopied] = useState(false)

  function describeError(e: PasteError): string {
    switch (e.code) {
      case 'noJsonFound':
        return t('error.noJsonFound')
      case 'invalidJson':
        return t('error.invalidJson')
      case 'noItems':
        return t('error.noItems')
      case 'itemNeedsName':
        return t('error.itemNeedsName', { item: e.item })
      case 'itemNeedsPrice':
        return t('error.itemNeedsPrice', { item: e.item })
      case 'itemMissingField':
        return t('error.itemMissingField', { item: e.item, field: e.field })
      case 'itemIssue':
        return t('error.itemIssue', { item: e.item, message: e.message })
      case 'issue':
        return e.message
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(WEB_PROMPT)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('couldNotCopy'))
    }
  }

  function read() {
    const result = parsePastedOrder(text)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onParsed(result.order, reconcileOrder(result.order))
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-1.5 text-sm text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">1.</span> {t('step1')}
        </li>
        <li>
          <span className="font-medium text-foreground">2.</span> {t('step2')}
        </li>
        <li>
          <span className="font-medium text-foreground">3.</span> {t('step3')}
        </li>
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copyPrompt}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? t('copied') : t('copyPrompt')}
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" />
            {t('openClaude')}
          </a>
        </Button>
      </div>

      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        rows={8}
        spellCheck={false}
        placeholder={t('pastePlaceholder')}
        className="font-mono text-xs"
      />

      {error && <p className="text-sm text-destructive">{describeError(error)}</p>}

      <Button type="button" onClick={read} disabled={disabled || text.trim().length === 0}>
        <ClipboardPaste className="size-4" />
        {t('readPastedOrder')}
      </Button>
    </div>
  )
}
