import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { PeopleSection } from '../core/features/settings/ui/sections/people-section';
const Page = editorLeaf(() => { const { operatorId } = Route.useParams(); return <PeopleSection operatorId={operatorId} />; });
export const Route = createFileRoute('/app/settings/people/$operatorId')({ component: Page });
