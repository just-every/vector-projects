import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { TeamsSection } from '../core/features/settings/ui/sections/teams-section';
export const Route = createFileRoute('/app/settings/teams/')({ component: editorLeaf(TeamsSection) });
