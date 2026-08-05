import { t } from '@/lib/i18n'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface Props {
  active: boolean
  onToggle: () => void
  className?: string
}

export function BoardFavoriteButton({ active, onToggle, className }: Props) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('h-11 w-11 sm:h-8 sm:w-8', className)}
      aria-label={active ? t("取消收藏") : t("收藏岗位")}
      title={active ? t("取消收藏") : t("收藏岗位")}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
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
