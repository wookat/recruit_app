import { t, tt } from '@/lib/i18n'
import { TableSwipeHint } from './TableSwipeHint'
import { memo, useMemo, useState, type ReactNode } from 'react'

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import type { Position } from '@/api'
import { formatTotal } from '@/api'
import { LazyPositionSheet } from './LazyPositionSheet'
import { sheetNavProps } from '@/lib/sheetNav'
import { DueBadge } from './DueBadge'
import { SeenBadge } from './SeenBadge'
import { NewDot } from './NewDot'
import { EmptyState } from './EmptyState'
import { FavoriteButton } from './FavoriteButton'
import { CompareButton } from './CompareButton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronUp, ListFilter } from 'lucide-react'
import { foldPositions } from '@/lib/positionFold'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { eduClass, jobTypeClass, provinceClass, yearClass, PILL_BASE } from '@/lib/badgeColors'
import { cn } from '@/lib/utils'
import { Highlight } from '@/components/Highlight'
import { ShareTextButton, buildShareText } from '@/components/ShareTextButton'
import { jobShareUrl } from '@/lib/clipboard'
import { SortableHead } from '@/components/SortableHead'
import { stripOrgPrefix } from '@/lib/orgPrefix'
import { parseSignupDeadline } from '@/lib/deadline'
import { cmpNullableStr, nextSort, type SortState } from '@/lib/tableSort'

/** 表格里报名时间只显示日期，带时分秒的完整时间戳靠 hover title 查看 */
function dateOnly(s: string): string {
  return s.replace(/(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}(?::\d{2})?/g, '$1')
}

/** 岗位示例回退值与考试类型相同时两列逐行重复，表格里该列显示「—」 */
function dedupExamType(title: string, examType: string | null | undefined): string {
  return examType && title.trim() === examType.trim() ? '—' : title
}

const columns: ColumnDef<Position>[] = [
  { accessorKey: 'employer', header: t("用人单位/系统"), size: 170 },
  { accessorKey: 'year', header: t("年份"), size: 60 },
  { accessorKey: 'job_type', header: t("岗位类型"), size: 84 },
  {
    id: 'exam_type',
    accessorFn: (row) => row.exam_type_norm || row.exam_type,
    header: t("考试/招聘类型"),
    size: 130,
  },
  { accessorKey: 'position_example', header: t("岗位示例"), size: 170 },
  {
    id: 'edu_level_norm',
    accessorFn: (row) => row.edu_level_norm || row.edu_requirement,
    header: t("学历要求"),
    size: 110,
  },
  { accessorKey: 'work_location', header: t("工作地点"), size: 150 },
  { accessorKey: 'signup_time', header: t("报名时间"), size: 140 },
  { accessorKey: 'exam_time', header: t("考试时间"), size: 160 },
  { accessorKey: 'created_at', header: t("更新"), size: 100 },
]

const SORTABLE_COLUMNS: Record<string, string> = {
  employer: 'employer',
  signup_time: 'deadline',
  created_at: 'created',
}

function sortField(p: Position, key: string): string | null {
  if (key === 'employer') return p.employer
  if (key === 'deadline') {
    const d = parseSignupDeadline(p)
    return d ? d.toISOString() : null
  }
  return p.created_at
}

export interface ColumnFilterConfig {
  label: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
}

interface Props {
  data: Position[]
  total: number
  totalCapped?: boolean
  totalPartial?: boolean
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  loading: boolean
  columnFilters?: Partial<Record<string, ColumnFilterConfig>>
  emptyAction?: ReactNode
  highlight?: string
  onTagClick?: (tagKey: string) => void
}

