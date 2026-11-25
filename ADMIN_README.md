# Moderation

The moderation panel is at **/moderation** (in the game: Settings → Moderation →
Moderation panel). It opens for admins and the owner only; anyone else is sent to
the front page.

## Who can do what

| | Admin | Owner |
|---|---|---|
| Mute and unmute (10 minutes to 30 days, or no end) | yes | yes |
| Ban and unban (same times) | yes | yes |
| Send to the padded room, let out of it | yes | yes |
| Send to hell | yes | yes |
| Let out of hell | no | yes |
| Make or remove admins | no | yes |
| Give a passenger a new password (shown once, to pass on) | no | yes |
| Room editor, voyage clock reset | no | yes |

Nobody can act on the owner or on themselves; only the owner can act on an admin.
A ban, the padded room and hell need a reason; the passenger is told it.

The owner is set once with the script (an admin too):

    node scripts/makeAdmin.js <email> --owner

`node scripts/makeAdmin.js <email>` makes an admin (the owner can also do that in
the panel); `--revoke` takes it away. The script uses `MONGO_URL` from `.env`,
which is the live database.

## What the passenger sees

- **Muted**: told by whom it was not (just "a moderator"), until when and why; their
  lines are refused with the same words until the time is up.
- **Banned**: their open game closes and the login card says until when and why.
- **Padded room**: they are moved there at once and cannot leave until a moderator
  lets them out. They keep cards (Games), the shower, toilet and bed, and the menu
  serves a helping of rice and water only.
- **Hell**: the same, with nothing in it at all: no cards, no menu, no bed, and their
  needs cannot be refilled. Only the owner lets them out.

Moderators can visit either room (Settings → Moderation) to talk to the passenger,
and leave by the deck plans as usual.

## How the rooms hold

Everything is checked on the server (`lib/moderation.js` has the rules,
`server.js` applies them), so editing the page in the browser's tools gets a
passenger nowhere: every room asked for, chat line, card deal and purchase is
checked there. A locked-in passenger is put back in their room as they connect,
in every tab, after a reload, a new login or a server restart. Every action is
written to the panel's log (who, what, to whom, when, why).
