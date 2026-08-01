import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  profileUsable,
  saveProfile,
  useProfile,
  type UserProfile,
} from '@/lib/profile'

const EDU_LEVELS = ['大专/中专', '本科', '硕士研究生', '博士研究生']

interface Props {
  /** 匹配维度说明，如「按专业+城市匹配」。 */
  note: string
  active: boolean
  onApply: (p: UserProfile) => void
  onClear: () => void
}

/** 校招/编制板块的「按我的条件匹配」按钮，复用全站共享画像；未填写时展开引导填写。 */
export function MatchByProfileButton({ note, active, onApply, onClear }: Props) {
  const profile = useProfile()
  const [editing, setEditing] = useState(false)
  const [eduLevel, setEduLevel] = useState<string[]>(profile.eduLevel)
  const [major, setMajor] = useState(profile.major)
  const [locationText, setLocationText] = useState(profile.location.join('、'))

  const parseLocations = (text: string) =>
    text
      .split(/[、，,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)

  const saveAndApply = () => {
    const p: UserProfile = {
      eduLevel,
      major: major.trim(),
      location: parseLocations(locationText),
    }
    if (!profileUsable(p)) return
    saveProfile(p)
    setEditing(false)
    onApply(p)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={active ? 'default' : 'outline'}
          size="sm"
          className="min-h-11 gap-1.5 sm:min-h-8"
          onClick={() => {
            if (active) return
            if (profileUsable(profile)) {
              setEduLevel(profile.eduLevel)
              setMajor(profile.major)
              setLocationText(profile.location.join('、'))
              onApply(profile)
            } else {
              setEditing(true)
            }
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          按我的条件匹配
        </Button>
        <span className="text-xs text-muted-foreground">{note}</span>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 gap-1 text-xs text-muted-foreground sm:min-h-8"
            onClick={onClear}
          >
            <X className="h-3.5 w-3.5" />
            清除匹配
          </Button>
        )}
      </div>
      {editing && (
        <div className="space-y-3 rounded-xl border border-primary/15 bg-gradient-to-br from-primary/[0.03] to-muted/30 p-3 sm:p-4">
          <p className="text-xs text-muted-foreground">
            先填写你的条件（与体制内「一键匹配」共用同一份画像，填一次全站可用）
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">学历</label>
              <div className="flex flex-wrap gap-1.5">
                {EDU_LEVELS.map((e) => (
                  <Badge
                    key={e}
                    variant={eduLevel.includes(e) ? 'default' : 'outline'}
                    className="cursor-pointer text-xs"
                    onClick={() =>
                      setEduLevel((prev) =>
                        prev.includes(e) ? prev.filter((v) => v !== e) : [...prev, e],
                      )
                    }
                  >
                    {e}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">专业关键词</label>
              <Input
                placeholder="如：计算机、法学、会计"
                value={major}
                onChange={(e) => setMajor(e.target.value)}
                className="h-9"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveAndApply()
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                意向城市/省份（顿号分隔）
              </label>
              <Input
                placeholder="如：山东、济南"
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                className="h-9"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveAndApply()
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="min-h-11 sm:min-h-8"
              onClick={saveAndApply}
              disabled={!major.trim() && !parseLocations(locationText).length}
            >
              保存并匹配
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-8"
              onClick={() => setEditing(false)}
            >
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
