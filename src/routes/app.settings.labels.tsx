import { createFileRoute } from '@tanstack/react-router';
import { editorLeaf } from '../core/editor/leaf';
import { LabelsSection } from '../core/features/settings/ui/sections/labels-section';
export const Route = createFileRoute('/app/settings/labels')({ component: editorLeaf(LabelsSection) });
