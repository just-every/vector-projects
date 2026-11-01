import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { ConnectionsSection } from '../core/features/settings/ui/sections/connections-section';
const Page = editorLeaf(() => { const { kind } = Route.useParams(); return <ConnectionsSection kind={kind} />; });
export const Route = createFileRoute('/app/settings/connections/$kind')({ component: Page });
