import type { Position } from '@/api'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toggleFavorite, useFavorites } from '@/lib/positionStore'
import { Button } from '@/components/ui/button'

interface Props {
  item: Position
  className?: string
}

export function FavoriteButton({ item, className }: Props) {
  const favorites = useFavorites()
  const active = favorites.some((p) => p.id === item.id)
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('h-8 w-8', className)}
      aria-label={active ? '取消收藏' : '收藏岗位'}
      title={active ? '取消收藏' : '收藏岗位'}
      onClick={(e) => {
        e.stopPropagation()
        toggleFavorite(item)
      }}
    >
      <Star
        className={cn(
          'h-4 w-4',
          active ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground',
        )}
      />
    </Button>
  )
}
