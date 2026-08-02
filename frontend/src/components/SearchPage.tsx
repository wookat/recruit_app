import { ListPage } from './ListPage'
import { fetchPositions } from '@/api'

interface SearchPageProps {
  initialPresetKey?: string
  initialKeyword?: string
  initialEduLevel?: string[]
  initialProvince?: string[]
  initialLocation?: string[]
  crossPresets?: { key: string; label: string }[]
  onCrossPreset?: (key: string) => void
  crossLabel?: string
  crossFetchTotal?: (keyword: string) => Promise<number>
  onCrossOpen?: (keyword: string) => void
  onOpenBoardKw?: (board: 'positions' | 'campus' | 'bianzhi', keyword: string) => void
}

export function SearchPage(props: SearchPageProps) {
  return <ListPage title="岗位检索" fetcher={fetchPositions} showStats syncUrl {...props} />
}
