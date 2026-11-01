import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { ProfileSection } from '../core/features/settings/ui/sections/profile-section';
export const Route = createFileRoute('/app/settings/profile')({ component: editorLeaf(ProfileSection) });
