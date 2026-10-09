# CalCal v1.1 account setup

Project: `fitness-352e8`. Website: `https://hhn1n6.github.io/CalCal/`.

1. In Firebase Authentication, enable the Google sign-in provider and select the project support email.
2. In Authentication → Settings → Authorized domains, add `hhn1n6.github.io` (domain only).
3. Run the preparation tool with the original owner's Google email. It saves local backups and seeds a read-only food catalogue plus an owner-only migration marker. It never copies private records to the catalogue.
   `node tools/prepare_accounts.mjs owner@example.com --apply`
4. Publish `firestore.rules` in Firebase Console → Firestore Database → Rules, replacing the old rules. Alternatively use `firebase deploy --only firestore:rules --project fitness-352e8` after signing into the official Firebase CLI.
5. Publish the v1.1 web files. Sign in with the original owner's Google account and check the imported history. Do not delete the original `CalCal` or `days` collections.

## Data layout

- `users/{uid}`: account creation/import marker.
- `users/{uid}/settings/{goals,foodLists,foods,weights}`: private account settings and food database.
- `users/{uid}/days/{YYYY-MM-DD}`: private meal, water and supplement records.
- `catalog/{foods,foodLists}`: shared starter food data, readable by signed-in accounts and not writable by the web app.
- `migration/owner`: original owner's email; client reads are denied.
- `migration/legacy`: owner-only migration gate. Rules compare Google's verified email to the owner record on the server.

The original owner's first sign-in copies the existing records into that account. Existing account data is never automatically overwritten. Other accounts receive a copy of the food catalogue and start with default goals and empty personal records. Sign-out clears the in-memory account state and closes all dialogs. Sign-in remains remembered by Firebase on that device.

Google popup sign-in is used on GitHub Pages to avoid cross-domain redirect storage problems in Safari. If a popup is blocked, the login screen provides an explanation. Test the installed iPhone PWA separately; browser preview does not confirm iOS behaviour.

Do not publish account access with permissive Firestore rules. A login screen alone does not protect data.
