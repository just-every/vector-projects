import {createFileRoute} from '@tanstack/react-router';
import {editorLeaf} from '../core/editor/leaf';
import {TriagePage} from '../core/features/triage-responsibility/ui';
export const Route=createFileRoute('/app/triage')({component:editorLeaf(TriagePage)});
