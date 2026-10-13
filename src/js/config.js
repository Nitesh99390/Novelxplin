/* =========================================================
   Novelxplin – site configuration
   1) Paste your Firebase web-app config below (Firebase console →
      Project settings → Your apps → SDK setup and configuration).
   2) Enable Authentication → Sign-in method → Google, and create a
      Firestore database (production mode) – rules are in firestore.rules.
   3) API_BASE: leave "" when the frontend is served by server.js on the
      Oracle instance (same origin). Otherwise put e.g. "http://144.24.114.118:3000".
   ========================================================= */
window.NX_CONFIG = {
  SITE_NAME: "Novelxplin",
  API_BASE: "",
  ADMIN_EMAILS: ["bhuimharniteshbhuimhar@gmail.com"],
  FIREBASE: {
    apiKey: "AIzaSyBbkeL5K-XCRjskiLjR1h1pDzLRLWwvIXg",
    authDomain: "nitesh-75d47.firebaseapp.com",
    databaseURL: "https://nitesh-75d47-default-rtdb.firebaseio.com",
    projectId: "nitesh-75d47",
    storageBucket: "nitesh-75d47.firebasestorage.app",
    messagingSenderId: "319671865593",
    appId: "1:319671865593:web:98fd66daa5062e4f401228",
    measurementId: "G-NJNBZQNZNG"
  }
};
