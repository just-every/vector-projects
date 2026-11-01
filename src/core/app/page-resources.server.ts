import { requestBindings } from './request-bindings.server'
import { readSettingsResources } from './settings-page-resources.server'
import { visibilityDatabase } from '../features/roles/visibility-database'
import { createApiApp } from './api'
import { Hono } from 'hono'
import type { AppEnvironment } from './bindings'
import type { WorkerBindings } from './bindings'
import type { InitialResources } from './initial-resources'
import { issueListQuerySchema } from '../features/issues/list-schema'
import { issueListApiUrl, issueListLayoutQuery } from '../features/issues/ui/issue-list-controls'
import { configureNotifications, needsNotificationDrain, notificationEventIds, directMessageEventIds } from '../features/notifications/context'
import { drainNotificationMail } from '../features/notifications/mail'
import { deliverCommittedDirectMessages } from '../features/integrations/outbound'
import type { WorkspaceProjection } from '../features/streams/snapshot'
import { admittedStreamSnapshot, selectedStreamResources, streamPreference } from './stream-page-resources.server'
import { defaultStreamFilters, filterItems, type StreamFilters } from '../features/streams/ui/helpers'
import type { StreamItem } from '../features/streams/ui/data'

/** Run the normal read routes inside the document's native authorization fence. */
export async function pageResources(env: WorkerBindings, request: Request, operator: import('./bindings').AppEnvironment['Variables']['operator'], href: string) {
  env = requestBindings(env)
  env = {...env,DB:visibilityDatabase(env.DB,operator.id)}
  configureNotifications(env.DB, env)
  try { return await readPageResources(env, request, operator, href) }
  finally {
    if (await needsNotificationDrain(env.DB)) {
      try { await drainNotificationMail(env, { eventIds: notificationEventIds(env.DB) }) }
      catch { console.error('Notification mail drain interrupted; durable intent retained for recovery.') }
    }
    try { await deliverCommittedDirectMessages(env, directMessageEventIds(env.DB)) }
    catch { console.error('Slack direct message delivery interrupted; durable intent retained for Cron.') }
  }
}

