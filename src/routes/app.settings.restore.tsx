import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { RestoreSection } from '../core/features/settings/ui/sections/restore-section';
export const Route = createFileRoute('/app/settings/restore')({ component: editorLeaf(RestoreSection) });
