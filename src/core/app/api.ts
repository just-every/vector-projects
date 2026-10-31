import {addIssueTemplateRoutes} from '../features/issue-templates/routes';
import {addAliasRoutes} from '../features/data/aliases/routes';
import {addOAuthRoutes} from '../features/oauth-apps/routes';
import {addMonthCalendarRoutes} from '../features/calendar-view/routes';
import {addProjectTemplateRoutes} from '../features/project-templates/routes';
import { addDashboardRoutes } from "../features/dashboards/routes";
import { addCalendarFeedPublicRoutes, addCalendarFeedRoutes } from "../features/calendar-feeds/routes";
import { addInsightRoutes } from "../features/insights/routes";
import { addIssueReferenceRoutes } from '../features/issue-references/routes';
import {initiativeAuthority} from '../features/initiatives/authority';
import {addDocumentRoutes} from '../features/documents/routes';
import {addInitiativeRoutes} from '../features/initiatives/routes';
import {addSubscriptionRoutes} from '../features/subscriptions/routes';
import {addGithubIssueProjection} from '../features/integrations/github/issue-projection';
import {addReleaseRoutes} from '../features/releases/routes';
import {releaseAuthority} from '../features/releases/authority';
import { addGithubRuleRoutes } from '../features/integrations/github/rule-routes';
import { addAuditRoutes } from '../features/audit/routes';
import { addEmailIntakeRoutes } from '../features/email-intake/routes';
import { readAdministration } from '../features/administration/read';
import { addIssueCopyRoutes } from "../features/issue-copy/routes";
import { projectPortfolioQuery } from "../features/projects/portfolio";
import { projectPortfolio,projectDetail } from "../features/projects/read";
import { addManualOrderRoutes } from '../features/manual-order/routes';
import { addWorkloadRoutes } from '../features/workload/routes';
import { addIssueDeletionRoutes } from '../features/issue-deletion/routes';
import { addDescriptionHistoryRoutes } from '../features/description-history/routes';
import { addDuplicateRoutes } from '../features/duplicates/routes';
import { IntegrationError } from '../features/integrations/errors';
import { addIntegrationConfigRoutes } from '../features/integrations/config-routes';
import { addArchiveRoutes } from '../features/data/archive-routes';
import { addFirstRunRoutes } from '../features/first-run/routes';
import { addRestoreRoutes } from '../features/data/restore-routes';
import { addImportRoutes } from '../features/data/import/routes';
import { addErasureRoutes } from '../features/data/erasure/routes';
import { ImportError } from '../features/data/import/types';
import { requireIssueSourceAccess } from '../features/data/import/issue-source';
import { PaginationInvalidated } from "../features/issues/list-revision";
import { addNotificationRoutes } from '../features/notifications/routes';
import { addViewRoutes } from '../features/views/routes';
import { addPreferenceRoutes } from '../features/views/preferences-routes';
import { addBulkIssueRoutes } from '../features/bulk-edit/routes';
import { addBulkCommandRoutes } from '../features/bulk-commands';
import { addIssueUndoRoutes, configureUndoSession, committedUndoReceipt } from '../features/issue-undo';
import { addParentIssueRoutes } from '../features/parents/routes';
import { configureNotifications, needsNotificationDrain, notificationEventIds, directMessageEventIds } from '../features/notifications/context';
import { drainNotificationMail } from '../features/notifications/mail';
import { deliverCommittedDirectMessages } from '../features/integrations/outbound';
import { fileSettlementDatabase } from '../features/auth/mutation-database';
import { addAdministrationRoutes } from '../features/administration/routes';
import { addTeamMembershipRoutes } from '../features/team-membership/routes';
import { AuthError } from '../../../vendor/base/operator-auth/index.mjs';
import { mutationDatabase, isMutationAccessError, RestoreReservationError, AuthorityChangedError, VisibilityChangedError } from "../features/auth/mutation-database";
import { visibilityDatabase } from "../features/roles/visibility-database";
import { doorAuthority } from "../features/roles/enforcement";
import { addSettingsRoutes } from '../features/settings/routes';
import { settingsActor } from '../features/settings/repository';
import { listIssues, issueListResponse } from "../features/issues/list";
import { issueListQuerySchema } from "../features/issues/list-schema";
import { moveIssueTeamRoute } from "../features/team-move/routes";
import {
  IssueAccessError,
  requireIssueAccess,
} from "../features/issues/access";
import {
  addDependencyRoute,
  removeDependencyRoute,
} from "../features/dependencies/routes";
import { createOperatorIntakeRoute } from "../features/operator-intake/routes";
import { returnIntakeRoute } from "../features/intake-return/routes";
import { RequestBodyError } from "./input";
import { admitRate } from "../features/auth/repository";
import { updateIssueRoute } from "../features/issue-edit/routes";
import { addDiscussionRoutes } from "../features/discussion/routes";
import { myActivity } from "../features/my-work/activity";
import { addLinkRoutes } from "../features/links/routes";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { refreshResponse } from './refresh.server';
import {
  acceptIssueRoute,
  createIssueRoute,
  declineIssueRoute,
  deferIssueRoute,
  getIssueDetail,
} from "../features/issues";
import { addSearchRoutes } from "../features/search";
import { ensureSampleData } from "../features/sample-data/service";
import {
  getCurrentStream,
  getMyWorkStream,
} from "../features/streams";
import { databaseIsReachable } from "../features/workspace/repository";
import { requireOperator } from "../features/auth/service";
import { operatorProjectionStatus } from "../features/auth/projection-admission";
import type { AppEnvironment } from "./bindings";
import type { WorkspaceProjection } from '../features/streams/snapshot';

