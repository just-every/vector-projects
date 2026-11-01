type Read = (path: string) => Promise<unknown>

const leads = (role: string | undefined) => role === 'owner' || role === 'admin'
const hasPersonalTokens = (role: string | undefined) => role === 'owner' || role === 'admin' || role === 'member'

/**
 * What a Settings path reads at first paint. Each section reads only its own resources, and only the ones its role
 * may read: a refused read is never made for a role that is refused it. The layout's own reads come first
 * (`/api/settings` for every role, and an Owner's restore state).
 */
export async function readSettingsResources(path: string, read: Read, teamIds: (administration: unknown) => string[]) {
  const settings = await read('/api/settings') as { role: string } | null
  const role = settings?.role
  const section = path.split('/')[3]
  const index = section === undefined
  const reads: Promise<unknown>[] = []
  if (role === 'owner') reads.push(read('/api/data/restore'))
  const administration = () => read('/api/settings/administration')
  if (index) {
    reads.push(read('/api/settings/notifications/channels'))
    if (role) reads.push(administration())
    if (hasPersonalTokens(role)) reads.push(read('/api/settings/integrations/tokens'))
    if (leads(role)) reads.push(read('/api/settings/integrations'))
  } else switch (section) {
    case 'notifications':
      reads.push(read('/api/settings/notifications'), read('/api/settings/notifications/channels'))
      break
    case 'workspace': case 'labels': case 'housekeeping':
      if (role) reads.push(administration())
      break
    case 'teams':
      if (role) reads.push(administration().then(data => Promise.all(teamIds(data).map(id => read(`/api/settings/teams/${id}/email-intake`)))))
      break
    case 'connections':
      if (leads(role)) reads.push(administration(), read('/api/settings/integrations'))
      break
    case 'developers':
      if (leads(role)) reads.push(administration(), read('/api/settings/integrations'), read('/api/settings/integrations/tokens/usage'))
      else if (hasPersonalTokens(role)) reads.push(read('/api/settings/integrations/tokens'))
      break
    case 'move-in':
      if (leads(role)) reads.push(read('/api/data/import/runs'))
      break
  }
  await Promise.all(reads)
}
