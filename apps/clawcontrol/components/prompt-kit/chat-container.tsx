'use client'

import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useStickToBottom } from 'use-stick-to-bottom'
import { cn } from '@/lib/utils'

export interface ChatContainerProps {
  children: React.ReactNode
  className?: string
  contentClassName?: string
}

export function ChatContainer({ children, className, contentClassName }: ChatContainerProps) {
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({
    resize: 'smooth',
    initial: 'auto',
  })

  return (
    <div className={cn('relative flex-1 min-h-0', className)}>
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto px-4 py-4"
      >
        <div ref={contentRef} className={cn('space-y-4', contentClassName)}>
          {children}
        </div>
      </div>

      <AnimatePresence>
        {!isAtBottom && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            onClick={() => scrollToBottom()}
            className={cn(
              'absolute bottom-3 right-3',
              'inline-flex items-center gap-1.5 px-2.5 py-1.5',
              'bg-bg-2/90 backdrop-blur border border-bd-0',
              'rounded-[var(--radius-md)] text-xs text-fg-1 hover:text-fg-0',
              'shadow-sm shadow-black/20'
            )}
          >
            <ChevronDown className="w-3.5 h-3.5" />
            <span className="font-medium">Bottom</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
