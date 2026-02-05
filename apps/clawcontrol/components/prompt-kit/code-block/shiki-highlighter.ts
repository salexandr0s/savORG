type ShikiHighlighter = {
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string | Promise<string>
  loadLanguage?: (lang: string) => Promise<void>
}

const THEME = 'github-dark'
const FALLBACK_LANG = 'text'

let highlighterPromise: Promise<ShikiHighlighter> | null = null
const loadedLangs = new Set<string>([FALLBACK_LANG])

async function initHighlighter(): Promise<ShikiHighlighter> {
  const shiki = await import('shiki')

  // shiki@3: createHighlighter({ themes, langs })
  if ('createHighlighter' in shiki && typeof shiki.createHighlighter === 'function') {
    const h = await shiki.createHighlighter({
      themes: [THEME],
      langs: [FALLBACK_LANG],
    })
    return h as unknown as ShikiHighlighter
  }

  // Older shiki: getHighlighter({ theme })
  if ('getHighlighter' in shiki && typeof shiki.getHighlighter === 'function') {
    const h = await shiki.getHighlighter({ theme: THEME })
    return h as unknown as ShikiHighlighter
  }

  // Minimal fallback: codeToHtml static export
  if ('codeToHtml' in shiki && typeof shiki.codeToHtml === 'function') {
    return {
      codeToHtml: (code, options) => shiki.codeToHtml(code, options),
    }
  }

  throw new Error('Unsupported shiki API')
}

async function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = initHighlighter()
  }
  return highlighterPromise
}

export async function highlightCodeToHtml(code: string, lang: string | null): Promise<string | null> {
  try {
    const highlighter = await getHighlighter()
    const language = (lang || FALLBACK_LANG).toLowerCase()

    if (highlighter.loadLanguage && !loadedLangs.has(language)) {
      try {
        await highlighter.loadLanguage(language)
        loadedLangs.add(language)
      } catch {
        // Ignore language load failures; fall back to text.
      }
    }

    return await Promise.resolve(highlighter.codeToHtml(code, {
      lang: loadedLangs.has(language) ? language : FALLBACK_LANG,
      theme: THEME,
    }))
  } catch {
    return null
  }
}
