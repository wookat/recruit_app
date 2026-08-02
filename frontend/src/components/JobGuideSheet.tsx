import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, Search, ThumbsUp, X } from 'lucide-react'
import { fetchBianzhiJobs, type BianzhiJob } from '@/api'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Highlight } from '@/components/Highlight'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { FreshnessNote } from '@/components/FreshnessNote'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface GuideSection {
  key: string
  title: string
  blocks: { heading?: string; items: string[] }[]
}

interface TimelineStage {
  months: number[]
  label: string
  title: string
  tasks: string[]
  links: { label: string; href: string }[]
}

const TIMELINE_STAGES: TimelineStage[] = [
  {
    months: [7, 8],
    label: '7-8 月',
    title: '秋招提前批',
    tasks: [
      '完善简历并针对目标岗位定制，准备好一分钟自我介绍',
      '海投提前批：多免笔试、竞争小，是抢跑的黄金机会',
    ],
    links: [
      { label: '投提前批', href: '?board=campus&bpreset=autumn&bkw=%E6%8F%90%E5%89%8D%E6%89%B9' },
      { label: '免笔试专区', href: '?board=campus&bpreset=noexam' },
    ],
  },
  {
    months: [9, 10],
    label: '9-10 月',
    title: '秋招正式批（黄金窗口）',
    tasks: [
      '岗位量最大的爆发期，每周保持投递节奏，同步刷笔试题准备面试',
      '10 月国考报名，体制内路线同步启动两手准备',
    ],
    links: [
      { label: '投秋招正式批', href: '?board=campus&bpreset=autumn' },
      { label: '搜国考岗位', href: '/?keyword=%E5%9B%BD%E8%80%83' },
    ],
  },
  {
    months: [11, 12],
    label: '11-12 月',
    title: '秋招补录',
    tasks: [
      '关注补录与捕捞未招满岗位，复盘笔面试迭代表现',
      '11 月底国考笔试，兼顾备考与补录投递',
    ],
    links: [
      { label: '看全部校招', href: '?board=campus&bpreset=all' },
      { label: '截止日历', href: '?board=calendar' },
    ],
  },
  {
    months: [1],
    label: '1 月',
    title: '寒假蓄力',
    tasks: [
      '复盘秋招、备考省考/事业编联考，关注寒假实习',
    ],
    links: [
      { label: '实习专区', href: '?board=campus&bpreset=intern' },
      { label: '编制公告', href: '?board=bianzhi' },
    ],
  },
  {
    months: [2, 3],
    label: '2-3 月',
    title: '春招爆发期',
    tasks: [
      '春招启动、3 月爆发：岗位少于秋招，投3周内新发岗位成功率最高',
      '省考联考集中报名，编制线同步推进',
    ],
    links: [
      { label: '投春招', href: '?board=campus&bpreset=spring' },
      { label: '编制公告', href: '?board=bianzhi' },
    ],
  },
  {
    months: [4, 5],
    label: '4-5 月',
    title: '春招收尾 / 补录',
    tasks: [
      '抓住春招补录和事业编联考面试，处理 offer 取舍',
    ],
    links: [
      { label: '春招补录', href: '?board=campus&bpreset=spring' },
      { label: '截止日历', href: '?board=calendar' },
    ],
  },
  {
    months: [6],
    label: '6 月',
    title: '毕业季 / 秋招预热',
    tasks: [
      '应届末班车与下届提前批预热，实习转正窗口',
    ],
    links: [
      { label: '实习专区', href: '?board=campus&bpreset=intern' },
      { label: '看全部校招', href: '?board=campus&bpreset=all' },
    ],
  },
]

