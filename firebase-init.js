/* Inicialización de Firebase (módulo ESM vía CDN).
   Expone window.FB con lo que necesita app.js y avisa con el evento 'fb-ready'. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Configuración pública del proyecto (segura para incluir en el cliente).
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
// Mantener la sesión iniciada entre recargas / cierres
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Firestore con caché local (funciona offline y sincroniza al reconectar)
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

window.FB = {
  auth, db,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  collection, doc, setDoc, deleteDoc, onSnapshot
};
window.dispatchEvent(new Event('fb-ready'));
