import { memo } from 'react'
import type { Position } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { MapPin, GraduationCap, Calendar, Building2 } from 'lucide-react'
import { FavoriteButton } from './FavoriteButton'
import { CompareButton } from './CompareButton'
import { STATUS_COLORS, useAppStatuses } from '@/lib/positionStore'

interface Props {
  item: Position
  onDetail: (item: Position) => void
}

export const PositionCard = memo(function PositionCard({ item, onDetail }: Props) {
  const statuses = useAppStatuses()
  const status = statuses[item.id]
  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{item.year}</Badge>
            <Badge variant="outline">{item.job_type}</Badge>
            {item.edu_level_norm && (
              <Badge variant="outline" className="text-muted-foreground">
                {item.edu_level_norm}
              </Badge>
            )}
            {status && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[status]}`}>
                {status}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            <FavoriteButton item={item} />
            <CompareButton item={item} />
          </div>
        </div>
        <h3 className="mt-2 line-clamp-2 text-base font-semibold leading-snug">
          {item.position_example || '-'}
        </h3>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 text-sm text-muted-foreground">
        <div className="flex items-start gap-2">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="line-clamp-2">{item.employer || '-'}</span>
        </div>
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 shrink-0" />
          <span className="line-clamp-1">{item.edu_level_norm || item.edu_requirement || '学历不限'}</span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" />
          <span className="line-clamp-1">{item.work_location || '-'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 shrink-0" />
          <span className="line-clamp-1">{item.signup_time || '-'}</span>
        </div>
      </CardContent>
      <CardFooter className="pt-0">
        <Button variant="default" size="sm" className="w-full" onClick={() => onDetail(item)}>
          查看详情
        </Button>
      </CardFooter>
    </Card>
  )
})
