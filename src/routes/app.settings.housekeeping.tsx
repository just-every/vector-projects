import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { HousekeepingRedirect } from '../core/features/settings/ui/sections/housekeeping-redirect';
export const Route = createFileRoute('/app/settings/housekeeping')({ component: editorLeaf(HousekeepingRedirect) });
