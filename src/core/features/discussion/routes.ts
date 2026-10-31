import { readCommentDraft, consumeCommentDraftStatements } from '../drafts/comment-repository';
import { descriptionAnchorSchema } from "./anchors";
import { DescriptionAnchorError } from "./anchor-error";
import { addReactionRoutes } from "../reactions/routes";
import { fileSettlementDatabase, MutationAccessError } from "../auth/mutation-database";
import { IssueAccessError, requireIssueAccess } from "../issues/access";
import { requireIssueProjection } from "../issues/projection-access";
import { discussionAccess } from "./access";
import { CommentPermissionError } from "./permissions";
import { requireOperator } from "../auth/service";
import { changeResolution, ThreadError } from "./threads";
import { requestFileRemoval } from "../file-removal/service";
import { readRequestJson } from "../../app/input";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { createUlid } from "../../shared/ids";
import type { AppEnvironment } from "../../app/bindings";
import {
  addComment,
  addFile,
  failFile,
  finalizeFile,
  changeComment,
  discussion,
  findFile,
  findIssue,
} from "./repository";
const commentSchema = z
  .object({ body: z.string().trim().min(1).max(100000) })
  .strict();
const itemIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const newCommentSchema = commentSchema.extend({ parentId: itemIdSchema.optional(), anchor: descriptionAnchorSchema.optional() }).strict();
const resolutionSchema = z.object({ resolved: z.boolean() }).strict();
/** Denials keep their public status; storage and programming errors propagate.
 * A permission answer is given only to the session that is still current. */
