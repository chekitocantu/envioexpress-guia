/* Inicialización de Firebase para el CRM (módulo ESM vía CDN).
   Expone window.FB y avisa con el evento 'fb-ready'.
   Misma configuración de proyecto que el equipo ya usa. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Configuración pública del proyecto (segura para el cliente).
const firebaseConfig = {
  apiKey: "AIzaSyBGg_SQkYcyOwgQAqzEjabMLGEYnFGrl_0",
  authDomain: "test-7c6c5.firebaseapp.com",
  projectId: "test-7c6c5",
  storageBucket: "test-7c6c5.firebasestorage.app",
  messagingSenderId: "1087980965752",
  appId: "1:1087980965752:web:347de4e70a36e3afc4428d",
  measurementId: "G-QF739KFLYE"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Firestore con caché local (offline + sincronización entre pestañas/equipos).
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

window.FB = {
  auth, db,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp
};
window.dispatchEvent(new Event('fb-ready'));
