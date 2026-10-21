import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyDWXCMXeYGDndCU9QNSKZe4mbBzLGvudgA",
  authDomain: "gen-lang-client-0945818855.firebaseapp.com",
  projectId: "gen-lang-client-0945818855",
  storageBucket: "gen-lang-client-0945818855.firebasestorage.app",
  messagingSenderId: "174990847030",
  appId: "1:174990847030:web:11b6d941a933ccd3d9fc97"
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()

export async function loginWithGoogle() {
  return signInWithPopup(auth, googleProvider)
}

export async function logoutFirebase() {
  return signOut(auth)
}
