import * as React from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface OptionGroup {
  label: string
  options: string[]
}

interface MultiSelectProps {
  label: string
  options?: string[]
  groups?: OptionGroup[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
}

export function MultiSelect({
  label,
  options,
  groups,
  selected,
  onChange,
  placeholder = '搜索选项…',
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  const allOptions = React.useMemo(() => {
    const flat: string[] = []
    if (options) flat.push(...options)
    if (groups) groups.forEach((g) => flat.push(...g.options))
    return flat
  }, [options, groups])

  const renderOption = (opt: string) => {
    const isSelected = selected.includes(opt)
    return (
      <CommandItem
        key={opt}
        value={opt}
        onSelect={() => toggle(opt)}
        className="flex items-center gap-2"
      >
        <div
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-sm border',
            isSelected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-muted-foreground/25'
          )}
        >
          {isSelected && <Check className="h-3 w-3" />}
        </div>
        <span className="truncate">{opt}</span>
      </CommandItem>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="h-9 w-full justify-between px-3 text-left font-normal"
            >
              <span className="truncate">
                {selected.length === 0 ? '全部' : `已选 ${selected.length} 项`}
              </span>
              <div className="flex items-center gap-1">
                {selected.length > 0 && (
                  <span onClick={clear} className="rounded-full p-0.5 hover:bg-muted">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                )}
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </div>
            </Button>
          }
        />
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder={placeholder} />
            <CommandList className="max-h-64">
              <CommandEmpty>无匹配选项</CommandEmpty>
              {options && <CommandGroup>{options.map(renderOption)}</CommandGroup>}
              {groups?.map((group, idx) => (
                <React.Fragment key={group.label}>
                  {idx > 0 && options ? <CommandSeparator /> : idx > 0 ? <CommandSeparator /> : null}
                  <CommandGroup heading={group.label}>
                    {group.options.map(renderOption)}
                  </CommandGroup>
                </React.Fragment>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.slice(0, 3).map((v) => (
            <Badge key={v} variant="secondary" className="text-xs font-normal">
              {v}
            </Badge>
          ))}
          {selected.length > 3 && (
            <Badge variant="secondary" className="text-xs font-normal">
              +{selected.length - 3}
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}
