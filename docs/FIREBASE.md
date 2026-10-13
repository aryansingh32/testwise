# Firebase integration (project `testwisee`, number 683675464177)

## Done
- Android app `app.testwise.student` → `1:683675464177:android:73add4a5f25a64619f5450`; iOS app → `1:683675464177:ios:cd099cef9f71b8519f5450`. Config files are in `apps/mobile/` (git-ignored). Debug SHA-1 `2A:8A:A1:…:E8:29` is registered.
- **API**: `POST /v1/auth/firebase` verifies a Firebase ID token with the Admin SDK (`FIREBASE_PROJECT_ID`, no secret needed), then finds the account by Firebase uid, links by a *verified* email or phone, or creates it, and returns our own session. Honours the Login-methods toggles in Admin → Settings. An unverified email never links to an existing account.
- **App**: React Native Firebase (`app`, `auth`) + Google Sign-In config plugins, Google and phone-OTP buttons on the login screen, a phone sign-in screen. Needs a development/production build (native modules); Expo Go shows a clear message.
- **Push**: `google-services.json` is picked up by `app.config.ts`; the API's FCM sender needs the service account below.

## You still need to do (console only; the CLI/API cannot do these)
1. Authentication → Sign-in method: enable **Google** (set the support email) and **Phone**. Then re-run:
   `firebase apps:sdkconfig ANDROID <appId> --project testwisee --out apps/mobile/google-services.json` and the same for IOS (`GoogleService-Info.plist`), so they contain the OAuth clients / `REVERSED_CLIENT_ID`.
2. Project settings → Service accounts → Generate new private key → set `FIREBASE_SERVICE_ACCOUNT` (or `_PATH`) on the API for push. Never commit it.
3. For every signing key you ship (EAS upload key, Play app-signing key): `firebase apps:android:sha:create <androidAppId> <SHA-1> --project testwisee` (and add the SHA-256 in the console). Google sign-in and phone auth fail on a build whose SHA is not registered.
4. iOS push: upload an APNs auth key in Project settings → Cloud Messaging.
5. Admin → Settings → Login methods: switch Google / Mobile OTP **on** only after steps 1–3.
6. `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` can override the web client id (otherwise read from google-services.json).
7. Play Integrity can reuse this project number (683675464177): enable the Play Integrity API on it and link it in Play Console.

Notes: iOS needs `useFrameworks: static` (set via expo-build-properties), which can conflict with other native pods: build iOS once to confirm. Phone OTP SMS volume may need the Blaze plan.

## Service account + Play Integrity (set up)
- The `testwisee` Admin SDK key lives at `apps/api/secrets/firebase-adminsdk.json` (git-ignored; permission 600). `apps/api/.env` points `FIREBASE_SERVICE_ACCOUNT_PATH` (push) and `PLAY_INTEGRITY_SA_FILE` (integrity verdicts) at it. Verified: it authenticates to FCM and Firebase Auth admin.
- Admin → Settings → Proctoring is set to package `app.testwise.student` and Cloud project number `683675464177`.
- **Still manual (the service account is not allowed to do these):** (1) enable the API: https://console.cloud.google.com/apis/library/playintegrity.googleapis.com?project=testwisee ; (2) Play Console → your app → Release → App integrity → link Cloud project 683675464177; (3) paste the Play *app signing* certificate SHA-256 digest into Settings → Proctoring → certificate digests.
- A sideloaded/test APK is never "Play recognized", so `requireAttestation` is **off in the dev database** for testing. Turn it back on before shipping from Play.
- Test APK debug-signing SHA-1/256 (`5E:8F:16:…:F6:25`) is registered in Firebase so Google sign-in works on it.
