import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { WorkspaceSection } from '../core/features/settings/ui/sections/workspace-section';
export const Route = createFileRoute('/app/settings/workspace')({ component: editorLeaf(WorkspaceSection) });