const SECTIONS: GuideSection[] = [
  {
    key: 'mindset',
    title: '心态建设',
    blocks: [
      {
        items: [
          '求职是场马拉松，不是百米冲刺：校招从大四开学持续到毕业前，应届生平均要 3-5 个月才拿到心仪 offer，不要因一时挫折慌张。',
          '投简历要勇敢：JD 里的要求有一半是「最好有」而不是「必须有」，符合 60% 要求就值得尝试，机会是投出来的。',
          '被拒 ≠ 你不行：HC 已满、团队风格不匹配、面试发挥失常都很常见，大部分时候是匹配度和时机问题，不是能力问题。',
        ],
      },
    ],
  },
  {
    key: 'resume',
    title: '简历制作',
    blocks: [
      {
        heading: '吃透目标岗位',
        items: [
          '逐条对照 JD 提炼关键词，把自己的经历向岗位要求靠拢，一岗一简历。',
        ],
      },
      {
        heading: 'STAR 原则写经历',
        items: [
          'Situation 背景 → Task 任务 → Action 行动 → Result 结果，结果尽量量化（提升了多少、服务了多少人）。',
        ],
      },
      {
        heading: '形式与避雷',
        items: [
          '一页为宜、PDF 投递、命名「姓名-学校-岗位」。',
          '避雷：错别字、大段空话、与岗位无关的流水账、过度美化模板。',
        ],
      },
    ],
  },
  {
    key: 'interview',
    title: '面试攻略',
    blocks: [
      {
        heading: '面试前',
        items: [
          '研究公司业务与岗位职责，准备 1 分钟自我介绍和 3-5 个高频问题答案，用 STAR 组织案例。',
        ],
      },
      {
        heading: '面试中',
        items: [
          '结论先行、条理清晰；不会的问题坦诚说思路；主动展示与岗位匹配的经历。',
        ],
      },
      {
        heading: '面试后',
        items: ['24 小时内可礼貌跟进；及时复盘记录问题，迭代下一场表现。'],
      },
    ],
  },
  {
    key: 'timeline',
    title: '秋招/春招时间线',
    blocks: TIMELINE_STAGES.map((st) => ({
      heading: `${st.label} ${st.title}`,
      items: st.tasks,
    })),
  },
  {
    key: 'biancal',
    title: '编制考试日历',
    blocks: [
      {
        items: [
          '大型联考（省考联考、事业编联考等）是编制岗最大的批量招录窗口，下方自动列出最近场次，点击可直达公告详情。',
        ],
      },
    ],
  },
  {
    key: 'company',
    title: '企业类型特点',
    blocks: [
      {
        items: [
          '央国企：稳定、流程规范，笔试多为行测类，重视党员/学生干部经历。',
          '互联网/民企：节奏快、薪资弹性大，重视项目与实习经历。',
          '外企：重视英语与综合素质，流程较长，多轮面试。',
          '事业单位/编制岗：需参加统一考试，可在本站「编制公告」板块查看最新公告。',
        ],
      },
    ],
  },
  {
    key: 'choose',
    title: '编制 vs 校招怎么选',
    blocks: [
      {
        heading: '稳定性',
        items: [
          '编制岗：入编后稳定性强，裁员风险极低，适合追求长期确定性的人。',
          '校招（企业）：稳定性因企业而异，央国企相对稳、互联网/民企波动大，但转换赛道更灵活。',
        ],
      },
      {
        heading: '薪资与成长',
        items: [
          '编制岗：起薪与涨幅相对平缓，胜在福利保障齐全、生活节奏可预期。',
          '校招（企业）：起薪上限和涨幅弹性更大，尤其互联网/金融，但与业绩和行业周期强相关。',
        ],
      },
      {
        heading: '考试/选拔方式',
        items: [
          '编制岗：以统一笔试（行测/申论/公基/专业科目）+ 面试为主，备考周期长、竞争按分数说话。',
          '校招（企业）：简历筛选 + 笔试/测评 + 多轮面试，更看重实习项目经历与临场表现。',
        ],
      },
      {
        heading: '时间线',
        items: [
          '两条线可并行：秋招（9-10 月）先投企业保底，国考（10 月报名）、省考联考（次年上半年）与事业编考试穿插进行，拿到 offer 后再做取舍。',
        ],
      },
      {
        heading: '适合人群',
        items: [
          '倾向编制：追求稳定与家庭生活平衡、擅长应试、目标城市有合适编制岗位的同学。',
          '倾向校招：追求薪资上限与快速成长、有拿得出手的实习/项目、能接受一定不确定性的同学。',
          '拿不准就两手准备：用本站三个板块同步跟进，收藏+投递追踪管理两条线的截止时间。',
        ],
      },
    ],
  },
  {
    key: 'about',
    title: '数据说明',
    blocks: [
      {
        heading: '数据来源',
        items: [
          '体制内岗位：采自国家公务员局、军队人才网、国聘网及各省官方招考公告页面。',
          '校招与编制公告：汇总自飞书多维表格（校招汇总表/编制公告表），条目均附官方公告/投递链接，可在详情中直达原始出处核对。',
        ],
      },
      {
        heading: '更新频率',
        items: [
          '每天 6:00 自动检查官方公告来源，6:20 自动同步飞书校招/编制表格增量，同步后自动刷新统计与缓存；当前各板块最近更新时间见下方。',
          '新增岗位可在顶栏「今日更新」页按日查看近 7 天三板块新增。',
        ],
      },
      {
        heading: '免责声明',
        items: [
          '本站为公开招考信息的聚合检索工具，信息仅供参考，不构成报考建议；岗位条件、截止时间等一切以官方公告为准，报名前请务必通过详情中的来源链接核对原文。',
          '链接失效或岗位下线属正常情况（招考方会关闭批次），不代表数据错误。',
        ],
      },
      {
        heading: '反馈渠道',
        items: [
          '发现数据错误或有功能建议？请先对照详情中的官方来源链接确认；确认为本站问题后，可通过运营方渠道反馈（站内反馈入口筹建中），我们会在每日同步中修正。',
        ],
      },
    ],
  },
  {
    key: 'tips',
    title: '使用技巧与误区',
    blocks: [
      {
        items: [
          '优先看每天更新的公司，直接打开公司投递链接确认最新岗位——找工作要主动，不要等。',
          '筛选城市：用列表上方的城市 chips 或搜索工作地关键词；多数企业多地招聘，全国基本都有覆盖。',
          '按专业找岗位：用「专业就业方向」指南先确定对口行业，再按行业/关键词筛选。',
          '链接打不开或岗位已下线属正常情况（企业会关闭批次），以企业官方渠道为准。',
        ],
      },
    ],
  },
]

