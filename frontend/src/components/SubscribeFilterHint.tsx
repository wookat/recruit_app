import { t } from '@/lib/i18n'
import { useState } from 'react'
import { BellPlus, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** 空结果引导：把当前筛选存为常用筛选，上新时自动提示。 */
export function SubscribeFilterHint({
  canSave,
  onSubscribe,
}: {
  canSave: boolean
  onSubscribe: () => void
}) {
  const [done, setDone] = useState(false)
  if (!canSave) return null
  if (done)
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-primary" />
        {t("已存为常用筛选，有匹配新岗位时会在筛选 chip 上提示「+N 新」")}{' '}</p>
    )
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="h-auto min-h-11 gap-1.5 text-xs sm:min-h-8"
        onClick={() => {
          onSubscribe()
          setDone(true)
        }}
      >
        <BellPlus className="h-3.5 w-3.5" />
        {t("订阅此筛选")}{' '}</Button>
      <span className="text-xs text-muted-foreground">{t("存为常用筛选，之后有匹配的新岗位会自动提示")}</span>
    </div>
  )
}
