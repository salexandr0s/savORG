import { getRepos } from '@/lib/repo'
import { PluginsClient } from './plugins-client'

export default async function PluginsPage() {
  const repos = getRepos()
  const { data: plugins, meta } = await repos.plugins.list()
  return <PluginsClient plugins={plugins} meta={meta} />
}
