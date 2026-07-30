import { useState } from 'react'

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import type { Position } from '@/api'
import { PositionSheet } from './PositionSheet'
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
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

const columns: ColumnDef<Position>[] = [
  { accessorKey: 'year', header: '年份', size: 70 },
  { accessorKey: 'job_type', header: '工作类型', size: 100 },
  { accessorKey: 'exam_type', header: '考试/招聘类型', size: 200 },
  { accessorKey: 'employer', header: '用人单位/系统', size: 220 },
  { accessorKey: 'position_example', header: '岗位示例', size: 260 },
  {
    id: 'edu_level_norm',
    accessorFn: (row) => row.edu_level_norm || row.edu_requirement,
    header: '学历要求',
    size: 100,
  },
  { accessorKey: 'work_location', header: '工作地点', size: 120 },
  { accessorKey: 'signup_time', header: '报名时间', size: 160 },
  { accessorKey: 'exam_time', header: '考试时间', size: 160 },
]

interface Props {
  data: Position[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  loading: boolean
}

export function PositionTable({
  data,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading,
}: Props) {
  const [selected, setSelected] = useState<Position | null>(null)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const table = useReactTable({
    data,
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
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent">
                  {hg.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      className="whitespace-nowrap"
                      style={{ width: h.column.getSize() }}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                  <TableHead className="w-32">操作</TableHead>
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
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
                      title="没有找到匹配的岗位"
                      description="试试减少筛选条件、更换关键词，或使用一键匹配推荐岗位"
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
                        className="max-w-xs truncate text-sm"
                        title={String(cell.getValue() || '')}
                      >
                        {cell.column.id === 'year' ? (
                          <Badge variant="outline" className="font-medium">
                            {String(cell.getValue() || '-')}
                          </Badge>
                        ) : (
                          truncate(String(cell.getValue() || '-'))
                        )}
                      </TableCell>
                    ))}
                    <TableCell>
                      <div className="flex items-center gap-0.5">
                        <FavoriteButton item={row.original} />
                        <CompareButton item={row.original} />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 text-primary"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelected(row.original)
                          }}
                        >
                          详情
                        </Button>
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
            共 <span className="font-medium text-foreground">{total.toLocaleString()}</span> 条 · 第{' '}
            <span className="font-medium text-foreground">
              {page}/{totalPages}
            </span>{' '}
            页
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange(1)}
              disabled={page <= 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
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
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger className="h-8 w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}条/页
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {selected && <PositionSheet item={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
