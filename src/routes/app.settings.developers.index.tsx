import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { DevelopersSection } from '../core/features/settings/ui/sections/developers-section';
export const Route = createFileRoute('/app/settings/developers/')({ component: editorLeaf(DevelopersSection) });
