import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { PeopleSection } from '../core/features/settings/ui/sections/people-section';
export const Route = createFileRoute('/app/settings/people/')({ component: editorLeaf(PeopleSection) });
