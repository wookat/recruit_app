import { ListPage } from './ListPage'
import { fetchSources } from '@/api'

export function SourcesPage() {
  return <ListPage title="官方来源目录" fetcher={fetchSources} />
}
