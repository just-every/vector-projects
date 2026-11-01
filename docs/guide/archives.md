# Installation archives

An archive is a complete, private copy of your Vector: everything you need to carry on in a new installation, and nothing that would let someone sign in as you. [Your data](data.md) shows how to take one.

## What an archive keeps

- Every issue with its history, comments, links and files.
- Teams, workflows, labels, projects, cycles and their closed-cycle numbers.
- Saved views, preferences, notifications and settings.
- The people in your workspace and everything they did, so the history still reads right.
- Your imports, including their original files.
- Your integrations' settings and their delivery history.

## What it leaves out

- Sign-in sessions and sign-in links: everyone signs in again after a restore.
- Every secret: API tokens and the secrets for sources, webhooks and GitHub repositories. You make or re-enter them afterwards.

An archive is still a full copy of your workspace, so keep it somewhere private.

## Restore into a new installation

1. Install Vector in a new folder, as in [Run it on your computer](install.md), but do not run setup yet.
2. Copy the archive into that folder's `exports` folder, then restore it:

   ```sh
   rer import --input exports/vector.jsonl --yes
   ```

3. Run setup with the same owner email the archive was made with, then start Vector and sign in:

   ```sh
   rer setup --owner-email EMAIL --non-interactive
   rer dev
   ```

A restore only goes into an empty installation; it never overwrites one that holds data.

## Before your team starts again

After a restore only you, the owner, can sign in, and Vector sends and receives nothing: no email, no webhooks, no reports from sources or GitHub. Messages that were waiting when the archive was made are never sent again. When you have checked the restored workspace:

1. Open **Settings → Restore**. Review the restored people and their sign-in status.
2. For each person you want to let back in, choose **Allow [name] to sign in**. Their refreshed status shows **Can sign in**; they can request a fresh sign-in link. Removed or inactive people cannot be admitted here.
3. In **Settings**, under **Connections** and **Developers**, check your destinations and make new API tokens. Remove anything you no longer want.
4. Return to **Restore** and choose **Turn on future effects**. The refreshed status confirms that future sending, receiving and scheduled effects are on. Historical deliveries remain quarantined; this never replays them.
5. Re-enter the secret for each source, destination and repository, as in [Integrations](integrations.md#after-a-restore).
