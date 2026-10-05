import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, getDocs, writeBatch, deleteDoc,
         initializeFirestore, persistentLocalCache, persistentMultipleTabManager }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── FIREBASE CONFIG ──────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBrcFOX7Zm8_Xxs-ThAnUx0GnyvAz0yMD8",
  authDomain: "fitness-352e8.firebaseapp.com",
  projectId: "fitness-352e8",
  storageBucket: "fitness-352e8.firebasestorage.app",
  messagingSenderId: "1079426276749",
  appId: "1:1079426276749:web:e71e57288a1900d178b1c4"
};
const app = initializeApp(firebaseConfig);
// Local IndexedDB cache keeps data on the device after the first load.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export { doc, getDoc, setDoc, onSnapshot, writeBatch };