export const GUIDE_SECTION_KEYS = SECTIONS.map((s) => s.key)

const VOTES_KEY = 'recruit.guideVotes'

function readVotes(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VOTES_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function GuideTimeline() {
  const curMonth = new Date().getMonth() + 1
  return (
    <ol className="space-y-3">
      {TIMELINE_STAGES.map((st) => {
        const current = st.months.includes(curMonth)
        return (
          <li key={st.label} className="relative pl-5">
            <span
              className={cn(
                'absolute left-0 top-4 h-2.5 w-2.5 rounded-full',
                current ? 'bg-primary ring-4 ring-primary/20' : 'bg-border',
              )}
              aria-hidden="true"
            />
            <div
              className={cn(
                'rounded-lg border bg-background p-3',
                current && 'border-primary/40 bg-primary/5',
              )}
            >
              <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                <span className="text-xs text-muted-foreground">{st.label}</span>
                {st.title}
                {current && (
                  <Badge className="text-[11px]">当前阶段</Badge>
                )}
              </div>
              <ul className="mt-1.5 space-y-1 text-sm leading-relaxed text-muted-foreground">
                {st.tasks.map((t, i) => (
                  <li key={i}>· {t}</li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {st.links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    className="inline-flex min-h-11 items-center gap-1 rounded-full border border-primary/30 bg-background px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/10 sm:min-h-0"
                  >
                    {l.label}
                    <ArrowRight className="h-3 w-3" />
                  </a>
                ))}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function BianzhiExamCalendar() {
  const [jobs, setJobs] = useState<BianzhiJob[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    fetchBianzhiJobs({ category: ['大型联考'], page_size: 100 })
      .then((res) => {
        if (alive) setJobs(res.items)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])
  if (failed) return <p className="text-sm text-muted-foreground">联考场次加载失败，可前往编制公告板块查看。</p>
  if (!jobs) return <p className="text-sm text-muted-foreground">正在加载联考场次…</p>
  const todayIso = new Date().toISOString().slice(0, 10)
  const dated = jobs.filter((j) => j.deadline_date)
  const future = dated
    .filter((j) => j.deadline_date! >= todayIso)
    .sort((a, b) => a.deadline_date!.localeCompare(b.deadline_date!))
  const history = dated
    .filter((j) => j.deadline_date! < todayIso)
    .sort((a, b) => b.deadline_date!.localeCompare(a.deadline_date!))
  const list = (future.length > 0 ? future : history).slice(0, 5)
  const showingHistory = future.length === 0
  if (list.length === 0)
    return <p className="text-sm text-muted-foreground">暂无带日期的联考场次数据，可前往编制公告板块查看全部公告。</p>
  return (
    <div className="space-y-2">
      {showingHistory && (
        <p className="text-xs text-muted-foreground">
          暂无未来场次，以下为最近的历史场次，下一轮联考公告发布后会自动更新：
        </p>
      )}
      <ul className="space-y-1.5">
        {list.map((j) => (
          <li key={j.id}>
            <a
              href={`?board=bianzhi&bpreset=lk&job=bianzhi:${j.id}`}
              className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border bg-background px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="font-medium">
                {j.employer || `${j.province ?? ''}${j.job_type ?? ''}联考`}
              </span>
              <span className="text-xs text-muted-foreground">
                {[j.province, j.job_type].filter(Boolean).join(' · ')}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {j.exam_time ? `考试 ${j.deadline_date || j.exam_time}` : `截止 ${j.deadline_text || j.deadline_date}`}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <a
        href="?board=bianzhi"
        className="inline-flex min-h-11 items-center gap-1 text-xs text-primary underline-offset-2 hover:underline sm:min-h-0"
      >
        前往编制公告板块查看全部
        <ArrowRight className="h-3 w-3" />
      </a>
    </div>
  )
}

function setGuideHash(key: string | null) {
  const base = window.location.pathname + window.location.search
  window.history.replaceState(null, '', key ? `${base}#${key}` : base)
}

export function JobGuideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState(() => {
    const h = window.location.hash.slice(1)
    return SECTIONS.some((s) => s.key === h) ? h : SECTIONS[0].key
  })
  const [query, setQuery] = useState('')
  const [votes, setVotes] = useState<Record<string, number>>(readVotes)
  const section = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0]

  const toggleVote = (key: string) => {
    setVotes((cur) => {
      const next = { ...cur, [key]: cur[key] ? 0 : 1 }
      localStorage.setItem(VOTES_KEY, JSON.stringify(next))
      return next
    })
  }

  const q = query.trim()
  const results = useMemo(() => {
    if (!q) return null
    const lq = q.toLowerCase()
    return SECTIONS.map((s) => ({
      section: s,
      hits: s.blocks.flatMap((b) =>
        b.items
          .filter(
            (item) =>
              item.toLowerCase().includes(lq) ||
              (b.heading ?? '').toLowerCase().includes(lq),
          )
          .map((item) => ({ heading: b.heading, item })),
      ),
    })).filter((r) => r.hits.length > 0)
  }, [q])

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setGuideHash(null)
          onClose()
        }
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>求职攻略</SheetTitle>
          <SheetDescription>整理自校招汇总表使用说明与学姐求职经验分享</SheetDescription>
        </SheetHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索攻略内容…"
            className="h-9 pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {!results && (
        <div className="flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setActive(s.key)
                setGuideHash(s.key)
              }}
              className={cn(
                'min-h-11 rounded-full border px-3 py-1 text-xs transition-colors sm:min-h-0',
                active === s.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {s.title}
            </button>
          ))}
        </div>
        )}
        <div className="h-auto min-h-0 max-h-full overflow-y-auto">
          {results ? (
            results.length === 0 ? (
              <EmptyState title="没有匹配的攻略内容" description="换个关键词试试，或清空搜索恢复全文" />
            ) : (
              <div className="space-y-4 pb-6">
                {results.map((r) => (
                  <div key={r.section.key} className="space-y-2">
                    <Badge variant="secondary" className="text-xs">
                      {r.section.title}
                    </Badge>
                    <ul className="space-y-2">
                      {r.hits.map((h, j) => (
                        <li
                          key={j}
                          className="rounded-lg border bg-background p-3 text-sm leading-relaxed text-muted-foreground"
                        >
                          {h.heading && (
                            <span className="mr-1 font-medium text-foreground">
                              <Highlight text={h.heading} query={q} />：
                            </span>
                          )}
                          <Highlight text={h.item} query={q} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          ) : (
          <div className="space-y-4 pb-6">
            {active === 'about' && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2">
                {(['positions', 'campus', 'bianzhi'] as const).map((b) => (
                  <span key={b} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {{ positions: '体制内', campus: '校招', bianzhi: '编制' }[b]}：
                    <FreshnessNote board={b} />
                  </span>
                ))}
              </div>
            )}
            {active === 'timeline' ? (
              <GuideTimeline />
            ) : active === 'biancal' ? (
              <div className="space-y-3">
                <p className="rounded-lg border bg-background p-3 text-sm leading-relaxed text-muted-foreground">
                  {section.blocks[0].items[0]}
                </p>
                <BianzhiExamCalendar />
              </div>
            ) : (
              section.blocks.map((b, i) => (
                <div key={i} className="space-y-2">
                  {b.heading && (
                    <Badge variant="secondary" className="text-xs">
                      {b.heading}
                    </Badge>
                  )}
                  <ul className="space-y-2">
                    {b.items.map((item, j) => (
                      <li
                        key={j}
                        className="rounded-lg border bg-background p-3 text-sm leading-relaxed text-muted-foreground"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <button
                type="button"
                aria-pressed={!!votes[active]}
                onClick={() => toggleVote(active)}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors sm:min-h-8',
                  votes[active]
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <ThumbsUp className={cn('h-3.5 w-3.5', votes[active] && 'fill-primary/20')} />
                {votes[active] ? '已觉得有用' : '有用'}
              </button>
              <span className="text-xs text-muted-foreground">
                共 {votes[active] || 0} 人觉得有用（本地统计）
              </span>
            </div>
          </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
