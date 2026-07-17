import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchPage } from '@/components/SearchPage'
import { SourcesPage } from '@/components/SourcesPage'
import { TasksPage } from '@/components/TasksPage'
import { Briefcase, FolderOpen, ListVideo } from 'lucide-react'

export default function App() {
  const [tab, setTab] = useState('search')

  return (
    <div className="min-h-screen bg-muted/30 font-sans">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Briefcase className="h-5 w-5" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">体制内岗位通</h1>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-3">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="grid h-10 w-full max-w-md grid-cols-3">
              <TabsTrigger value="search" className="gap-1.5">
                <Briefcase className="h-4 w-4" />
                岗位检索
              </TabsTrigger>
              <TabsTrigger value="sources" className="gap-1.5">
                <FolderOpen className="h-4 w-4" />
                来源目录
              </TabsTrigger>
              <TabsTrigger value="tasks" className="gap-1.5">
                <ListVideo className="h-4 w-4" />
                抓取队列
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === 'search' && <SearchPage />}
        {tab === 'sources' && <SourcesPage />}
        {tab === 'tasks' && <TasksPage />}
      </main>

      <footer className="border-t bg-background py-6 text-center text-xs text-muted-foreground">
        数据来源：国家公务员局、军队人才网、国聘网及各省官方/汇总页面 · 仅供参考
      </footer>
    </div>
  )
}
