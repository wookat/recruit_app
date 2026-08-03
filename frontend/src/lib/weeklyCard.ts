/** 本周求职小结分享卡：纯 canvas 渲染品牌风格图片，无额外依赖。 */

export interface WeeklyCardData {
  rangeText: string
  stats: { label: string; value: number }[]
  cheer: string
}

const W = 750
const H = 940

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line) lines.push(line)
  return lines
}

export function renderWeeklyCard(data: WeeklyCardData): HTMLCanvasElement {
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  // 品牌渐变背景
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#1d4ed8')
  bg.addColorStop(1, '#7c3aed')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 装饰圆
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath()
  ctx.arc(W - 60, 90, 130, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(40, H - 80, 100, 0, Math.PI * 2)
  ctx.fill()

  // 标题
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 44px "PingFang SC","Microsoft YaHei",sans-serif'
  ctx.fillText('本周求职小结', 56, 110)
  ctx.font = '26px "PingFang SC","Microsoft YaHei",sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.fillText(`${data.rangeText} · 近 7 天`, 56, 156)

  // 白色内容卡
  roundRect(ctx, 40, 200, W - 80, 520, 28)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  // 2x2 统计块
  const tileW = (W - 80 - 48 - 24) / 2
  const tileH = 200
  data.stats.slice(0, 4).forEach((s, i) => {
    const x = 64 + (i % 2) * (tileW + 24)
    const y = 232 + Math.floor(i / 2) * (tileH + 24)
    roundRect(ctx, x, y, tileW, tileH, 20)
    ctx.fillStyle = i % 2 === 0 ? '#eff6ff' : '#f5f3ff'
    ctx.fill()
    ctx.fillStyle = i % 2 === 0 ? '#1d4ed8' : '#7c3aed'
    ctx.font = 'bold 72px "PingFang SC","Microsoft YaHei",sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(String(s.value), x + tileW / 2, y + 100)
    ctx.font = '28px "PingFang SC","Microsoft YaHei",sans-serif'
    ctx.fillStyle = '#64748b'
    ctx.fillText(s.label, x + tileW / 2, y + 155)
    ctx.textAlign = 'left'
  })

  // 鼓励语
  if (data.cheer) {
    ctx.font = '28px "PingFang SC","Microsoft YaHei",sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    const lines = wrapText(ctx, data.cheer, W - 140)
    lines.slice(0, 2).forEach((l, i) => {
      ctx.textAlign = 'center'
      ctx.fillText(l, W / 2, 790 + i * 42)
      ctx.textAlign = 'left'
    })
  }

  // 页脚品牌
  ctx.textAlign = 'center'
  ctx.font = 'bold 30px "PingFang SC","Microsoft YaHei",sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('jobs.zalize.com', W / 2, 880)
  ctx.font = '26px "PingFang SC","Microsoft YaHei",sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.fillText('体制内 · 校招 · 编制岗位一站检索', W / 2, 916)
  ctx.textAlign = 'left'

  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
