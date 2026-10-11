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
    apiKey: "PASTE_FIREBASE_API_KEY",
    authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
    projectId: "PASTE_PROJECT_ID",
    storageBucket: "PASTE_PROJECT_ID.appspot.com",
    messagingSenderId: "PASTE_SENDER_ID",
    appId: "PASTE_APP_ID"
  }
};
