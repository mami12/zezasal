# Small Windows USB transfer

Run `npm run pack:windows` to create a verified ZIP under `transfers/`.
The packaging command uses Node's built-in modules, Windows PowerShell and
Windows `tar`; it can run without this project's `node_modules`. It leaves the
laptop project intact.

**Accounts are a separate transfer.** To move the laptop's existing accounts,
passwords, balances and history, also create a database backup with `backup-db.bat`
and restore that private backup on the destination with `restore-db.bat`.
Copying the source ZIP alone creates a fresh installation with no laptop accounts.

The ZIP includes the application source, build configuration, lockfiles, Windows
launchers and all packaged original game assets in `web/public`.
It excludes installed dependencies, caches, screenshots, temporary files, raw
provider captures, old project copies, backups and machine-specific state.
It also excludes `web/dist`: Windows startup builds this second copy of the
website from the included source and assets.

Only the named `.env.*.example` templates are included. The laptop `.env` and
`data/` are excluded, so its test accounts and balances do not replace the server.
A SHA-256 manifest of every included source and asset file is saved beside the
ZIP, together with its verification result. Copy that small manifest too if you
want to retain the transfer audit.

## On the Windows server

1. Copy the ZIP to the server and extract it to a project folder.
2. For an existing installation, stop that server with its `stop.bat` first.
   Back up and retain the **server's** `.env` and `data/` when applying the new
   application files. This bundle does not contain accounts, balances or API keys.
3. Ensure Node.js 24 with npm is installed, as described in `WINDOWS-SERVER.md`.
   Windows `tar` must be available as well.
4. Double-click `start.bat`. First startup needs **internet** to install npm
   packages, then builds the website. Complete packaged Sizzling and Book of Ra
   assets are reused locally; their upstream archives are fetched only when the
   packaged copy needs repair. Chromium is not downloaded by this launcher.
5. Wait for the launcher to report that the server is ready. Open its displayed
   address, normally `http://localhost:3000/app/`.

This is a source transfer, not an offline installer. A new installation creates
fresh server settings and a local database. An existing server must keep its own
configuration and database. Moving a database is a separate operation and requires
stopping its owning server first.

For a database transfer, put the `.tgz` backup beside `start.bat` under the name
`database-transfer.tgz`, along with its `DATABASE-TRANSFER.json` when available.
Stop the destination server, run `restore-db.bat`, then `start.bat`. The restore
uses a new database folder, checks the snapshot before switching configuration,
and retains the old database and destination secrets. Do not replace a database
that has new financial activity with an older laptop snapshot.

## About deleting node_modules

`node_modules` contains installed packages and can be recreated from
`package-lock.json`. Keep both package files. The USB ZIP already excludes
`node_modules`, including `web/node_modules`, so deleting them on the laptop is
unnecessary for this transfer. If you later remove them to reclaim laptop space,
stop the local server first; the next `start.bat` will reinstall what it needs.

Keep the original supplied game folders somewhere as an archive if you want to
develop more games later. They are omitted from the USB ZIP; the game assets
already packaged for this application are included.
