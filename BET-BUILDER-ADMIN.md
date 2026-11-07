# Bet Builder admin picker

The admin selects outcomes through category buttons (1X2, Double Chance, BTTS and Total Goals), chooses exactly two different supported markets, and presses Save. The server generates the title from the normalized pair. There is no manual title field or third selection. New builders are active by default; existing saved builders can be edited, disabled or deleted. Historical tickets keep their frozen selections.

These remain universal templates. A match exposes a saved builder only when both underlying contracts are open and the provider supplies the exact joint price. Individual odds are never multiplied to invent a same-game price. Supported quote families are Result + BTTS, Result + Total, BTTS + Total, and Double Chance + Total.

`npm run test:builder-admin` verifies category options, exact two-leg validation, automatic titles, SQL create/edit persistence, and the existing provider-price and settlement regression suite. A disposable browser session verifies selecting two buttons, saving and reopening the saved combination.
