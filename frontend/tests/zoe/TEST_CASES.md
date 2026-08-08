# Test case record — Zoe (frontend)

Every test in this folder, by name, as reported by Vitest itself. Generated
from `npx vitest run tests/zoe --reporter=json` on 2026-08-09, so this list
cannot drift from what actually runs.

**75 tests, 75 passing, 0 failing.**

See [README.md](README.md) for what each file covers and how to run it.

## ContractorInboxPage.test.jsx (27)

**ContractorInboxPage**

- lists the assigned defects and opens the first one
- a non-contractor is sent back to their dashboard
- an empty inbox explains itself rather than showing a blank page
- a failed load says so
- a ?defect= deep link opens that job instead of the first
- a stale deep link falls back to the normal selection

**ContractorInboxPage > counts and filters**

- the tiles split the inbox by what is left to do, and filter to it
- a held defect is not counted as overdue
- an empty bucket offers a way back out
- filtering by block narrows the list to that block

**ContractorInboxPage > acknowledge**

- acknowledging a defect reports it and refetches the inbox
- a failed acknowledge shows the server reason
- a submitted defect offers no further action

**ContractorInboxPage > hold and resume**

- a hold needs a reason before it can be placed
- placing a hold sends the trimmed reason and pauses the deadline
- cancelling the hold dialog holds nothing
- a held defect shows its reason and can be resumed
- a held defect is still workable — the hold does not lock the form
- a failed resume shows the server reason

**ContractorInboxPage > completing the work**

- submit is refused until every item is ticked
- submitting unsigned is refused, and nothing is sent
- signing then confirming finalizes with the items, remarks and signature
- cancelling the confirmation submits nothing
- Save progress sends what is done so far without a signature
- a defect with no checklist items uses the overall remark
- a failed submit keeps the work on screen and says why
- switching defect resets the work panel

## NotificationsPage.test.jsx (24)

**NotificationsPage role split**

- a manager gets the composer
- a contractor gets their own composer, and no manager-only fetch runs
- an inspector or admin reaching the route still gets the manager composer
- no profile yet falls back to the manager composer rather than nothing

**NotificationsPage manager composer — validation**

- an empty message never opens the confirmation
- a whitespace-only message is treated as empty
- the block scope needs at least one block
- the contractor scope needs a contractor picked
- fixing the problem clears the error and lets the send through

**NotificationsPage manager composer — sending**

- a comma-separated block list becomes an array of trimmed blocks
- only contractors with a linked login are offered
- the chosen contractor is named in the confirmation and sent as a user id
- a failed contractor list says so instead of looking empty
- an immediate send reports the count and starts the live receipt badge
- a scheduled send confirms the schedule and shows no receipts
- the message clears after a send and the history is reloaded
- a failed send shows the server message
- Clear puts the form back to its starting state

**NotificationsPage manager composer — send history**

- each row shows its status, scope and read count
- a scheduled row shows its send time and no read count
- a single recipient is counted in the singular
- an unknown stored scope falls back to its type rather than breaking the row
- an empty history says so
- a failed history load is an error, not an empty list

## ContractorNotifyPage.test.jsx (17)

**ContractorNotifyPage**

- opens addressed to both audiences, and says so before anything is typed
- the banner follows the picker
- with no audience selected there is nothing to send to
- an empty or whitespace-only message cannot be sent
- a message over the 500-character limit is refused
- exactly 500 characters is still allowed
- both audiences map to the managers_and_inspectors scope
- managers only maps to the managers scope
- inspectors only maps to the inspector_team scope
- the chosen urgency is carried through, and named in the confirmation
- cancelling the confirmation sends nothing and keeps the message
- a sent message clears the box but keeps the audience
- one recipient is reported in the singular
- the urgency resets to Informational so the next message does not inherit Critical
- a failed send shows the server message and keeps the text to retry
- a failure with no server message falls back to a usable one
- the success alert can be dismissed

## ReadReceiptBadge.test.jsx (7)

**ReadReceiptBadge**

- says it is loading until the first count arrives
- shows a genuine zero rather than staying on "loading"
- with no notification id it asks for nothing
- the count climbs as recipients read it
- a failed tick keeps the last count, and the next one recovers
- switching notification refetches for the new one
- an unmounted badge stops polling
