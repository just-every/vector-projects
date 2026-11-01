import { IntegrationsPanel } from '../../../integrations/ui/integrations-panel';
import { SectionGate } from '../shell/section-gate';
import { NotFoundLine, SectionPage } from '../shell/section-page';
import { WithAdministration } from './with-administration';

export const connectionKinds = ['slack', 'github', 'errors', 'webhooks', 'sources'] as const;

/** Connections. A service path shows the existing integrations panel under the service's breadcrumb until its record replaces it. */
export function ConnectionsSection({ kind }: { kind?: string }) {
  return <SectionGate section="connections" title="Connections">
    <WithAdministration>{data => {
      const parent = { label: 'Connections', to: '/app/settings/connections' } as const;
      if (kind && !(connectionKinds as readonly string[]).includes(kind))
        return <SectionPage title="Connections"><NotFoundLine what="That service" back={parent} /></SectionPage>;
      const names = { slack: 'Slack and Discord', github: 'GitHub', errors: 'Error tracking', webhooks: 'Webhooks', sources: 'Signal sources' };
      return <SectionPage title="Connections" legacy parent={kind ? parent : undefined} record={kind ? names[kind as keyof typeof names] : undefined}>
        <IntegrationsPanel teams={data.teams} workspace part="connections" />
      </SectionPage>;
    }}</WithAdministration>
  </SectionGate>;
}
