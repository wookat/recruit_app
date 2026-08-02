const KEY = 'recruit.favAddedAt'

type FavTimeMap = Record<string, string>

function read(): FavTimeMap {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as FavTimeMap) : {}
  } catch {
    return {}
  }
}

function write(map: FavTimeMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* 空间不足等忽略 */
  }
}

/** 记录收藏时间（board:id → ISO），供本周小结统计「新收藏」。 */
export function recordFavAdded(board: string, id: number) {
  const map = read()
  map[`${board}:${id}`] = new Date().toISOString()
  write(map)
}

export function removeFavAdded(board: string, id: number) {
  const map = read()
  if (!(`${board}:${id}` in map)) return
  delete map[`${board}:${id}`]
  write(map)
}

export function getFavAddedMap(): FavTimeMap {
  return read()
}
