import { NotificationsPanel } from '../../../notifications/ui/notifications-panel';
import { SectionPage } from '../shell/section-page';

export function NotificationsSection() {
  return <SectionPage title="Notifications" legacy><NotificationsPanel /></SectionPage>;
}
