/** 详情面板「上一条/下一条」导航 props（当前列表页内顺序）。 */
export function sheetNavProps<T extends { id: number }>(
  list: T[],
  current: T,
  select: (item: T) => void,
) {
  const i = list.findIndex((x) => x.id === current.id)
  return {
    onPrev: () => {
      if (i > 0) select(list[i - 1])
    },
    onNext: () => {
      if (i >= 0 && i < list.length - 1) select(list[i + 1])
    },
    prevDisabled: i <= 0,
    nextDisabled: i < 0 || i >= list.length - 1,
  }
}
