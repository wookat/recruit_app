import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
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
    blocks: [
      {
        heading: '秋招（大四上）',
        items: [
          '7-8 月提前批 → 9-10 月正式批爆发期（黄金窗口）→ 11-12 月补录，越早投越有优势。',
        ],
      },
      {
        heading: '春招（大四下）',
        items: [
          '2-3 月启动，3 月是爆发期，4-5 月收尾补录；春招岗位少于秋招，是最后的批量机会。',
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

function setGuideHash(key: string | null) {
  const base = window.location.pathname + window.location.search
  window.history.replaceState(null, '', key ? `${base}#${key}` : base)
}

export function JobGuideSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState(() => {
    const h = window.location.hash.slice(1)
    return SECTIONS.some((s) => s.key === h) ? h : SECTIONS[0].key
  })
  const section = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0]

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
        <div className="h-auto min-h-0 max-h-full overflow-y-auto">
          <div className="space-y-4 pb-6">
            {section.blocks.map((b, i) => (
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
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
