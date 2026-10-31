import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/bindings";
import { readRequestJson } from "../../app/input";
import { favoriteKindSchema, favoriteWriteSchema } from "./schema";
import {
  FavoriteError,
  favoriteSubject,
  readFavorites,
  writeFavorites,
} from "./repository";

function currentSelection(c: import("hono").Context<AppEnvironment>) {
  const kind = c.req.query("currentKind"),
    key = c.req.query("currentKey");
  if (kind === undefined && key === undefined) return undefined;
  return z
    .object({ kind: favoriteKindSchema, key: z.string().min(1).max(128) })
    .parse({ kind, key });
}

export function addFavoriteRoutes(app: Hono<AppEnvironment>) {
  const handle =
    (run: (c: import("hono").Context<AppEnvironment>) => Promise<Response>) =>
    async (c: import("hono").Context<AppEnvironment>) => {
      try {
        return await run(c);
      } catch (error) {
        if (error instanceof FavoriteError)
          return c.json(
            { error: error.code, message: error.message },
            error.status,
          );
        if (error instanceof z.ZodError)
          return c.json(
            {
              error: "invalid_request",
              message: "Check the favorites and try again.",
            },
            400,
          );
        throw error;
      }
    };
  app.get(
    "/favorites",
    handle(async (c) =>
      c.json(
        await readFavorites(c.env.DB, c.get("operatorId"), currentSelection(c)),
      ),
    ),
  );
  app.get(
    "/favorites/subjects/:kind/:key",
    handle(async (c) =>
      c.json(
        await favoriteSubject(
          c.env.DB,
          c.get("operatorId"),
          favoriteKindSchema.parse(c.req.param("kind")),
          z.string().min(1).max(128).parse(c.req.param("key")),
        ),
      ),
    ),
  );
  app.put(
    "/favorites",
    handle(async (c) =>
      c.json(
        await writeFavorites(
          c.env.DB,
          c.get("operatorId"),
          favoriteWriteSchema.parse(await readRequestJson(c.req.raw)),
          currentSelection(c),
        ),
      ),
    ),
  );
}
