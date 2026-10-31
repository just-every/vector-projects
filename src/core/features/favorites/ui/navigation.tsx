import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { FavoriteSubject } from "../schema";
import { favoriteInput, useFavorites } from "./context";
import "./favorites.css";

export function FavoriteNavigation() {
  const { data, error, errorRole, busy, save } = useFavorites();
  const [organizing, setOrganizing] = useState(false),
    [name, setName] = useState("");
  const entries = data?.entries ?? [];
  const folders = data?.folders ?? [];
  function move(index: number, direction: number) {
    if (!data) return;
    const next = favoriteInput(data),
      other = index + direction;
    if (other < 0 || other >= next.entries.length) return;
    [next.entries[index], next.entries[other]] = [
      next.entries[other]!,
      next.entries[index]!,
    ];
    void save(next);
  }
  function group(folderId: string | null) {
    return (
      <ul className="favorite-list">
        {entries.map(
          (entry, index) =>
            entry.folderId === folderId && (
              <li
                key={entry.kind + entry.subjectId}
                data-favorite-id={entry.subjectId}
                data-favorite-kind={entry.kind}
              >
                <Link to={entry.href} title={entry.title}>
                  {entry.title}
                </Link>
                {organizing && (
                  <div className="favorite-controls">
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      aria-label={`Move ${entry.title} up`}
                      onClick={() => move(index, -1)}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      disabled={busy || index === entries.length - 1}
                      aria-label={`Move ${entry.title} down`}
                      onClick={() => move(index, 1)}
                    >
                      Down
                    </button>
                    <select
                      disabled={busy}
                      aria-label={`Folder for ${entry.title}`}
                      value={entry.folderId ?? ""}
                      onChange={(event) => {
                        if (!data) return;
                        const next = favoriteInput(data);
                        next.entries[index]!.folderId =
                          event.target.value || null;
                        void save(next);
                      }}
                    >
                      <option value="">No folder</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Unpin ${entry.title}`}
                      onClick={() =>
                        data &&
                        void save({
                          ...favoriteInput(data),
                          entries: favoriteInput(data).entries.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      Unpin
                    </button>
                  </div>
                )}
              </li>
            ),
        )}
      </ul>
    );
  }
  return (
    <nav
      className="favorite-navigation"
      aria-label="Favorites"
      data-favorites-state={data ? "ready" : "loading"}
    >
      <div className="favorite-heading">
        <h2>Favorites</h2>
        <button
          type="button"
          aria-expanded={organizing}
          disabled={!data || busy}
          onClick={() => setOrganizing(!organizing)}
        >
          {organizing ? "Done" : "Organize"}
        </button>
      </div>
      {data?.current && <CurrentFavorite value={data.current} />}
      {error && <p role={errorRole}>{error}</p>}
      {data && entries.length === 0 && (
        <p className="favorite-empty">
          Pin an issue, project or saved view from its page.
        </p>
      )}
      {group(null)}
      {folders.map((folder) => (
        <section
          className="favorite-folder"
          key={folder.id}
          aria-label={folder.name}
        >
          <h3>{folder.name}</h3>
          {group(folder.id)}
          {organizing && (
            <button
              type="button"
              disabled={busy}
              aria-label={`Remove folder ${folder.name}`}
              onClick={() =>
                data &&
                void save({
                  folders: folders.filter((item) => item.id !== folder.id),
                  entries: favoriteInput(data).entries.map((entry) =>
                    entry.folderId === folder.id
                      ? { ...entry, folderId: null }
                      : entry,
                  ),
                })
              }
            >
              Remove folder
            </button>
          )}
        </section>
      ))}
      {organizing && (
        <form
          className="favorite-folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!data || !name.trim()) return;
            void save({
              ...favoriteInput(data),
              folders: [
                ...folders,
                { id: crypto.randomUUID(), name: name.trim() },
              ],
            });
            setName("");
          }}
        >
          <label>
            Folder name
            <input
              maxLength={80}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button disabled={busy || !name.trim() || folders.length >= 30}>
            Create folder
          </button>
        </form>
      )}
    </nav>
  );
}
function CurrentFavorite({ value }: { value: FavoriteSubject }) {
  const { data, busy, save } = useFavorites();
  const pinned = data?.entries.some(
    (entry) => entry.kind === value.kind && entry.subjectId === value.subjectId,
  );
  return (
    <button
      className="favorite-pin"
      type="button"
      disabled={!data || busy}
      aria-pressed={Boolean(pinned)}
      onClick={() => {
        if (!data) return;
        const next = favoriteInput(data);
        next.entries = pinned
          ? next.entries.filter(
              (entry) =>
                entry.kind !== value.kind ||
                entry.subjectId !== value.subjectId,
            )
          : [
              ...next.entries,
              { kind: value.kind, subjectId: value.subjectId, folderId: null },
            ];
        void save(next);
      }}
    >
      {pinned ? "Unpin" : "Pin"} this {value.kind}
    </button>
  );
}
