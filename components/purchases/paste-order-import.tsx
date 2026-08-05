'use client'

import { useState } from 'react'
import { Check, ClipboardPaste, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { WEB_PROMPT } from '@/lib/imports/amazon-prompt'
import { parsePastedOrder, reconcileOrder, type ParsedOrder } from '@/lib/imports/amazon-order'

interface Props {
  onParsed: (order: ParsedOrder, warnings: string[]) => void
  disabled?: boolean
}

/**
 * Import path that costs nothing: hand the screenshot to Claude on the web with
 * the prompt below, paste the JSON it replies with back in here.
 */
export function PasteOrderImport({ onParsed, disabled }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(WEB_PROMPT)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select the prompt manually')
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
          <span className="font-medium text-foreground">1.</span> Copy the prompt and open Claude.
        </li>
        <li>
          <span className="font-medium text-foreground">2.</span> Attach the order screenshot (or
          several, for a long order), paste the prompt, and send.
        </li>
        <li>
          <span className="font-medium text-foreground">3.</span> Paste Claude&apos;s whole reply
          below — the code fence and any commentary around it are fine.
        </li>
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copyPrompt}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy prompt'}
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <a href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" />
            Open Claude
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
        placeholder={'Paste here, e.g.\n\n{\n  "orderNumber": "112-8247265-8713054",\n  "items": [ ... ]\n}'}
        className="font-mono text-xs"
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="button" onClick={read} disabled={disabled || text.trim().length === 0}>
        <ClipboardPaste className="size-4" />
        Read pasted order
      </Button>
    </div>
  )
}
