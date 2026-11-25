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

## Second accounts

The panel flags accounts that may belong to a passenger who is banned, locked in
or muted ("Possible second account"; the "Flagged" filter lists them all), and
each passenger's card lists their linked accounts:

- **Same browser** (red flag): the two accounts were played in the same browser.
  A strong sign of one person.
- **Same network** (grey flag): they played on the same internet connection. A weak
  sign: a family, a school or a café share one.

Nothing is done to a flagged account by itself; a moderator decides. How it knows:
each browser keeps a random id of its own (`public/js/device.js`), sent at login,
registration and as the game connects. The server keeps only a scrambled code of
it and of the network (never the address), the first two and the latest four of
each per account, and links accounts that share one. A player who clears their
browser's data and changes network is not caught.

## Money

Passengers send each other money from the Money card in the game (the bottom
bar's Money button), with a short note if they like, and see the ten richest
aboard and their own place. Every first-class passenger starts with £1,000, so a
player can make extra accounts and send their money to one character to climb the
list. Each passenger's card on the panel shows their money and their money sent and
received, with the other passenger and the note: money arriving from several new
accounts, or from linked ones (see above), is the sign. Banned passengers are left
out of the list and cannot be sent money; a passenger locked in cannot send any,
and a muted one cannot add a note.

## Messages and events

Passengers write to each other from the Inbox (the bottom bar's Inbox button),
and post events from the Events card: a title, a room of the ship, a time of the
ship's day (today or tomorrow) and a description. Every chat is told as an event
starts. A muted passenger can neither write nor post, a locked-in one neither,
and nobody can write to a banned passenger. Messages are private: the panel does
not show them.

A moderator sees **Remove** on every event in the Events card. A removal goes in
the panel's log ("Event removed", with the event's title and room), and those who
meant to go are told it is off. A ban takes the banned passenger's coming events
off as well.

## How the rooms hold

Everything is checked on the server (`lib/moderation.js` has the rules,
`server.js` applies them), so editing the page in the browser's tools gets a
passenger nowhere: every room asked for, chat line, card deal and purchase is
checked there. A locked-in passenger is put back in their room as they connect,
in every tab, after a reload, a new login or a server restart. Every action is
written to the panel's log (who, what, to whom, when, why).
