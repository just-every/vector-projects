import type { ReactNode } from 'react';
import { useApiResource } from '../../../../app/api-client';
import { administrationSchema, type Administration } from '../../../administration/schema';
import { Skeleton } from '../shell/section-page';

/** Reads the administration snapshot once for a section and hands it, with its reload, to the page. */
export function WithAdministration({ children }: { children: (data: Administration, reload: () => void) => ReactNode }) {
  const administration = useApiResource('/api/settings/administration', administrationSchema);
  if (administration.data) return <>{children(administration.data, administration.reload)}</>;
  if (administration.error) return <p role="alert">{administration.error.message} <button type="button" className="field-retry" onClick={administration.reload}>Retry</button></p>;
  return <Skeleton />;
}
