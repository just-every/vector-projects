import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "@tanstack/react-router";
import { fetchJson, useApiResource } from "../../../app/api-client";
import { favoritesSchema, type Favorites, type FavoriteWrite } from "../schema";

type FavoriteContext = {
  data: Favorites | null;
  busy: boolean;
  error: string;
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
  const resource = useApiResource("/api/favorites", favoritesSchema, 30000);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const path = useLocation({ select: (location) => location.pathname });
  useEffect(() => {
    resource.reload();
  }, [path, resource.reload]);
  async function save(next: Omit<FavoriteWrite, "expectedVersion">) {
    if (!resource.data || busy) return;
    setBusy(true);
    setError("");
    try {
      const receipt = await fetchJson("/api/favorites", favoritesSchema, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...next,
          expectedVersion: resource.data.version,
        }),
      });
      resource.publishReceipt(() => receipt);
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
        error: error || resource.error?.message || "",
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
