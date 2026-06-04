import type { FetchUrlResult } from '../../shared/types'

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

function htmlToText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetchUrlContent(url: string, timeoutMs = 30_000): Promise<FetchUrlResult> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed.')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 60_000))
  try {
    const response = await fetch(parsed, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': '王阳/0.1'
      }
    })
    const contentType = response.headers.get('content-type') ?? ''
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('Response is larger than 5 MB.')
    }

    const rawText = buffer.toString('utf8')
    return {
      url,
      finalUrl: response.url,
      status: response.status,
      contentType,
      text: contentType.includes('html') ? htmlToText(rawText) : rawText
    }
  } finally {
    clearTimeout(timeout)
  }
}