async function discussionDenial(c: Context<AppEnvironment>, error: unknown) {
  if (!(error instanceof IssueAccessError || error instanceof CommentPermissionError || error instanceof ThreadError || error instanceof DescriptionAnchorError)) throw error;
  // Visibility can hide the issue after operator removal. Preserve the common
  // mutation denial before answering whether the requested resource exists.
  if (error instanceof IssueAccessError && error.code === "unauthenticated")
    throw new MutationAccessError();
  if (error instanceof CommentPermissionError) {
    const admitted = c.get("operator"), current = await requireOperator(c.env, c.req.raw);
    if (!current || current.id !== admitted.id || JSON.stringify(current.fence) !== JSON.stringify(admitted.fence))
      return c.json({ error: "unauthenticated" }, 401);
  }
  return c.json({ error: error.code, message: error.message }, error.status);
}
const mimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/zip",
]);
export function addDiscussionRoutes(app: Hono<AppEnvironment>) {
  addReactionRoutes(app);
  app.use("/issues/:identifier/*", async (c, next) => {
    if (!/^[A-Z]{2,10}-[1-9][0-9]*$/.test(c.req.param("identifier") ?? ""))
      return c.json({ error: "invalid_request" }, 400);
    const itemId = c.req.param("itemId");
    if (itemId && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(itemId))
      return c.json({ error: "invalid_request" }, 400);
    await next();
  });
  for (const path of [
    "/issues/:identifier/comments/:itemId",
    "/issues/:identifier/comments/:itemId/resolution",
    "/issues/:identifier/files/:itemId",
  ])
    app.use(path, async (c, next) => {
      if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(c.req.param("itemId") ?? ""))
        return c.json({ error: "invalid_request" }, 400);
      await next();
    });
  app.get("/issues/:identifier/discussion", discussionAccess(async (c) => {
    c.set("concealWorkspaceChange", true);
    const issue = await requireIssueProjection(c, c.req.param().identifier);
    const projection = await discussion(c.env.DB, issue.id, c.get("operatorId"));
    await requireIssueProjection(c, issue.identifier);
    return c.json(projection);
  }));
  app.post("/issues/:identifier/comments", async (c) => {
    const input = newCommentSchema.safeParse(await readRequestJson(c.req.raw));
    if (!input.success)
      return c.json(
        { error: "invalid_request", issues: input.error.issues },
        400,
      );
    try {
      const issue = await requireIssueAccess(c.env.DB, c.req.param("identifier"), c.get("operatorId"));
      const draftId = c.req.header('x-vector-comment-draft-id');
      const revision = Number(c.req.header('x-vector-comment-draft-revision'));
      const reference = draftId ? { id:draftId,revision } : undefined;
      let savedBody = input.data.body, savedAnchor: string | null = null;
      const posted = input.data.anchor ? JSON.stringify(input.data.anchor) : null;
      const matchesDraft = async () => {
        if (!reference) return true;
        const draft = await readCommentDraft(c.env.DB,c.get('operatorId'),reference.id);
        if (draft) { savedBody = draft.body; savedAnchor = draft.anchor ? JSON.stringify(draft.anchor) : null; }
        return Number.isSafeInteger(revision) && draft?.revision === revision && draft.identifier === issue.identifier &&
          draft.parentId === (input.data.parentId ?? null) && draft.body.trim() === input.data.body && savedAnchor === posted;
      };
      const changed = () => c.json({ error:'draft_changed',message:'This comment draft changed or was removed. Review it before posting.' },409);
      if (!await matchesDraft()) return changed();
      let id: string;
      try { id = await addComment(
        c.env.DB,
        issue.id,
        c.get("operatorId"),
        input.data.body,
        input.data.parentId,
        reference ? db => consumeCommentDraftStatements(db,c.get('operatorId'),issue.id,input.data.parentId,savedBody,savedAnchor,reference) : undefined,
        input.data.anchor,
      ); } catch (error) {
        if (reference && !await matchesDraft()) return changed();
        throw error;
      }
      if (c.req.header('x-vector-projection') === 'discussion') {
        // Return the committed state through the same final native admission
        // used by document projections, rather than a second browser request.
        c.set('mutationPageProjection', true);
        const projection = await discussion(c.env.DB, issue.id, c.get("operatorId"));
        await requireIssueProjection(c, issue.identifier);
        return c.json({ id, discussion: projection }, 201);
      }
      return c.json({ id }, 201);
    } catch (error) {
      return discussionDenial(c, error);
    }
  });
  app.post("/issues/:identifier/comments/:itemId/resolution", async (c) => {
    const input = resolutionSchema.safeParse(await readRequestJson(c.req.raw));
    if (!input.success) return c.json({ error: "invalid_request" }, 400);
    const issue = await findIssue(c.env.DB, c.req.param("identifier"));
    if (!issue) return c.json({ error: "not_found" }, 404);
    try {
      await changeResolution(c.env.DB, issue, c.req.param("itemId"), c.get("operatorId"), input.data.resolved);
      return c.json({ resolved: input.data.resolved });
    } catch (error) {
      return discussionDenial(c, error);
    }
  });
  for (const method of ["PATCH", "DELETE"] as const)
    app.on(method, "/issues/:identifier/comments/:itemId", async (c) => {
      const input =
        method === "DELETE"
          ? { success: true as const, data: { body: null } }
          : commentSchema.safeParse(await readRequestJson(c.req.raw));
      if (!input.success) return c.json({ error: "invalid_request" }, 400);
      try {
        const issue = await requireIssueAccess(c.env.DB, c.req.param("identifier"), c.get("operatorId"));
        return (await changeComment(
          c.env.DB,
          issue,
          c.req.param("itemId"),
          c.get("operatorId"),
          input.data.body,
        ))
          ? c.json({ updated: true })
          : c.json({ error: "not_found" }, 404);
      } catch (error) {
        return discussionDenial(c, error);
      }
    });
  app.post("/issues/:identifier/files", discussionAccess(async (c) => {
    const type = c.req.header("content-type") ?? "";
    let name = c.req.header("x-file-name") ?? "";
    const encoding = c.req.header("x-file-name-encoding");
    if (encoding && encoding !== "uri")
      return c.json(
        { error: "invalid_upload", message: "Unknown filename encoding." },
        400,
      );
    if (encoding === "uri") {
      try {
        name = decodeURIComponent(name);
      } catch {
        return c.json(
          { error: "invalid_upload", message: "Invalid filename encoding." },
          400,
        );
      }
    }
    if (
      !mimeTypes.has(type) ||
      !name ||
      name.length > 255 ||
      /[\x00-\x1f\x7f]/.test(name)
    )
      return c.json(
        {
          error: "invalid_upload",
          message: "A supported content type and file name are required.",
        },
        400,
      );
    const issue = await requireIssueProjection(c, c.req.param().identifier);
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.json({ error: "invalid_upload" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 26214400) {
        await reader.cancel();
        return c.json({ error: "upload_too_large" }, 413);
      }
      chunks.push(value);
    }
    if (size === 0) return c.json({ error: "invalid_upload" }, 400);
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    const id = createUlid(new Date()),
      key = `issues/${issue.id}/${id}`;
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    )
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (
      !(await addFile(c.env.DB, issue, c.get("operatorId"), {
        id,
        name,
        contentType: type,
        bytes: size,
        key,
        sha256,
      }))
    )
      return c.json({ error: "storage_limit" }, 413);
    // addFile committed the authorized reservation. Settle that exact receipt
    // even after sign-out; successful operator removal waits for this writer.
    const settlement = { ...c.env, DB: fileSettlementDatabase(c.env.DB) };
    let putCompleted = false;
    try {
      await c.env.FILES.put(key, data, {
        httpMetadata: { contentType: type },
        customMetadata: { operationId: id, sha256 },
      });
      putCompleted = true;
      const ready = await finalizeFile(
        settlement.DB,
        issue.id,
        id,
        c.get("operatorId"),
      );
      if (!ready) {
        const cleanup = await requestFileRemoval(
          settlement,
          issue,
          id,
          c.get("operatorId"),
        );
        return c.json(
          {
            error: "upload_cancelled",
            message:
              cleanup === "removed"
                ? "Upload was cancelled and removed."
                : "Removal is pending. Retry removal shortly.",
          },
          cleanup === "removed" ? 409 : 503,
        );
      }
    } catch {
      await failFile(settlement.DB, id, putCompleted);
      const file = await findFile(settlement.DB, issue.id, id);
      if (file?.removal_requested_at)
        await requestFileRemoval(settlement, issue, id, c.get("operatorId"));
      return c.json(
        {
          error: "file_upload_failed",
          message:
            "Upload did not complete. Remove the incomplete file and upload again.",
        },
        503,
      );
    }
    return c.json({ id, name, contentType: type, bytes: size }, 201);
  }));
  app.get("/issues/:identifier/files/:itemId", discussionAccess(async (c) => {
    c.set("concealWorkspaceChange", true);
    const issue = await requireIssueProjection(c, c.req.param().identifier);
    const file = await findFile(c.env.DB, issue.id, c.req.param().itemId);
    if (!file) return c.json({ error: "not_found" }, 404);
    if (file.deleted_at || file.removal_requested_at)
      return c.json({ error: "not_found" }, 404);
    if (file.state !== "ready")
      return c.json(
        {
          error: "file_unavailable",
          message: "This upload has not completed. Remove it and upload again.",
        },
        503,
      );
    const blob = await c.env.FILES.get(file.blob_key);
    try {
      await requireIssueProjection(c, issue.identifier);
    } catch (error) {
      await blob?.body.cancel();
      throw error;
    }
    if (!blob) return c.json({ error: "file_unavailable" }, 503);
    return new Response(blob.body, {
      headers: {
        "Content-Type": file.content_type,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }));
  app.delete("/issues/:identifier/files/:itemId", discussionAccess(async (c) => {
    const issue = await requireIssueProjection(c, c.req.param().identifier);
    const file = await findFile(c.env.DB, issue.id, c.req.param().itemId);
    if (!file) return c.json({ error: "not_found" }, 404);
    const result = await requestFileRemoval(
      c.env,
      issue,
      file.id,
      c.get("operatorId"),
      issue,
    );
    return result === "removed"
      ? c.json({ removed: true })
      : result === "pending"
        ? c.json(
            {
              removed: false,
              pending: true,
              message: "Removal is pending while the upload settles.",
            },
            202,
          )
        : c.json(
            {
              error: "file_removal_failed",
              message: "Removal could not finish. Retry removal.",
            },
            503,
          );
  }));
}
