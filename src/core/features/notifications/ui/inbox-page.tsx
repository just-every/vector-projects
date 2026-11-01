import { useHydrated } from '../../../app/initial-resources';
import { useMatch, useNavigate } from "@tanstack/react-router";
import { InboxNotificationRow } from "./inbox-row";
import { useInbox } from "./use-inbox";
import "./notifications.css";
import "./follow-ups.css";

export { InboxNotificationRow } from "./inbox-row";

export function InboxEmptyState({ snoozed = false }: { snoozed?: boolean }) {
  return (
    <div className="inbox-empty">
      <p>{snoozed ? "No snoozed notifications." : "Nothing new."}</p>
      <p>
        {snoozed
          ? "Snooze a notification from Inbox to return to it later."
          : "You're all caught up. Assignments and mentions will appear here."}
      </p>
    </div>
  );
}

export function InboxPageView() {
  const snoozed = Boolean(useMatch({ from: '/app/inbox/snoozed', shouldThrow: false }));
  const navigate = useNavigate();
  const setSnoozed = (value: boolean) => { void navigate({ to: value ? '/app/inbox/snoozed' : '/app/inbox' }); };
  return (
    <main className="inbox-page">
      <InboxFeed
        key={snoozed ? "snoozed" : "inbox"}
        snoozed={snoozed}
        onModeChange={setSnoozed}
      />
    </main>
  );
}

function InboxFeed({
  snoozed,
  onModeChange,
}: {
  snoozed: boolean;
  onModeChange: (snoozed: boolean) => void;
}) {
  const hydrated = useHydrated();
  const inbox = useInbox(snoozed);
  const { state, count, items, pending } = inbox;
  return (
    <>
      <header>
        <div>
          <p className="settings-eyebrow">My work</p>
          <h1>Inbox</h1>
          <p>
            {count.error
              ? "Unread count unavailable"
              : count.data
                ? `${count.data.unreadCount} unread`
                : "Loading unread count…"}
          </p>
        </div>
        {!snoozed && (count.data?.unreadCount ?? 0) > 0 && (
          <button
            type="button"
            disabled={
              !hydrated || !!pending ||
              !state.data ||
              items.length === 0 ||
              count.data?.unreadCount === 0
            }
            onClick={() => void inbox.read()}
          >
            {pending === "all" ? "Marking read…" : "Mark all read"}
          </button>
        )}
      </header>
      <nav className="inbox-tabs" aria-label="Inbox views">
        <button
          type="button"
          aria-current={!snoozed ? "page" : undefined}
          disabled={!!pending || !hydrated}
          onClick={() => onModeChange(false)}
        >
          Inbox
        </button>
        <button
          type="button"
          aria-current={snoozed ? "page" : undefined}
          disabled={!!pending || !hydrated}
          onClick={() => onModeChange(true)}
        >
          Snoozed
        </button>
      </nav>
      {snoozed && (
        <p className="inbox-mode-help">
          These notifications return at the chosen time or when their issue
          changes.
        </p>
      )}
      {state.loading && !state.data && (
        <p role="status">
          {snoozed ? "Loading snoozed notifications…" : "Loading inbox…"}
        </p>
      )}
      {(state.error || inbox.error || count.error) && (
        <p role="alert">
          {inbox.error || state.error?.message || count.error?.message}{" "}
          {state.data &&
            `Showing the last loaded ${snoozed ? "snoozed notifications" : "inbox"}.`}{" "}
          <button type="button" disabled={!!pending || !hydrated} onClick={inbox.retry}>
            Retry {snoozed ? "snoozed notifications" : "inbox"}
          </button>
        </p>
      )}
      {state.data && items.length === 0 && (
        <InboxEmptyState snoozed={snoozed} />
      )}
      <ul
        className="inbox-list"
        aria-label={snoozed ? "Snoozed notifications" : "Inbox notifications"}
      >
        {items.map((item) => (
          <li key={item.id}>
            <InboxNotificationRow
              item={item}
              pending={pending}
              pendingLabel={inbox.pendingLabel}
              onOpen={() => void inbox.read(item.id, item.identifier, item.documentId)}
              snoozed={snoozed}
              onSnooze={item.documentId ? undefined : (choice) => inbox.snooze(item.id, choice)}
              onReturn={() => void inbox.unsnooze(item.id)}
            />
          </li>
        ))}
      </ul>
      {state.data && inbox.cursor && (
        <button
          type="button"
          disabled={!!pending || !hydrated}
          onClick={() => void inbox.more()}
        >
          {pending === "more" ? "Loading…" : "Load more notifications"}
        </button>
      )}
    </>
  );
}
