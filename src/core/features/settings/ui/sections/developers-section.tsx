import { IntegrationsPanel } from '../../../integrations/ui/integrations-panel';
import { OAuthAppsPanel } from '../../../oauth-apps/ui/settings-panel';
import { SectionGate } from '../shell/section-gate';
import { NotFoundLine, SectionPage } from '../shell/section-page';
import { useSettingsShell } from '../shell/settings-context';
import { WithAdministration } from './with-administration';

export const developerTabs = ['tokens', 'apps', 'deliveries'] as const;

/** Developers: tokens, OAuth apps and delivery history; a Member sees only their own tokens. */
export function DevelopersSection({ tab }: { tab?: string }) {
  return <SectionGate section="developers" title="Developers"><Developers tab={tab} /></SectionGate>;
}

function Developers({ tab }: { tab?: string }) {
  const { role } = useSettingsShell();
  const leads = role === 'owner' || role === 'admin';
  const parent = { label: 'Developers', to: '/app/settings/developers' } as const;
  if (tab && !(developerTabs as readonly string[]).includes(tab))
    return <SectionPage title="Developers"><NotFoundLine what="That page" back={parent} /></SectionPage>;
  const names = { tokens: 'Tokens', apps: 'Apps', deliveries: 'Delivery history' };
  return <SectionPage title="Developers" legacy parent={tab ? parent : undefined} record={tab ? names[tab as keyof typeof names] : undefined}>
    {leads
      ? <WithAdministration>{data => <>
        <IntegrationsPanel teams={data.teams} workspace part="developers" />
        <OAuthAppsPanel />
      </>}</WithAdministration>
      : <IntegrationsPanel teams={[]} workspace={false} part="developers" />}
  </SectionPage>;
}
