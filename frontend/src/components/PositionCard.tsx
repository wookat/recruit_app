import { memo } from 'react'
import type { Position } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { MapPin, GraduationCap, Calendar, Building2 } from 'lucide-react'
import { FavoriteButton } from './FavoriteButton'
import { CompareButton } from './CompareButton'
import { STATUS_COLORS, useAppStatuses } from '@/lib/positionStore'
import { eduClass, jobTypeClass, yearClass, PILL_BASE } from '@/lib/badgeColors'
import { cn } from '@/lib/utils'
import { Highlight } from './Highlight'
import { ShareTextButton, buildShareText } from './ShareTextButton'
import { jobShareUrl } from '@/lib/clipboard'
import { stripOrgPrefix } from '@/lib/orgPrefix'
import { derivePositionTags } from '@/lib/jobTags'
import { DueBadge } from './DueBadge'
import { SeenBadge } from './SeenBadge'
import { NewDot } from './NewDot'

interface Props {
  item: Position
  onDetail: (item: Position) => void
  highlight?: string
}

export const PositionCard = memo(function PositionCard({ item, onDetail, highlight }: Props) {
  const statuses = useAppStatuses()
  const status = statuses[item.id]
  return (
    <Card
      className="flex h-full cursor-pointer flex-col transition-all hover:border-primary/20 hover:shadow-md"
      onClick={() => onDetail(item)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(PILL_BASE, yearClass(item.year))}>{item.year}</span>
            <span className={cn(PILL_BASE, jobTypeClass(item.job_type))}>{item.job_type}</span>
            {item.edu_level_norm && (
              <span className={cn(PILL_BASE, eduClass(item.edu_level_norm))}>
                {item.edu_level_norm}
              </span>
            )}
            {status && (
              <span className={`rounded-sm px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[status]}`}>
                {status}
              </span>
            )}
            {derivePositionTags(item)
              .filter((t) => t.key !== 'edu_bk')
              .map((t) => (
                <span
                  key={t.key}
                  className={cn(PILL_BASE, 'bg-muted text-foreground/80 dark:text-muted-foreground')}
                >
                  {t.label}
                </span>
              ))}
            <NewDot board="positions" id={item.id} createdAt={item.created_at} />
            <SeenBadge board="positions" id={item.id} />
          </div>
          <div className="flex shrink-0 items-center">
            <FavoriteButton item={item} />
            <CompareButton item={item} />
            <ShareTextButton
              text={buildShareText({
                org: item.employer,
                title: item.position_example,
                location: item.work_location,
                deadline: item.signup_time,
                deepLink: jobShareUrl('positions', item.id),
                url: item.source_url,
              })}
            />
          </div>
        </div>
        <h3 className="mt-2 line-clamp-2 text-base font-semibold leading-snug">
          <Highlight
            text={item.position_example ? stripOrgPrefix(item.position_example, item.employer, item.exam_type_norm || item.exam_type) : '-'}
            query={highlight}
          />
        </h3>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 text-sm text-muted-foreground">
        <div className="flex items-start gap-2">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="line-clamp-2">
            <Highlight text={item.employer || '-'} query={highlight} />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 shrink-0" />
          <span className="line-clamp-1">{item.edu_level_norm || item.edu_requirement || '学历不限'}</span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" />
          <span className="line-clamp-1">{item.work_location || '-'}</span>
        </div>
        {item.signup_time && (
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 shrink-0" />
            <span className="line-clamp-1">{item.signup_time}</span>
            <DueBadge date={item.signup_deadline?.slice(0, 10)} />
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-0">
        <Button
          variant="default"
          size="sm"
          className="h-11 w-full sm:h-8"
          onClick={() => onDetail(item)}
        >
          查看详情
        </Button>
      </CardFooter>
    </Card>
  )
})
