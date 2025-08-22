// player.js
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, updateDoc, serverTimestamp, onSnapshot, getDoc } = require('firebase/firestore');
const { machineIdSync } = require('node-machine-id');

// --- IMPORTANT: PASTE YOUR FIREBASE CONFIG HERE ---
const firebaseConfig = {
  apiKey: "AIzaSyBTwgBRrcU7YUyj1TzAdYa6MQhQSYuPmpo",
  authDomain: "ayn-signage.firebaseapp.com",
  projectId: "ayn-signage",
  storageBucket: "ayn-signage.firebasestorage.app",
  messagingSenderId: "396118576750",
  appId: "1:396118576750:web:271c1fc5c1e2b6b905e07f"
};
// --------------------------------------------------

const CONFIG_PATH = path.join(__dirname, 'player-config.json');

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Function to generate a unique registration code
function generateRegCode() {
  const prefix = 'AY';
  const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `${prefix}-${randomPart}`;
}

// Function to display info on the screen using a simple web server and Chromium
function displayOnScreen(line1, line2) {
    const htmlContent = `
        <html>
            <body style="background-color: #111827; color: white; font-family: monospace; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-size: 2.5vw;">
                <h1>${line1}</h1>
                <p>${line2}</p>
            </body>
        </html>
    `;
    // Kill any existing chromium process to prevent multiple windows
    exec('killall chromium-browser');
    // Write the HTML file
    fs.writeFile('/tmp/display.html', htmlContent).then(() => {
        // Start Chromium in kiosk mode
        exec('chromium-browser --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 /tmp/display.html');
    });
}


async function main() {
    let config;
    try {
        const configFile = await fs.readFile(CONFIG_PATH);
        config = JSON.parse(configFile);
        console.log('Config file found. Player ID:', config.docId);
    } catch (error) {
        console.log('No config file found. This is a first-time setup.');
        
        const registrationCode = generateRegCode();
        const hardwareId = machineIdSync();
        
        displayOnScreen('AYN Signage Player', `Registration Code: ${registrationCode}`);
        console.log(`Your registration code is: ${registrationCode}`);

        const screenRef = doc(collection(db, 'screens'));
        await setDoc(screenRef, {
            hardwareId,
            registrationCode,
            status: 'Offline',
            createdAt: serverTimestamp(),
            lastSeen: serverTimestamp()
        });

        config = { docId: screenRef.id, registrationCode, hardwareId };
        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log('Player registered with ID:', config.docId);
    }

    const playerDocRef = doc(db, 'screens', config.docId);

    // Start heartbeat to update 'lastSeen' timestamp every 60 seconds
    setInterval(() => {
        updateDoc(playerDocRef, {
            status: 'Online',
            lastSeen: serverTimestamp()
        }).catch(err => console.error('Heartbeat failed:', err));
    }, 60 * 1000);

    // Listen for changes on this player's document
    onSnapshot(playerDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('Received update:', data);
            
            // If the user has claimed this screen and given it a name, update the display
            if (data.userId && data.name) {
                displayOnScreen(data.name, `Status: Online`);
            }
            
            // TODO: Add logic here to handle playlist changes
            // if (data.assignedPlaylistId) { ... }

        } else {
            console.log('Player document was deleted from the server.');
        }
    });

     // Initial check to see if we've been claimed yet
     const initialSnap = await getDoc(playerDocRef);
     if (initialSnap.exists() && initialSnap.data().userId && initialSnap.data().name) {
         displayOnScreen(initialSnap.data().name, `Status: Online`);
     }
}

main().catch(console.error);