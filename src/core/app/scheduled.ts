import {processSubscriptionQueue} from '../features/subscriptions/process';
import { runReportExports } from '../features/report-exports/scheduled';
import { captureDailyReports } from "../features/project-report/capture";
import { maintainCycleSchedules } from "../features/cycle-schedule/service";
import { deliverFollowups } from '../features/notification-followups/service';
import { sendDueReminders } from "../features/due-reminders/service";
import { closeEndedCycles } from "../features/cycle-closure/service";
import { configureNotifications } from "../features/notifications/context";
import { drainNotificationDigests } from "../features/notifications/digests";
import { drainNotificationMail } from "../features/notifications/mail";
import { dispatchWebhooks } from "../features/integrations/outbound";
import { returnDueIntake } from "../features/intake-return/service";
import { processFileRemovals } from "../features/file-removal/service";
import { runHousekeeping } from "../features/housekeeping/service";
import { settleInterruptedEmailIntake } from '../features/email-intake/recovery';
import type { WorkerBindings } from "./server";
/** Export shared by the emitted Worker and the scheduled public-door tests. */
export async function scheduled(
  event: Pick<ScheduledController, "scheduledTime">,
  env: WorkerBindings,
) {
  const now = new Date(event.scheduledTime);
  configureNotifications(env.DB,env);
  await captureDailyReports(env, now);
  await maintainCycleSchedules(env, now);
  await Promise.all([
    closeEndedCycles(env, now),
    sendDueReminders(env, now),
    deliverFollowups(env, now),
    processFileRemovals(env),
    returnDueIntake(env, now),
    runHousekeeping(env, now),
    settleInterruptedEmailIntake(env, now),
  ]);
  await processSubscriptionQueue(env);
  // Route notifications after scheduled Inbox producers finish, including SQL automation.
  await drainNotificationMail(env, { scheduled: true, now });
  await drainNotificationDigests(env, { now });
  await dispatchWebhooks(env);
  await runReportExports(env, now);
}
