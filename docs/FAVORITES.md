# Favorites

Open an issue, project or accessible saved view and choose **Pin this issue**, **Pin this project** or **Pin this view** in Favorites. On a phone, open Favorites in the header. Pins belong to the signed-in member and are available in independently signed-in browsers.

Choose **Organize** to create named folders, move a pin into a folder, change order with the keyboard-accessible Up and Down controls, or unpin it. Removing a folder moves its pins back to the top level. Pinning and organization leave saved-view definitions unchanged.

The native `GET /api/favorites` door returns current titles and links after the ordinary subject visibility checks. Deleted or inaccessible subjects are omitted. The stored collection contains only stable subject identities, folder names and order. The native `PUT /api/favorites` door requires the last read `expectedVersion`; a stale or replayed write returns 409 without replacing newer work. An unavailable subject refuses the complete write. Both doors act on the authenticated member only.

Apply `0121_member_favorites.sql` forward without changing earlier migrations. Native archives retain the personal collection and its version; restored sessions still require fresh authentication. Member removal clears the personal collection. Favorites are navigation preferences rather than issue-owned content, so import rollback does not copy or overwrite another member's collection; deleted imported subjects disappear through ordinary visibility projection.

Other subject types, dragging, unread badges and native mobile synchronization are not implemented yet.
