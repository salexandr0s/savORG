'use client'

import { useEffect, useState } from 'react'
import { User } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UserAvatarProps {
  avatarDataUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_CLASSES = {
  xs: 'w-4 h-4',
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
} as const

const ICON_SIZE_CLASSES = {
  xs: 'w-2.5 h-2.5',
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
} as const

export function UserAvatar({
  avatarDataUrl,
  size = 'md',
  className,
}: UserAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [avatarDataUrl])

  const imageSrc = avatarDataUrl && !imageFailed ? avatarDataUrl : null

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[10px] flex-shrink-0 bg-bg-3 flex items-center justify-center',
        SIZE_CLASSES[size],
        className
      )}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt="Your avatar"
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <User className={cn(ICON_SIZE_CLASSES[size], 'text-fg-1')} />
      )}
    </div>
  )
}
