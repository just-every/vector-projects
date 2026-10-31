import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useMatches } from "@tanstack/react-router";
import { fetchJson, useApiResource } from "../../../app/api-client";
import { favoritesSchema, type Favorites, type FavoriteWrite } from "../schema";

type FavoriteContext = {
  data: Favorites | null;
  busy: boolean;
  error: string;
  errorRole: "alert" | "status";
  save: (next: Omit<FavoriteWrite, "expectedVersion">) => Promise<void>;
};
const context = createContext<FavoriteContext | null>(null);
export const favoriteInput = (
  data: Favorites,
): Omit<FavoriteWrite, "expectedVersion"> => ({
  folders: data.folders,
  entries: data.entries.map(({ kind, subjectId, folderId }) => ({
    kind,
    subjectId,
    folderId,
  })),
});
export function FavoriteProvider({ children }: { children: ReactNode }) {
  const path = useLocation({ select: (location) => location.pathname });
  const route = useMatches({ select: (matches) => matches.at(-1)?.routeId });
  // Resolve the optional current pin in the collection's visibility snapshot.
  // Static list/creation routes never select a subject. Both shell copies use
  // this one response, including an explicit null after access withdrawal.
  const match = [
    "/app/issues/$identifier",
    "/app/projects/$projectId",
    "/app/views/$viewId",
  ].includes(route ?? "")
    ? path.match(/^\/app\/(issues|projects|views)\/([^/]+)\/?$/)
    : null;
  const url = match
    ? "/api/favorites?" +
      new URLSearchParams({
        currentKind:
          match[1] === "issues"
            ? "issue"
            : match[1] === "projects"
              ? "project"
              : "view",
        currentKey: decodeURIComponent(match[2]!),
      })
    : "/api/favorites";
  // A route transition retires its receipt while the admitted transport drains.
  const resource = useApiResource(url, favoritesSchema, 30000, {
    abortPendingOnDispose: false,
  });
  const activeUrl = useRef(url);
  activeUrl.current = url;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    resource.reload();
  }, [path, resource.reload]);
  async function save(next: Omit<FavoriteWrite, "expectedVersion">) {
    if (!resource.data || busy) return;
    setBusy(true);
    setError("");
    try {
      const receipt = await fetchJson(url, favoritesSchema, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...next,
          expectedVersion: resource.data.version,
        }),
      });
      if (activeUrl.current === url) resource.publishReceipt(() => receipt);
      else resource.reload();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save favorites.",
      );
      resource.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <context.Provider
      value={{
        data: resource.error ? null : resource.data,
        busy,
        error: resource.error?.message || error,
        // A background navigation read reports its own availability politely.
        // A failed member action still needs an immediate alert.
        errorRole: resource.error ? "status" : "alert",
        save,
      }}
    >
      {children}
    </context.Provider>
  );
}
export function useFavorites() {
  const value = useContext(context);
  if (!value) throw new Error("Favorites require their member scope.");
  return value;
}
