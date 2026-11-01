import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { MoveInSection } from '../core/features/settings/ui/sections/move-in-section';
export const Route = createFileRoute('/app/settings/move-in')({ component: editorLeaf(MoveInSection) });