export async function readPageResources(env: WorkerBindings, request: Request, operator: AppEnvironment['Variables']['operator'], href: string, initial: InitialResources = {}) {
  env = requestBindings(env)
  env = {...env,DB:visibilityDatabase(env.DB,operator.id)}
  const url = new URL(href, env.APP_ORIGIN)
  if (url.origin !== env.APP_ORIGIN || !/^\/app(?:\/|$)/.test(url.pathname)) return {}
  const workspace: WorkspaceProjection = {}
  const app = new Hono<AppEnvironment>().route('/api', createApiApp({ operator, workspace }))
  const values: InitialResources = { ...initial }
  const reads = new Map<string, Promise<unknown>>()
  const read = (path: string) => {
    if (Object.hasOwn(values, path)) return Promise.resolve(values[path])
    let pending = reads.get(path)
    if (!pending) {
      pending = (async () => {
        const response = await app.fetch(new Request(new URL(path, env.APP_ORIGIN), { headers: request.headers }), env)
        // Failed resources use their existing visible error/retry path in the browser.
        if (!response.ok) return null
        return values[path] = await response.json()
      })()
      reads.set(path, pending)
    }
    return pending
  }
  const detail = async (identifier: string) => {
    const base = '/api/issues/' + encodeURIComponent(identifier)
    await Promise.all([read(base), read(base + '/discussion'), read(base + '/subscription'), read(base + '/github'), read(base + '/reminders'), read(base + '/references'), read(base + '/email-intake'), read(base + '/reactions')])
  }
  const shared = [read('/api/triage-responsibility'), read('/api/settings/personal-time'), read('/api/views'), read('/api/notifications/count'), read('/api/mentions/options')]
  const path = url.pathname
  const personal = path.match(/^\/app\/my-work\/(created|subscribed|activity)(?:\/([A-Z]{2,10}-[1-9][0-9]*))?$/)
  const surface = personal ? null : path === '/app' || path.startsWith('/app/current') ? 'current'
    : path.startsWith('/app/my-work') ? 'my-work' : null
  if (personal?.[1] === 'activity') await Promise.all([read('/api/my-work/activity'), read('/api/options')])
  else if (personal) {
    const query = issueListQuerySchema.parse({ ...Object.fromEntries(url.searchParams), scope: personal[1] })
    await Promise.all([read('/api/options'), read(issueListApiUrl(query)), personal[2] ? detail(personal[2]) : Promise.resolve()])
  } else if (surface) {
    const options = read('/api/options')
    const data = await read('/api/' + surface) as { sections: Record<string, StreamItem[]> } | null
    const snapshot = admittedStreamSnapshot(workspace, operator)
    const preferencePath = '/api/preferences/' + surface
    let preference: unknown
    if (snapshot) {
      try { preference = values[preferencePath] = streamPreference(snapshot, operator.id, surface) }
      // Invalid persisted preferences retain their existing API error path.
      catch { preference = await read(preferencePath) }
    } else preference = await read(preferencePath)
    const selected = path.match(/\/([A-Z]{2,10}-[1-9][0-9]*)$/)?.[1]
    const prefs = preference as { filters?: Partial<StreamFilters> } | null
    const items = filterItems(Object.values(data?.sections ?? {}).flat(), { ...defaultStreamFilters, ...prefs?.filters })
    const identifier = selected ?? items[0]?.identifier
    if (identifier) {
      const resources = snapshot && await selectedStreamResources(visibilityDatabase(env.DB,operator.id), snapshot, operator, identifier)
      if (resources) {
        Object.assign(values, resources)
        await Promise.all(['reminders', 'references', 'email-intake', 'reactions'].map(suffix => read('/api/issues/' + encodeURIComponent(identifier) + '/' + suffix)))
      }
      else await detail(identifier)
    }
    else await Promise.all([read('/api/issues'), read('/api/issues?category=completed')])
    await options
  } else if (/^\/app\/issues\/[^/]+$/.test(path) && path !== '/app/issues/backlog') {
    await Promise.all([read('/api/options'), detail(path.split('/').at(-1)!)])
  } else if (/^\/app\/(issues|board)(?:\/|$)/.test(path)) {
    const surface = path.startsWith('/app/board') ? 'board' : 'issues'
    const [options, preference] = await Promise.all([read('/api/options'), read('/api/preferences/' + surface)])
    const query = issueListQuerySchema.parse(path === '/app/issues/backlog' ? { ...Object.fromEntries(url.searchParams), category: 'backlog' } : url.search ? Object.fromEntries(url.searchParams)
      : { ...(preference as { filters?: object } | null)?.filters, ...(preference as object) })
    const shown = issueListLayoutQuery(query, surface === 'board' ? 'board' : 'list')
    const teams = (options as { teams: Array<{ id: string }> } | null)?.teams
    const selected = path.match(/\/([A-Z]{2,10}-[1-9][0-9]*)$/)?.[1]
    await Promise.all([read(issueListApiUrl(surface === 'board' && shown.team === 'all' && teams?.length === 1 ? { ...shown, team: teams[0]!.id } : shown)), selected ? detail(selected) : Promise.resolve()])
  } else if (path === '/app/projects') {
    const preference = await read('/api/preferences/projects') as { filters: { includeArchived?: boolean } } | null
    await Promise.all([read('/api/projects' + (preference?.filters.includeArchived ? '?includeArchived=true' : '')), read('/api/metadata')])
  } else if (path === '/app/projects/new') await read('/api/metadata')
  else if (path === '/app/cycles') await read('/api/metadata')
  else if (path === '/app/triage') await read('/api/triage-responsibility')
  else if (path === '/app/inbox' || path === '/app/inbox/snoozed') await read('/api/notifications' + (path.endsWith('/snoozed') ? '?snoozed=true' : ''))
  else if (path === '/app/settings/audit') await read('/api/settings/audit?')
  else if (path === '/app/settings' || path.startsWith('/app/settings/') && !/^\/app\/settings\/(?:audit|oauth-consent)$/.test(path)) {
    await readSettingsResources(path.replace(/\/$/, ''), read)
  }
  else if (path === '/app/new' || path === '/app/new-issue') await read('/api/options')
  await Promise.all(shared)
  return values
}
