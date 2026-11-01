import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { NotificationsSection } from '../core/features/settings/ui/sections/notifications-section';
export const Route = createFileRoute('/app/settings/notifications')({ component: editorLeaf(NotificationsSection) });
