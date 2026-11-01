import { OAuthConsentPage } from '../core/features/oauth-apps/ui/consent-page';
import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { oldLinks, oldNames } from '../core/features/settings/ui/shell/old-links';
// The names Settings used before it had one path per section. Each lands on its canonical place, replacing the entry.
export const Route = createFileRoute('/app/settings_/$section')({
  beforeLoad: ({ params }) => {
    if (params.section === 'oauth-consent') return;
    if (!(oldNames as readonly string[]).includes(params.section)) throw notFound();
    throw redirect({ href: oldLinks[params.section]!, replace: true });
  },
  component: OAuthConsentPage,
});
