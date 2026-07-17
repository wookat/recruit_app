import { ListPage } from './ListPage'
import { fetchPositions } from '@/api'

export function SearchPage() {
  return <ListPage title="岗位检索" fetcher={fetchPositions} />
}
