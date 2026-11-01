import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { TeamsSection } from '../core/features/settings/ui/sections/teams-section';
const Page = editorLeaf(() => { const { teamId, tab } = Route.useParams(); return <TeamsSection teamId={teamId} tab={tab} />; });
export const Route = createFileRoute('/app/settings/teams/$teamId/$tab')({ component: Page });
