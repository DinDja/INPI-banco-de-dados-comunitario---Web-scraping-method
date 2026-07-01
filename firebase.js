import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDkE2t3E_HCjdydRR5r-mUmP9MWpSjfnfY",
  authDomain: "inpi-database-b5010.firebaseapp.com",
  projectId: "inpi-database-b5010",
  storageBucket: "inpi-database-b5010.firebasestorage.app",
  messagingSenderId: "802642406302",
  appId: "1:802642406302:web:40dce741237df3c1b1048f",
  measurementId: "G-MS9REWJ5RF"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);