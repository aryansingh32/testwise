import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Firebase sign-in on the device. Both flows end with a Firebase ID token that the app sends to our server, which
 * verifies it with Google and issues the app's own session. Nothing here decides who the user is.
 * Needs a development/production build (native modules); in Expo Go and on web the helpers say so instead of crashing.
 */
type RNAuth = typeof import('@react-native-firebase/auth');
type Confirmation = Awaited<ReturnType<RNAuth['signInWithPhoneNumber']>>;

export class FirebaseUnavailable extends Error {}

function authModule(): RNAuth {
  if (Platform.OS === 'web') throw new FirebaseUnavailable('Not available on web');
  try {
    return require('@react-native-firebase/auth') as RNAuth;
  } catch {
    throw new FirebaseUnavailable('This sign-in needs the installed Testwise app (not Expo Go).');
  }
}

/** Google account picker → Firebase credential → Firebase ID token. */
export async function googleIdToken(): Promise<string> {
  const fb = authModule();
  let GoogleSignin: typeof import('@react-native-google-signin/google-signin').GoogleSignin;
  try {
    GoogleSignin = (require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin')).GoogleSignin;
  } catch {
    throw new FirebaseUnavailable('This sign-in needs the installed Testwise app (not Expo Go).');
  }
  const webClientId = Constants.expoConfig?.extra?.googleWebClientId as string | undefined;
  if (!webClientId) throw new FirebaseUnavailable('Google sign-in is not configured in this build.');
  GoogleSignin.configure({ webClientId });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await GoogleSignin.signIn();
  const idToken = res.data?.idToken;
  if (!idToken) throw new Error('Google sign-in was cancelled');
  const cred = fb.GoogleAuthProvider.credential(idToken);
  const user = await fb.signInWithCredential(fb.getAuth(), cred);
  return user.user.getIdToken();
}

/** Step 1 of phone sign-in: Firebase texts a 6-digit code (E.164 number, e.g. +919876543210). */
export async function sendPhoneCode(e164: string): Promise<Confirmation> {
  const fb = authModule();
  return fb.signInWithPhoneNumber(fb.getAuth(), e164);
}

/** Step 2: confirm the code and return a Firebase ID token. */
export async function confirmPhoneCode(c: Confirmation, code: string): Promise<string> {
  const res = await c.confirm(code);
  if (!res) throw new Error('Could not verify the code');
  return res.user.getIdToken();
}

/** Clears the Firebase-side session; our own tokens are what protects the API. */
export async function firebaseSignOut() {
  try {
    const fb = authModule();
    await fb.signOut(fb.getAuth());
  } catch {
    /* not signed in with Firebase */
  }
}
