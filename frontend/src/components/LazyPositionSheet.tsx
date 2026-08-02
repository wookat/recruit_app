import { lazy, Suspense, type ComponentProps } from 'react'

const PositionSheet = lazy(() =>
  import('./PositionSheet').then((m) => ({ default: m.PositionSheet })),
)

/** 按需加载的岗位详情面板：item 为空时不加载 chunk，减小首屏 JS。 */
export function LazyPositionSheet(props: ComponentProps<typeof PositionSheet>) {
  if (!props.item) return null
  return (
    <Suspense fallback={null}>
      <PositionSheet {...props} />
    </Suspense>
  )
}
