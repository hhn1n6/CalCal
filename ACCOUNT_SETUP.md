# CalCal v1.1 account setup

Project: `fitness-352e8`. Website: `https://hhn1n6.github.io/CalCal/`.

1. In Firebase Authentication, enable the Google sign-in provider and select the project support email.
   For v1.1.14, also enable **Email/Password** in Authentication → Sign-in method (email-link sign-in is not needed). The Login form signs in existing password accounts; it does not silently create accounts. Create password accounts in Firebase Authentication → Users → Add user. Existing Google-only accounts have no CalCal password: keep using Google until password linking is added. Do not create a separate account for the owner or move their records to another UID.
2. In Authentication → Settings → Authorized domains, add `hhn1n6.github.io` (domain only).
3. Run the preparation tool with the original owner's Google email. It saves dated local backups, creates an email-bound snapshot of the existing personal database and history, and records the requested admin identity. It creates neither a default nor a public food database. The source records remain unchanged. This is a one-time preparation; existing migration documents cause an abort rather than an overwrite.
   `node tools/prepare_accounts.mjs owner@example.com --apply`
4. Publish `firestore.rules` in Firebase Console → Firestore Database → Rules, replacing the old rules. Alternatively use `firebase deploy --only firestore:rules --project fitness-352e8` after signing into the official Firebase CLI.
5. Publish the v1.1 web files. Sign in with the original owner's Google account and check the imported history. Do not delete the original `CalCal` or `days` collections.

## Data layout

- `users/{uid}`: account creation/import marker.
- `users/{uid}/settings/{goals,foodLists,foods,weights}`: private account settings and food database.
- `users/{uid}/days/{YYYY-MM-DD}`: private meal, water and supplement records.
- `defaults/{foods,foodLists}`: independent starter template for new personal databases, to be designed later. Missing templates currently produce empty food lists. Personal edits never affect this template or another account.
- `publicFoods`: admin-managed food information for future search. It has no app UI and normal users have no direct access.
- `access/admin`: server-controlled verified Google email defining admin access. Clients cannot change this record. Admin access does not grant access to other users' personal records.
- `migration/owner`: original owner's email; client reads are denied.
- `migration/legacy`: owner-only migration gate. Rules compare Google's verified email to the owner record on the server.
- `migration/legacy/settings/*` and `migration/legacy/days/*`: preserved personal data snapshot, copied only to the matching Google account on first sign-in.

The original owner's first sign-in copies the preserved records into that account's Google UID. Existing account data is never automatically overwritten. Other accounts receive only the independent starter template, once designed, and start with default goals and empty personal records. Sign-out clears the in-memory account state and closes all dialogs. Sign-in remains remembered by Firebase on that device.

Changes made in v1.0 after the preparation snapshot are not automatically part of that snapshot. Refresh the migration snapshot with a reviewed, backed-up update before release if the original records have changed in the meantime.

Google popup sign-in is used on GitHub Pages to avoid cross-domain redirect storage problems in Safari. If a popup is blocked, the login screen provides an explanation. Test the installed iPhone PWA separately; browser preview does not confirm iOS behaviour.

Do not publish account access with permissive Firestore rules. A login screen alone does not protect data.