const timeQuerySchema = z.object({
  at: z.string().datetime({ offset: true }).optional(),
});
const issueParamSchema = z.object({
  identifier: z.string().max(128).regex(/^(?:[A-Z][A-Z0-9_]{0,99}-[1-9][0-9]*|[0-9]+)$/i),
});
const projectParamSchema = z.object({ projectId: z.string().length(26) });

export function createApiApp(document?: { operator: AppEnvironment['Variables']['operator']; workspace?: WorkspaceProjection }) {
  const app = new Hono<AppEnvironment>();

  app.onError((error, context) => {
    if (error instanceof RestoreReservationError) return context.json({error:'restore_in_progress',message:error.message},409);
    if(error instanceof VisibilityChangedError)return context.json({error:'not_found',message:error.message},404,{'Cache-Control':'no-store'});
    if (error instanceof AuthorityChangedError) return context.json({error:'authority_changed',message:error.message},409,{'Cache-Control':'no-store'});
    if (error instanceof IntegrationError)return context.json({error:error.code,message:error.message},error.status,{'Cache-Control':'no-store'});
    if (error instanceof ImportError)
      return context.json({error:error.code,message:error.message,...error.details},error.status,{'Cache-Control':'no-store'});
    if (error instanceof AuthError)
      return Response.json({ error: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    if (error instanceof RequestBodyError)
      return context.json(
        { error: "invalid_request", message: error.message },
        error.status,
      );
    if (isMutationAccessError(error))
      return context.json({ error: "unauthenticated", message: "Sign in again to continue." }, 401);
    console.error(error);
    return context.json(
      {
        error: "internal_error",
        message: "Unexpected server error.",
      },
      500,
    );
  });

  addCalendarFeedPublicRoutes(app);
  app.use("*", async (context, next) => {
    // Server rendering owns admission and the final native-session fence for
    // all of its read projections. This mode has no public HTTP entry point.
    if (document && context.req.method === 'GET') {
      context.set('operatorId', document.operator.id);
      context.set('operator', document.operator);
      context.set('documentProjection', true);
      const authority = await initiativeAuthority(context,document.operator.id,context.env.DB) ?? await releaseAuthority(context,document.operator.id,context.env.DB) ?? await doorAuthority(context, 'api', document.operator.id, context.env.DB);
      if (authority.denied) return authority.denied;
      context.env = { ...context.env, DB: visibilityDatabase(context.env.DB, document.operator.id) };
      await next();
      return;
    }
    if (!context.env.DB) {
      return context.json(
        {
          error: "database_unavailable",
          message: "The DB binding is required.",
        },
        503,
      );
    }
    if (context.env.SEED_SAMPLE_DATA === "true") {
      await ensureSampleData(context.env.DB, new Date());
    }
    const operator = await requireOperator(context.env, context.req.raw);
    if (!operator) {
      return context.json(
        {
          error: "unauthenticated",
          message: "A native operator session is required.",
        },
        401,
      );
    }
    if (
      !["GET", "HEAD"].includes(context.req.method) &&
      context.req.header("origin") !== context.env.APP_ORIGIN
    )
      return context.json(
        { error: "forbidden", message: "Same-origin mutation required." },
        403,
      );
    context.header("Cache-Control", "no-store");
    if (
      !(await admitRate(context.env.DB, "operator:" + operator.id, 600, 60_000))
    )
      return context.json({ error: "rate_limited" }, 429);
    const admittedWorkspace = operator.workspaceId;
    context.set("operatorId", operator.id);
    context.set("operator", operator);
    // ROLE-001: the door's role-matrix row, on the actor's current role.
    const authority = await initiativeAuthority(context,operator.id,context.env.DB) ?? await releaseAuthority(context,operator.id,context.env.DB) ?? await doorAuthority(context, 'api', operator.id, context.env.DB);
    if (authority.denied) return authority.denied;
    // Archive and imported-person erasure operate on physical schema inventory.
    // Their matrix doors admit only Owners/Admins; retain the mutation fence below.
    const archiveDoor = context.req.path.startsWith('/api/portability/') || context.req.path.startsWith('/api/data/erasure');
    context.env = { ...context.env, DB: archiveDoor ? context.env.DB : visibilityDatabase(context.env.DB, operator.id) };
    if (!["GET", "HEAD"].includes(context.req.method)) {
      // Context owns this bindings object; never change the shared Worker env.
      context.env = { ...context.env, DB: mutationDatabase(context.env.DB, operator.id, operator.fence, undefined, authority.fence) };
      configureUndoSession(context.env.DB, operator.fence.sessionId);
    }
    configureNotifications(context.env.DB,context.env);
    let pendingDrain: Promise<boolean> | undefined;
    const drain = () => pendingDrain ??= (async () => {
      const drained = await needsNotificationDrain(context.env.DB);
      if (drained) {
        try { await drainNotificationMail({...context.env,DB:fileSettlementDatabase(context.env.DB)},{eventIds:notificationEventIds(context.env.DB)}); }
        catch { console.error('Notification mail drain interrupted; durable intent retained for recovery.'); }
      }
      try { await deliverCommittedDirectMessages({...context.env,DB:fileSettlementDatabase(context.env.DB)},directMessageEventIds(context.env.DB)); }
      catch { console.error('Slack direct message delivery interrupted; durable intent retained for Cron.'); }
      return drained;
    })();
    context.set('drainNotifications', drain);
    try { await next(); } finally {
    // Only persisted intents are selected. A postcommit authorization failure
    // must hide the response without canceling recipients' committed mail.
    const preparedNotifications = notificationEventIds(context.env.DB).length > 0;
    const drained = await drain();
    // Reads always retain their captured session through the last SQL snapshot.
    // Mutation mail projection keeps its existing fence; an explicit self-removal
    // acknowledgement remains successful after its own transaction revokes access.
    const read = ["GET", "HEAD"].includes(context.req.method);
    if (preparedNotifications || read || context.get('mutationPageProjection')) {
      const current = await requireOperator(context.env, context.req.raw);
      const admission = !current || current.id !== operator.id || JSON.stringify(current.fence) !== JSON.stringify(operator.fence)
        ? 401
        : await operatorProjectionStatus(context.env.DB, operator.id, admittedWorkspace, operator.fence);
      // Resource reads conceal membership changes; ordinary account and
      // post-mail projections retain their captured-workspace session denial.
      // An attempted mutation still needs the native-session fence when its
      // transaction wrote nothing. Its concealed resource denial remains 404;
      // the post-mail workspace fence applies only after a committed event.
      const concealWorkspaceChange = context.get("concealWorkspaceChange") || (!read && !drained);
      const status = admission === 404 && !concealWorkspaceChange ? 401 : admission;
      if (status !== 200) {
        // Hono carries prior response headers into replacements. Discard file
        // metadata and cancel projected bytes before installing the denial.
        for (const name of [...context.res.headers.keys()]) context.res.headers.delete(name);
        await context.res.body?.cancel();
        context.res = context.json({ error: status === 401 ? 'unauthenticated' : 'not_found' }, status, { 'Cache-Control': 'no-store' });
      }
    }
    const undo = committedUndoReceipt(context.env.DB);
    if (undo && context.res.status >= 200 && context.res.status < 300)
      context.header('x-vector-undo', JSON.stringify(undo));
    }
  });

  addOAuthRoutes(app);
  addSubscriptionRoutes(app);
  addInitiativeRoutes(app);
  addDocumentRoutes(app);
  addReleaseRoutes(app);
  addGithubIssueProjection(app);
  addGithubRuleRoutes(app);
  addCalendarFeedRoutes(app);
  addInsightRoutes(app);
  addDashboardRoutes(app);
  addFirstRunRoutes(app);
  addIssueUndoRoutes(app);

  app.get('/refresh', context => refreshResponse(context,
    new Hono<AppEnvironment>().route('/api', createApiApp({ operator: context.get('operator') }))));

  app.get("/metadata", async (context) => context.json(await readAdministration(context.env.DB,context.get("operatorId"))));

  app.get("/session", async (context) => {
    const operatorId = context.get("operatorId");
    const { role } = await settingsActor(context.env.DB, operatorId);
    return context.json({ operatorId, role });
  });


  app.get("/current", async (context) => {
    const query = parseQuery(context, timeQuerySchema);
    if (!query.success) return query.response;
    return context.json(
      await getCurrentStream(context.env.DB, toNow(query.data.at), document?.workspace),
    );
  });

  app.get("/my-work", async (context) => {
    const query = parseQuery(context, timeQuerySchema);
    if (!query.success) return query.response;
    return context.json(
      await getMyWorkStream(
        context.env.DB,
        context.get("operatorId"),
        toNow(query.data.at),
        document?.workspace,
      ),
    );
  });

  app.get("/my-work/activity", async (context) => {
    try {
      return context.json(await myActivity(context.env.DB, context.get("operatorId")));
    } catch (error) {
      if (!(error instanceof IssueAccessError)) throw error;
      return context.json({ error: error.code, message: error.message }, error.status);
    }
  });

  app.get("/issues", async (context) => {
    const query = parseQuery(context, issueListQuerySchema);
    if (!query.success) return query.response;
    try {
      return context.json(
        issueListResponse(await listIssues(context.env.DB, context.get("operatorId"), query.data)),
      );
    } catch (error) {
      if (!(error instanceof IssueAccessError) && !(error instanceof PaginationInvalidated)) throw error;
      return context.json(
        { error: error.code, message: error.message },
        error.status,
      );
    }
  });

  addBulkIssueRoutes(app);
  addBulkCommandRoutes(app);
  addParentIssueRoutes(app);

  addManualOrderRoutes(app);

  app.get("/issues/:identifier", async (context) => {
    const parameters = issueParamSchema.safeParse(context.req.param());
    if (!parameters.success)
      return context.json(
        { error: "invalid_request", issues: parameters.error.issues },
        400,
      );
    const query = parseQuery(context, timeQuerySchema);
    if (!query.success) return query.response;
    try {
      const actor = context.get("operatorId");
      const { identifier } = await requireIssueSourceAccess(context.env.DB, actor, parameters.data.identifier);
      const issue = await getIssueDetail(
        context.env.DB,
        identifier,
        toNow(query.data.at),
        document?.workspace?.snapshot,
      );
      await requireIssueAccess(
        context.env.DB,
        identifier,
        actor,
      );
      if (!issue)
        throw new IssueAccessError("not_found", "Issue is unavailable.", 404);
      return context.json(issue);
    } catch (error) {
      if (!(error instanceof IssueAccessError)) throw error;
      return context.json(
        { error: error.code, message: error.message },
        error.status,
      );
    }
  });

  app.patch("/issues/:identifier", updateIssueRoute);
  app.post("/issues/:identifier/team", moveIssueTeamRoute);
  app.post("/issues/:identifier/dependencies", addDependencyRoute);
  app.delete("/issues/:identifier/dependencies", removeDependencyRoute);
  addDiscussionRoutes(app);
  addDescriptionHistoryRoutes(app);
  addIssueDeletionRoutes(app);
  addDuplicateRoutes(app);
  app.post("/issues", createIssueRoute);
  app.post("/intake", createOperatorIntakeRoute);
  app.post("/issues/:identifier/return", returnIntakeRoute);
  app.post("/issues/:identifier/accept", acceptIssueRoute);
  app.post("/issues/:identifier/defer", deferIssueRoute);
  app.post("/issues/:identifier/decline", declineIssueRoute);

  app.get("/projects", async (context) => {
    const query = projectPortfolioQuery.safeParse(context.req.query());
    if (!query.success) return context.json({error:"invalid_request",issues:query.error.issues},400);
    return context.json(await projectPortfolio(context.env.DB,context.get("operatorId"),query.data));
  });
  app.get("/projects/:projectId", async (context) => {
    const parameters=projectParamSchema.safeParse(context.req.param());
    const query=parseQuery(context,timeQuerySchema);
    if(!parameters.success)return context.json({error:"invalid_request"},400);
    if(!query.success)return query.response;
    const project=await projectDetail(context.env.DB,context.get("operatorId"),parameters.data.projectId,toNow(query.data.at));
    return project ? context.json(project) : context.json({error:"not_found"},404);
  });

  addSearchRoutes(app);
  addEmailIntakeRoutes(app);
  addIssueReferenceRoutes(app);

  addNotificationRoutes(app);
  addViewRoutes(app);
  addPreferenceRoutes(app);
  addAdministrationRoutes(app);
  addTeamMembershipRoutes(app);
  addIssueCopyRoutes(app);
  addWorkloadRoutes(app);
  addMonthCalendarRoutes(app);
  addIssueTemplateRoutes(app);
  addProjectTemplateRoutes(app);
  addSettingsRoutes(app);
  addAuditRoutes(app);
  addIntegrationConfigRoutes(app);
  addRestoreRoutes(app);
  addArchiveRoutes(app);
  addImportRoutes(app);
  addAliasRoutes(app);
  addErasureRoutes(app);
  addLinkRoutes(app);
  return app;
}

export async function healthResponse(
  binding: D1Database | undefined,
  shouldSeed: boolean,
): Promise<{ status: "ok" } | null> {
  if (!binding) return null;
  try {
    if (shouldSeed) await ensureSampleData(binding, new Date());
    await databaseIsReachable(binding);
    return { status: "ok" };
  } catch {
    return null;
  }
}

function parseQuery<T extends z.ZodType>(
  context: Context<AppEnvironment>,
  schema: T,
):
  { success: true; data: z.infer<T> } | { success: false; response: Response } {
  const parsed = schema.safeParse(context.req.query());
  return parsed.success
    ? { success: true, data: parsed.data }
    : {
        success: false,
        response: context.json(
          { error: "invalid_request", issues: parsed.error.issues },
          400,
        ),
      };
}

function toNow(value: string | undefined): Date {
  return value ? new Date(value) : new Date();
}