/** memo：父页面无关状态变化时不重渲整表。 */
export const PositionTable = memo(function PositionTable({
  data,
  total,
  totalCapped,
  totalPartial,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading,
  columnFilters,
  emptyAction,
  highlight,
  onTagClick,
}: Props) {
  const [selected, setSelected] = useState<Position | null>(null)
  const [sort, setSort] = useState<SortState | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const sortedData = useMemo(() => {
    if (!sort) return data
    return [...data].sort((a, b) => cmpNullableStr(sortField(a, sort.key), sortField(b, sort.key), sort.dir))
  }, [data, sort])

  const { rows: foldedData, groups: foldGroups, collapsedGroups, hiddenRows } = useMemo(
    () => foldPositions(sortedData, expandedGroups),
    [sortedData, expandedGroups],
  )
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const table = useReactTable({
    data: foldedData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  function truncate(str: string, len = 40) {
    if (!str) return '-'
    return str.length > len ? str.slice(0, len) + '…' : str
  }

  function getPageNumbers() {
    const pages: (number | string)[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      if (page <= 3) {
        for (let i = 1; i <= 5; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      } else if (page >= totalPages - 2) {
        pages.push(1)
        pages.push('...')
        for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i)
      } else {
        pages.push(1)
        pages.push('...')
        for (let i = page - 1; i <= page + 1; i++) pages.push(i)
        pages.push('...')
        pages.push(totalPages)
      }
    }
    return pages
  }

  return (
    <div className="space-y-3">
      {(collapsedGroups > 0 || expandedGroups.size > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          {collapsedGroups > 0 ? (
            <span>{tt`本页已折叠 ${collapsedGroups} 组同岗多地区岗位（${hiddenRows} 条），总数按未折叠口径统计`}</span>
          ) : (
            <span />
          )}
          {expandedGroups.size > 0 && (
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => setExpandedGroups(new Set())}
            >
              <ChevronUp className="h-3.5 w-3.5" />
              {t('折叠多地区岗位')}
            </button>
          )}
        </div>
      )}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto [scrollbar-width:thin]">
          <TableSwipeHint />
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((h) =>
                    SORTABLE_COLUMNS[h.column.id] ? (
                      <SortableHead
                        key={h.id}
                        label={String(h.column.columnDef.header)}
                        sortKey={SORTABLE_COLUMNS[h.column.id]}
                        sort={sort}
                        onToggle={(k) => setSort((prev) => nextSort(prev, k))}
                        className={cn(
                          'whitespace-nowrap',
                          h.column.id === 'created_at' && 'hidden 2xl:table-cell',
                          h.column.id === 'employer' &&
                            'max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:border-r max-sm:bg-card max-sm:shadow-[8px_0_12px_-6px_rgba(0,0,0,0.18)]',
                        )}
                      />
                    ) : (
                    <TableHead
                      key={h.id}
                      className={cn(
                        'whitespace-nowrap',
                        h.column.id === 'exam_time' && 'hidden 2xl:table-cell',
                        h.column.id === 'exam_type' && 'hidden min-[1750px]:table-cell',
                        h.column.id === 'edu_level_norm' && 'hidden min-[1100px]:table-cell',
                      )}
                      style={{ width: h.column.getSize(), minWidth: h.column.getSize() }}
                    >
                      {columnFilters?.[h.column.id] ? (
                        <span className="inline-flex items-center gap-0.5">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <HeaderFilter config={columnFilters[h.column.id]!} />
                        </span>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                    ),
                  )}
                  <TableHead className="w-32 sm:sticky sm:right-0 sm:border-l sm:bg-card sm:shadow-[-8px_0_12px_-6px_rgba(0,0,0,0.18)]">
                    {t("操作")}{' '}</TableHead>
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className={cn(loading && data.length > 0 && 'opacity-50 transition-opacity')}>
              {loading && data.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: columns.length + 1 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full max-w-[120px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length + 1} className="p-0">
                    <EmptyState
                      className="rounded-none border-0 bg-transparent"
                      title={t("没有找到匹配的岗位")}
                      description={t("建议优先移除关键词，其次地区、类型筛选")}
                      action={emptyAction}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="group cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelected(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          'max-w-xs truncate text-sm',
                          (cell.column.id === 'exam_time' || cell.column.id === 'created_at') &&
                            'hidden 2xl:table-cell',
                          cell.column.id === 'exam_type' && 'hidden min-[1750px]:table-cell',
                          cell.column.id === 'edu_level_norm' && 'hidden min-[1100px]:table-cell',
                          cell.column.id === 'employer' &&
                            'max-sm:sticky max-sm:left-0 max-sm:z-10 max-sm:max-w-[150px] max-sm:border-r max-sm:bg-card max-sm:shadow-[8px_0_12px_-6px_rgba(0,0,0,0.18)] group-hover:max-sm:bg-muted',
                        )}
                        title={String(cell.getValue() || '')}
                      >
                        {cell.column.id === 'year' ? (
                          <span className={cn(PILL_BASE, yearClass(row.original.year))}>
                            {String(cell.getValue() || '-')}
                          </span>
                        ) : cell.column.id === 'job_type' ? (
                          <span className={cn(PILL_BASE, jobTypeClass(row.original.job_type))}>
                            {t(String(cell.getValue() || '-'))}
                          </span>
                        ) : cell.column.id === 'edu_level_norm' ? (
                          <span className={cn(PILL_BASE, eduClass(String(cell.getValue() || '')))}>
                            {t(String(cell.getValue() || '-'))}
                          </span>
                        ) : cell.column.id === 'work_location' &&
                          foldGroups.has(row.original.id) &&
                          foldGroups.get(row.original.id)!.locations.length !== 1 ? (
                          <button
                            type="button"
                            className="inline-flex max-w-full items-center gap-0.5 text-primary hover:underline"
                            title={foldGroups.get(row.original.id)!.locations.join(' / ')}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleGroup(foldGroups.get(row.original.id)!.key)
                            }}
                          >
                            <span className="whitespace-nowrap">
                              {tt`${foldGroups.get(row.original.id)!.locations.length || foldGroups.get(row.original.id)!.count} 个地区`}
                            </span>
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          </button>
                        ) : cell.column.id === 'work_location' && cell.getValue() ? (
                          <span
                            className={cn(
                              PILL_BASE,
                              'max-w-full truncate',
                              provinceClass(String(cell.getValue())),
                            )}
                          >
                            {truncate(String(cell.getValue()), 12)}
                          </span>
                        ) : cell.column.id === 'signup_time' ? (
                          <span className="inline-flex max-w-full items-center gap-1.5">
                            <span className="truncate">
                              {truncate(dateOnly(String(cell.getValue() || '-')))}
                            </span>
                            <DueBadge date={row.original.signup_deadline?.slice(0, 10)} />
                          </span>
                        ) : cell.column.id === 'created_at' ? (
                          String(cell.getValue() || '-').slice(0, 10)
                        ) : cell.column.id === 'employer' ||
                          cell.column.id === 'position_example' ? (
                          <>
                            <Highlight
                              text={truncate(
                                cell.column.id === 'position_example'
                                  ? dedupExamType(
                                      stripOrgPrefix(
                                        String(cell.getValue() || '-'),
                                        row.original.employer,
                                        row.original.exam_type_norm || row.original.exam_type,
                                      ),
                                      row.original.exam_type_norm || row.original.exam_type,
                                    )
                                  : String(cell.getValue() || '—'),
                              )}
                              query={highlight}
                            />
                            {cell.column.id === 'employer' && (
                              <>
                                <NewDot
                                  board="positions"
                                  id={row.original.id}
                                  createdAt={row.original.created_at}
                                  className="ml-1.5"
                                />
                                <SeenBadge board="positions" id={row.original.id} className="ml-1.5" />
                              </>
                            )}
                          </>
                        ) : (
                          truncate(String(cell.getValue() || '-'))
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="group-hover:bg-muted sm:sticky sm:right-0 sm:border-l sm:bg-card sm:shadow-[-8px_0_12px_-6px_rgba(0,0,0,0.18)]">
                      <div className="flex items-center gap-0.5">
                        <FavoriteButton item={row.original} />
                        <CompareButton item={row.original} />
                        <ShareTextButton
                          className="h-8 w-8"
                          text={buildShareText({
                            org: row.original.employer,
                            title: row.original.position_example,
                            location: row.original.work_location,
                            deadline: row.original.signup_time,
                            deepLink: jobShareUrl('positions', row.original.id),
                            url: row.original.source_url,
                          })}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 text-primary"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelected(row.original)
                          }}
                        >
                          {t("详情")}{' '}</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row">
          <div className="text-sm text-muted-foreground">
            {totalPartial ? t("至少 ") : t("共 ")}
            <span className="font-medium text-foreground">{formatTotal(total, totalCapped)}</span> {' '}{t("条 · 第")}{' '}
            <span className="font-medium text-foreground">
              {page}/{totalPages}
            </span>{' '}
            {t("页")}{' '}</div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
              aria-label={t("首页")}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              aria-label={t("上一页")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-1 text-sm text-muted-foreground sm:hidden">
              {page}/{totalPages}
            </span>
            {getPageNumbers().map((p, idx) =>
              p === '...' ? (
                <span key={`ellipsis-${idx}`} className="hidden px-2 text-muted-foreground sm:inline">
                  ...
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? 'default' : 'outline'}
                  size="sm"
                  className="hidden h-8 min-w-[2rem] px-2 sm:inline-flex"
                  onClick={() => onPageChange(Number(p))}
                >
                  {p}
                </Button>
              )
            )}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              aria-label={t("下一页")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages}
              aria-label={t("末页")}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger className="h-8 w-[100px]" aria-label={t("每页条数")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}{t("条/页")}{' '}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {selected && (
        <LazyPositionSheet
          item={selected}
          onClose={() => setSelected(null)}
          {...sheetNavProps(foldedData, selected, setSelected)}
          onOpenItem={setSelected}
          onTagClick={onTagClick}
        />
      )}
    </div>
  )
})

function HeaderFilter({ config }: { config: ColumnFilterConfig }) {
  const active = config.selected.length > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={tt`筛选${config.label}`}
            className={cn('relative h-6 w-6', active ? 'text-primary' : 'text-muted-foreground')}
          >
            <ListFilter className="h-3.5 w-3.5" />
            {active && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold text-primary-foreground">
                {config.selected.length}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="max-h-72 min-w-40 overflow-y-auto">
        {config.options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt}
            checked={config.selected.includes(opt)}
            closeOnClick={false}
            onCheckedChange={(checked) =>
              config.onChange(
                checked
                  ? [...config.selected, opt]
                  : config.selected.filter((v) => v !== opt),
              )
            }
          >
            {opt}
          </DropdownMenuCheckboxItem>
        ))}
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => config.onChange([])}>
              {t("清除")}{config.label}{t("筛选")}{' '}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
