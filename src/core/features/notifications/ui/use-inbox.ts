import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useInitialResource } from "../../../app/initial-resources";
import {
  createApiResourceController,
  fetchJson,
  isUnavailableResourceError,
  type ResourceState,
} from "../../../app/api-client";
import type { InboxPage } from "../schema";
import { inboxPageFailure, visibleInboxItems } from "./inbox-state";
import {
  countSchema,
  inboxSchema,
  inboxUrl,
  fetchCurrentInboxPage,
  fetchInboxPages,
} from "./data";
import { useNotifications } from "./notification-context";
import { onSecondaryRefresh } from '../../../app/secondary-refresh';
import type { SnoozeChoice } from "./inbox-snooze";

export function useInbox(snoozed: boolean) {
  const initial = useInitialResource(inboxUrl(undefined, snoozed), inboxSchema);
  const initialPending = useRef(initial);
  const navigate = useNavigate();
  const notifications = useNotifications();
  const [state, setState] = useState<ResourceState<InboxPage>>({
    data: initial,
    error: null,
    loading: initial === null,
  });
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<ReturnType<
    typeof createApiResourceController<InboxPage>
  > | null>(null);
  const pageAbort = useRef<AbortController | null>(null);
  const active = useRef(true);
  const mutation = useRef(false);
  const generation = useRef(0);
  const pageCount = useRef(1);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    active.current = true;
    const current = createApiResourceController(
      (signal, { background }) => fetchInboxPages(pageCount.current, snoozed, signal, background),
      (next) => {
        if (!active.current) return;
        if (next.data) {
          setCursor(next.data.nextCursor);
        } else if (next.error) {
          if (isUnavailableResourceError(next.error)) {
            ++generation.current;
            controller.current?.dispose();
            pageAbort.current?.abort();
            setPending(null);
            notifications.deny(next.error);
          }
          setCursor(null);
          pageCount.current = 1;
        }
        setState(next);
      },
    );
    controller.current = current;
    const receipt = initialPending.current;
    initialPending.current = null;
    if (receipt !== null) current.publishReceipt(() => receipt);
    else void current.refresh();
    const refresh = () => {
      if (!mutation.current && document.visibilityState === "visible")
        void current.refresh({ skipIfPending: true, background: true });
    };
    const stop = onSecondaryRefresh(refresh);
    return () => {
      active.current = false;
      ++generation.current;
      current.dispose();
      stop();
      pageAbort.current?.abort();
    };
  }, [revision, snoozed]);
  const items = visibleInboxItems(state, []);
  async function mutate(command: {
    key: string;
    url: string;
    label: string;
    failure: string;
    body?: SnoozeChoice;
    identifier?: string;
    documentId?: string | null;
  }) {
    if (mutation.current) return false;
    mutation.current = true;
    ++generation.current;
    controller.current?.dispose();
    pageAbort.current?.abort();
    notifications.invalidate();
    setPending(command.key);
    setPendingLabel(command.label);
    setError("");
    try {
      const receipt = await fetchJson(command.url, countSchema, {
        method: "POST",
        ...(command.body
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(command.body),
            }
          : {}),
      });
      if (!active.current) return false;
      notifications.accept(receipt.unreadCount);
      pageCount.current = 1;
      setCursor(null);
      setState({ data: null, error: null, loading: true });
      setRevision((value) => value + 1);
      if (command.documentId) await navigate({to:"/app/documents/$documentId",params:{documentId:command.documentId}});
      else if (command.identifier)
        await navigate({
          to: "/app/issues/$identifier",
          params: { identifier: command.identifier },
        });
      return true;
    } catch (cause) {
      if (active.current) {
        const error =
          cause instanceof Error ? cause : new Error(command.failure);
        setError(error.message);
        if (isUnavailableResourceError(error)) {
          setState((current) => inboxPageFailure(current, error).state);
          setCursor(null);
          pageCount.current = 1;
          notifications.deny(error);
        } else {
          setRevision((value) => value + 1);
          notifications.refresh();
        }
      }
      return false;
    } finally {
      mutation.current = false;
      if (active.current) setPending(null);
    }
  }
  async function more() {
    if (
      !cursor ||
      pending ||
      mutation.current ||
      (pageAbort.current && !pageAbort.current.signal.aborted)
    )
      return;
    const own = generation.current;
    const abort = new AbortController();
    pageAbort.current = abort;
    setPending("more");
    setError("");
    try {
      const page = await fetchCurrentInboxPage(cursor, abort.signal, snoozed);
      if (!page || !active.current || own !== generation.current) return;
      pageCount.current++;
      // A loaded page supersedes an earlier poll of the shorter page span.
      // Both reads have current access; later polls refresh the whole span.
      controller.current?.publishReceipt((current) => ({
        ...page,
        items: [...current!.items, ...page.items],
      }));
    } catch (cause) {
      if (
        active.current &&
        own === generation.current &&
        !abort.signal.aborted
      ) {
        const error =
          cause instanceof Error
            ? cause
            : new Error("Unable to load more notifications.");
        const failure = inboxPageFailure(state, error);
        setState((current) => inboxPageFailure(current, error).state);
        setError(error.message);
        if (failure.denied) {
          ++generation.current;
          controller.current?.dispose();
          abort.abort();
          setCursor(null);
          pageCount.current = 1;
          setPending(null);
          notifications.deny(error);
        }
      }
    } finally {
      if (pageAbort.current === abort) pageAbort.current = null;
      if (active.current && own === generation.current && !abort.signal.aborted)
        setPending(null);
    }
  }
  return {
    state,
    items,
    cursor,
    pending,
    pendingLabel,
    error,
    more,
    count: notifications.state,
    retry() {
      setRevision((value) => value + 1);
      notifications.refresh();
    },
    read(id?: string, identifier?: string, documentId?: string | null) {
      return mutate({
        key: id ?? "all",
        url: id
          ? `/api/notifications/${encodeURIComponent(id)}/read`
          : "/api/notifications/read-all",
        label: "Opening…",
        failure: "Unable to mark notifications read.",
        identifier,documentId,
      });
    },
    snooze(id: string, body: SnoozeChoice) {
      return mutate({
        key: id,
        url: `/api/notifications/${encodeURIComponent(id)}/snooze`,
        label: "Snoozing…",
        failure: "Unable to snooze this notification.",
        body,
      });
    },
    unsnooze(id: string) {
      return mutate({
        key: id,
        url: `/api/notifications/${encodeURIComponent(id)}/unsnooze`,
        label: "Returning…",
        failure: "Unable to return this notification to Inbox.",
      });
    },
  };
}
