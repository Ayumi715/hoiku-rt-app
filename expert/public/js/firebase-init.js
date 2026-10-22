// compat版SDKは index.html で読み込み済み(保育士用アプリと同じプロジェクト)
const firebaseConfig = {
  apiKey: "AIzaSyBNInM04iaqc5ZrJwdHMr28nBh-77tf5_o",
  authDomain: "test-63a18.firebaseapp.com",
  projectId: "test-63a18",
  storageBucket: "test-63a18.firebasestorage.app",
  messagingSenderId: "1065976342288",
  appId: "1:1065976342288:web:7fddc8db19f0eef0aee795",
  measurementId: "G-YPQQFFFL1D"
};

firebase.initializeApp(firebaseConfig);

export const db = firebase.firestore();

// エミュレータ利用時: http://localhost:5000/?emulator
if (location.search.includes("emulator")) {
  db.useEmulator("localhost", 8080);
}