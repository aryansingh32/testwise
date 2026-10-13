# Releasing the student app on Google Play

Status of the app as a build: config plugins resolve and `expo prebuild --platform android` succeeds. Firebase (push, Google sign-in) is deliberately not connected yet.

## Before the first store build
1. **API**: deploy over HTTPS and set `EXPO_PUBLIC_API_URL` in `apps/mobile/eas.json` (`build.production.env`). `app.config.ts` refuses a production build that points at localhost, an emulator address, `example.com` or plain HTTP.
2. **Accounts**: Play Console developer account, then `eas init`, `eas build -p android --profile production` (app bundle). Use the **internal testing** track first (`eas submit` is configured for a draft internal release).
3. **App signing**: let Play manage the signing key (EAS uploads the upload key). Copy the *app signing* certificate SHA-256 from Play Console → App integrity into Admin → Settings → Proctoring → "Android signing-certificate digests".
4. **Play Integrity**: link a Google Cloud project in Play Console → App integrity, enable the Play Integrity API, create a service account, set `PLAY_INTEGRITY_SA_JSON` on the API and the project number in Settings → Proctoring.
5. **Firebase** (next round): add `google-services.json` (the app config picks it up when present), enable Google sign-in and push.
6. Set `DEVICE_HASH_SALT` once on the API.

## Play Console declarations (these decide whether the app is approved)
- **Real-money / contests**: the app can run paid-entry tournaments with prizes. Google Play restricts real-money gaming apps and India has the Promotion and Regulation of Online Gaming Act 2025 (see docs/PLAN.md legal flag). Keep `policy.money` switches OFF (the default: paid entry and cash rewards disabled) until you have written legal advice; declare the app accordingly. Test-series purchases and free tournaments with non-cash rewards are a different category from paid-entry contests.
- **Data safety**: collects account info, device info, test activity; camera/microphone/screen only during a proctored test with consent; photos kept only when flagged (retention configurable). Deletion: Settings → Privacy & data. Privacy policy URL is required: host the in-app Privacy page text publicly.
- **Sensitive permissions**: CAMERA, RECORD_AUDIO (proctoring), FOREGROUND_SERVICE_MEDIA_PROJECTION (screen sharing in Live mode; a screen-recording foreground service declaration and demo video are required). `SYSTEM_ALERT_WINDOW` and external-storage permissions are blocked in `app.json`.
- **Minors**: students can be under 18. Camera/mic/screen proctoring is off for minors unless allowed in Settings → Proctoring; get guardian-consent and jurisdiction advice before enabling it.
- **Content rating / target audience**: includes children (class 6+): complete the Families/target-audience questions.

## Known gaps to close before a public launch
- Firebase auth + push (planned), Paytm adapter (Razorpay and mock exist).
- iOS screen sharing needs a ReplayKit broadcast extension (not built); iOS students stream camera and mic only.
- The native `device-integrity` module and App Attest/Play Integrity flows need a run on real devices.
- Load test against the acceptance gates in docs/SCALING-AND-EXAM-INTEGRITY.md before a large tournament.
