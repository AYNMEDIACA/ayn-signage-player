// player.js
const fs = require('fs').promises;
const path = require('path');
const { exec, execSync } = require('child_process');
const http = require('http');
const url = require('url');
const querystring = require('querystring');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, updateDoc, serverTimestamp, onSnapshot, getDoc, collection } = require('firebase/firestore');
const { machineIdSync } = require('node-machine-id');

// --- YOUR FIREBASE CONFIGURATION IS NOW INCLUDED ---
const firebaseConfig = {
  apiKey: "AIzaSyBTwgBRrcU7YUyj1TzAdYa6MQhQSYuPmpo",
  authDomain: "ayn-signage.firebaseapp.com",
  projectId: "ayn-signage",
  storageBucket: "ayn-signage.firebasestorage.app",
  messagingSenderId: "396118576750",
  appId: "1:396118576750:web:271c1fc5c1e2b6b905e07f",
  measurementId: "G-C3ZFYG6H43"
};
// --------------------------------------------------

const CONFIG_PATH = path.join(__dirname, 'player-config.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// =================================================================
// Wi-Fi SETUP MODE LOGIC
// =================================================================

function serveSetupPage(req, res) {
    if (req.url === '/') {
        // Scan for Wi-Fi networks
        exec('sudo nmcli --get-fields SSID device wifi list', (err, stdout, stderr) => {
            const networks = stdout.split('\n').filter(line => line.trim() !== '' && !line.includes('--')).map(ssid => ssid.trim());
            const uniqueNetworks = [...new Set(networks)];

            // Serve the HTML page with the list of networks
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>AYN Signage Wi-Fi Setup</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif; background-color: #f3f4f6; color: #111827; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                        .container { background: white; padding: 2rem; border-radius: 0.5rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 90%; max-width: 400px; }
                        h1 { text-align: center; color: #1E40AF; }
                        label { font-weight: 500; margin-top: 1rem; display: block; }
                        select, input { width: 100%; padding: 0.5rem; margin-top: 0.25rem; border: 1px solid #d1d5db; border-radius: 0.25rem; box-sizing: border-box; }
                        button { width: 100%; padding: 0.75rem; margin-top: 1.5rem; background-color: #1E40AF; color: white; border: none; border-radius: 0.25rem; font-size: 1rem; font-weight: 600; cursor: pointer; }
                        button:hover { background-color: #1d4ed8; }
                        .hidden { display: none; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>Wi-Fi Setup</h1>
                        <form action="/save-wifi" method="post">
                            <label for="ssid">Select Network (SSID):</label>
                            <select id="ssid" name="ssid" onchange="document.getElementById('manual_ssid').classList.toggle('hidden', this.value !== 'manual')">
                                <option value="">--Please choose a network--</option>
                                ${uniqueNetworks.map(n => `<option value="${n}">${n}</option>`).join('')}
                                <option value="manual">--Enter Manually--</option>
                            </select>
                            <input type="text" id="manual_ssid" name="manual_ssid" placeholder="Enter SSID manually" class="hidden" style="margin-top: 0.5rem;">
                            <label for="password">Password:</label>
                            <input type="password" id="password" name="password" required>
                            <button type="submit">Connect & Reboot</button>
                        </form>
                    </div>
                </body>
                </html>
            `);
        });
    } else if (req.url === '/save-wifi' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            const params = querystring.parse(body);
            const ssid = params.ssid === 'manual' ? params.manual_ssid : params.ssid;
            const password = params.password;

            console.log(`Attempting to connect to SSID: ${ssid}`);

            try {
                // Use nmcli to add the new Wi-Fi connection
                execSync(`sudo nmcli device wifi connect "${ssid}" password "${password}"`);
                
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('Wi-Fi configured! The device will now reboot...');

                // Reboot the device to apply changes
                setTimeout(() => exec('sudo reboot'), 2000);
            } catch (error) {
                console.error("Failed to connect to Wi-Fi:", error);
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end('Failed to connect. Please check your password and try again. The page will refresh in 5 seconds.');
                setTimeout(() => {
                    res.writeHead(302, { 'Location': '/' });
                    res.end();
                }, 5000);
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
}


// =================================================================
// SIGNAGE PLAYER MODE LOGIC
// =================================================================

function generateRegCode() {
  const prefix = 'AY';
  const randomPart = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `${prefix}-${randomPart}`;
}

function displayOnScreen(line1, line2) {
    const htmlContent = `
        <html>
            <body style="background-color: #111827; color: white; font-family: monospace; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-size: 2.5vw;">
                <h1>${line1}</h1>
                <p>${line2}</p>
            </body>
        </html>
    `;
    execSync('killall chromium-browser || true');
    fs.writeFile('/tmp/display.html', htmlContent).then(() => {
        exec('chromium-browser --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 /tmp/display.html');
    });
}

async function runPlayerMode() {
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

    setInterval(() => {
        updateDoc(playerDocRef, {
            status: 'Online',
            lastSeen: serverTimestamp()
        }).catch(err => console.error('Heartbeat failed:', err));
    }, 60 * 1000);

    onSnapshot(playerDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            console.log('Received update:', data);
            
            if (data.userId && data.name) {
                displayOnScreen(data.name, `Status: Online`);
            }
        } else {
            console.log('Player document was deleted from the server.');
        }
    });

    const initialSnap = await getDoc(playerDocRef);
    if (initialSnap.exists() && initialSnap.data().userId && initialSnap.data().name) {
        displayOnScreen(initialSnap.data().name, `Status: Online`);
    }
}


// =================================================================
// MAIN STARTUP LOGIC
// =================================================================
async function main() {
    // Check if we are in setup mode by looking for the hotspot's IP address.
    const networkInterfaces = require('os').networkInterfaces();
    const isSetupMode = Object.values(networkInterfaces).flat().some(iface => iface.address === '192.168.42.1');

    if (isSetupMode) {
        console.log("No Wi-Fi connection detected. Starting in Wi-Fi Setup Mode.");
        displayOnScreen('Wi-Fi Setup Required', 'Connect to "AYN-Signage-Setup" network');
        http.createServer(serveSetupPage).listen(80);
    } else {
        console.log("Wi-Fi connection found. Starting Player Mode.");
        runPlayerMode().catch(console.error);
    }
}

main();