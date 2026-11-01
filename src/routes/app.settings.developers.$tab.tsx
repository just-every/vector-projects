import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { DevelopersSection } from '../core/features/settings/ui/sections/developers-section';
const Page = editorLeaf(() => { const { tab } = Route.useParams(); return <DevelopersSection tab={tab} />; });
export const Route = createFileRoute('/app/settings/developers/$tab')({ component: Page });
