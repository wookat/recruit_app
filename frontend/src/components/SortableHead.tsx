import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'
import type { SortState } from '@/lib/tableSort'

interface Props {
  label: string
  sortKey: string
  sort: SortState | null
  onToggle: (key: string) => void
  className?: string
}

export function SortableHead({ label, sortKey, sort, onToggle, className }: Props) {
  const active = sort?.key === sortKey
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className="inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground"
      >
        {label}
        {active ? (
          sort.dir === 'asc' ? (
            <ArrowUp className="h-3 w-3 text-primary" />
          ) : (
            <ArrowDown className="h-3 w-3 text-primary" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  )
}
