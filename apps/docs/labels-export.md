# Labels export (QR URL for third-party label printers)

Every Shelf QR code encodes one URL: `getQrBaseUrl() + "/" + qrId` (`apps/webapp/app/modules/qr/qr-url.server.ts`). With `URL_SHORTENER` set (production: `eam.sh`) that is `https://eam.sh/<qrId>`, which redirects to `https://app.shelf.nu/qr/<qrId>`; without it, `<SERVER_URL>/qr/<qrId>`.

The URL is stable. It depends only on the code's id and the server's shortener setting, never on the asset or kit the code is linked to, so a printed label keeps working when a code is relinked.

Where it is exported:

- **Asset index CSV export** (Export selection, advanced mode only: simple mode has no export button; picked rows or select-all, visible or all columns): a `QR URL` column right after `QR ID`, shown whenever `QR ID` is, unless an exported custom field is already named `QR URL` (then that field keeps the header, so a re-import updates it). Empty for an asset without a code. The import-ready export has no QR columns.
- **Asset Inventory report CSV**: a `QR Code URL` column after `QR Code ID`.
- **Bulk QR download zip** (selected assets): a `labels.csv` at the zip root with `Asset name, SAM ID, QR ID, QR URL, Category, Location`, one row per asset, UTF-8 with BOM. A missing category or location is an empty cell, not "Uncategorized", so nothing stray prints on a label. A value starting with `=` or `@`, or with `+`/`-` followed by formula syntax, gets a leading `'` so spreadsheets do not run it. A plain signed measurement such as `-20C Freezer` is left as typed, because label software prints the `'`. The images are unchanged.

**KB follow-up:** the website-v2 article `how-to-print-custom-branded-qr-code-labels-with-shelf` still tells customers to ask support for a CSV of URLs. It must be updated to describe this self-service path (download the QR codes or export the CSV, then map `QR URL` in the label software).
