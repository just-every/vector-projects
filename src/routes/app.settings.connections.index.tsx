import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { ConnectionsSection } from '../core/features/settings/ui/sections/connections-section';
export const Route = createFileRoute('/app/settings/connections/')({ component: editorLeaf(ConnectionsSection) });
