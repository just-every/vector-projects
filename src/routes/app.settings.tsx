import { createFileRoute } from '@tanstack/react-router';
import { SettingsLayout } from '../core/features/settings/ui/shell/settings-layout';
export const Route = createFileRoute('/app/settings')({ component: SettingsLayout });
