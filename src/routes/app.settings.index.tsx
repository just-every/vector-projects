import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { SettingsIndex } from '../core/features/settings/ui/sections/settings-index';
export const Route = createFileRoute('/app/settings/')({ component: editorLeaf(SettingsIndex) });
