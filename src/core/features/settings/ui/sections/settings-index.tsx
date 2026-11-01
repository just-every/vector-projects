import { useLocation, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { restoreIndexScroll } from '../shell/index-scroll';
import { hashTarget } from '../shell/old-links';
import { ProfileSection } from './profile-section';

/**
 * `/app/settings`: the index at every width. A wide screen shows the rail with Profile in the pane; a phone shows
 * the list. An old `#section` link (the fragment never reaches the server) is mapped here, replacing its history entry.
 */
export function SettingsIndex() {
  const router = useRouter();
  const hash = useLocation({ select: location => location.hash });
  useEffect(() => {
    const fragment = hash || window.location.hash.replace(/^#/, '');
    if (fragment) void router.navigate({ href: hashTarget(fragment), replace: true });
  }, [hash, router]);
  useEffect(restoreIndexScroll, []);
  return <ProfileSection />;
}
