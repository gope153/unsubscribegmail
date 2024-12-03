const fs = require('fs');
const { google } = require('googleapis');
const express = require('express');
const path = require('path');
let open;
let answer;

const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

// Dynamische Importe für ES-Module
async function loadModules() {
    try {
        const openModule = await import('open');
        open = openModule.default;
    } catch (err) {
        console.error('Failed to import the open module', err);
    }

    if (open) {
        // answer = await new Promise((resolve) => {
        //     readline.question('Do you want to download invoices or unsubscribe from emails? (invoices/unsubscribe) ', resolve);
        // });
        answer = '2';

        checkCredentialsAndStart();
    } else {
        console.error('Required modules could not be loaded. Exiting.');
    }

}

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';
const PORT = 3000;
let oAuth2Client;

function downloadInvoices() { }

function checkCredentialsAndStart() {
    if (fs.existsSync(CREDENTIALS_PATH)) {
        console.log('"credentials.json" found. Proceeding with authorization.');
        fs.readFile(CREDENTIALS_PATH, (err, content) => {
            if (err) {
                console.error('Error reading the credentials file:', err);
                return;
            }
            try {
                const credentials = JSON.parse(content);
                if (credentials.installed || credentials.web) {
                    console.log('Credentials file is valid. Starting authorization process...');
                    authorize(credentials);
                } else {
                    console.error('Invalid credentials file format. Please ensure it is a valid OAuth 2.0 Client ID JSON file.');
                }
            } catch (parseErr) {
                console.error('Error parsing the credentials file. Ensure it is a valid JSON file:', parseErr);
            }
        });
    } else {
        guideUserAndWatchForCredentials();
    }
}

function guideUserAndWatchForCredentials() {
    console.log('It looks like you do not have the required credentials file (credentials.json) for accessing the Gmail API.');
    console.log('Follow these steps to create one:');
    console.log('1. Go to the Google Cloud Console to activate the Gmail API:');
    console.log('   https://console.cloud.google.com/marketplace/product/google/gmail.googleapis.com?');
    console.log('2. Create or select a project, then enable the Gmail API.');
    console.log('3. Go to "Credentials" and create an OAuth 2.0 Client ID for a "Desktop App".');
    console.log('4. Download the JSON file and save it in this folder.');
    console.log('5. This script will automatically detect the file and proceed.');

    open('https://console.cloud.google.com/marketplace/product/google/gmail.googleapis.com?')
        .then(() => {
            console.log('The Google Cloud Console has been opened in your default browser.');
        })
        .catch(err => {
            console.error('Failed to open the Google Cloud Console URL automatically. Please open it manually:', 'https://console.cloud.google.com/marketplace/product/google/gmail.googleapis.com?');
        });

    watchForCredentials();
}

function watchForCredentials() {
    console.log(`Waiting for the "credentials.json" file to be added to the current folder...`);

    fs.watch('.', (eventType, filename) => {
        if (eventType === 'rename' && filename === 'credentials.json') {
            const filePath = path.join('.', 'credentials.json');
            if (fs.existsSync(filePath)) {
                console.log('"credentials.json" detected. Proceeding with the setup...');
                fs.readFile(filePath, (err, content) => {
                    if (err) {
                        console.error('Error reading the credentials file:', err);
                        return;
                    }
                    try {
                        const credentials = JSON.parse(content);
                        if (credentials.installed || credentials.web) {
                            console.log('Credentials file is valid. Starting authorization process...');
                            authorize(credentials);
                        } else {
                            console.error('Invalid credentials file format. Please ensure it is a valid OAuth 2.0 Client ID JSON file.');
                        }
                    } catch (parseErr) {
                        console.error('Error parsing the credentials file. Ensure it is a valid JSON file:', parseErr);
                    }
                });
            }
        }
    });
}

function authorize(credentials) {
    const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;
    oAuth2Client = new google.auth.OAuth2(client_id, client_secret, `http://localhost:${PORT}/oauth2callback`);

    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting the following URL:');
    console.log(authUrl);

    if (!fs.existsSync(TOKEN_PATH)) {
        open(authUrl).then(() => {
            console.log('URL opened in your default browser. Please authorize the app.');
        }).catch(err => {
            console.error('Failed to open the authorization URL automatically. Please open the link manually:', authUrl);
        });
    } else {
        console.log('"token.json" found. Skipping authorization step.');
        fs.readFile(TOKEN_PATH, async (err, token) => {
            if (err) {
                console.error('Error reading the token file:', err);
                return;
            }
            oAuth2Client.setCredentials(JSON.parse(token));

            try {
                let returnValue = await askUserPreferences();
                console.log("returnValue", returnValue);
            } catch (error) {
                console.error('Error fetching messages:', error);
            }

            listMessages(oAuth2Client);
            console.log("Finished processing messages.");
        });
    }

    startServer();
}

function startServer() {
    const app = express();

    app.get('/oauth2callback', (req, res) => {
        const code = req.query.code;
        if (code) {
            console.log('Authorization code received:', code);
            res.send('Authorization successful! You can close this tab.');
            exchangeCodeForToken(code);
        } else {
            res.send('Authorization failed. Please try again.');
        }
    });

    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

async function exchangeCodeForToken(code) {
    oAuth2Client.getToken(code, (err, token) => {
        if (err) {
            console.error('Error retrieving access token', err);
            return;
        }
        oAuth2Client.setCredentials(token);
        fs.writeFile(TOKEN_PATH, JSON.stringify(token), async (err) => {
            if (err) {
                console.error('Error storing the token', err);
            } else {
                console.log('Token stored to', TOKEN_PATH);
                console.log('Authorization complete. You can now access your Gmail data.');
                try {
                    let returnValue = await askUserPreferences();
                    console.log("returnValue", returnValue);
                } catch (error) {
                    console.error('Error fetching messages:', error);
                }
                listMessages(oAuth2Client);
                console.log("Finished processing messages.");

            }
        });
    });
}


// Standardwerte
let emailCheckLimit = 200;
let runHeadless = true;

// Funktion zur Benutzerabfrage
function askUserPreferences() {
    return new Promise((resolve) => {

        console.log('\nWelcome to the Email Unsubscribe Tool!\n');

        readline.question('How many emails should be checked? (Default: 200): ', (limit) => {
            emailCheckLimit = parseInt(limit, 10) || 200; // Standardwert 200, falls keine Eingabe
            readline.question('Should the process run visibly? (yes/no, Default: no): ', (visibility) => {
                runHeadless = !(visibility.trim().toLowerCase() === 'yes');
                readline.close();
                resolve();
            });
        });
    });
}

async function listMessages(auth, pageToken = null, processedMessagesCount = 0) {
    console.log("Processing messages...");

    const gmail = google.gmail({ version: 'v1', auth });
    const MAX_PROCESSED_MESSAGES = emailCheckLimit;
    const MAX_RESULTS = 20;

    if (processedMessagesCount >= MAX_PROCESSED_MESSAGES) {
        console.log(`Processed ${MAX_PROCESSED_MESSAGES} messages. Stopping.`);
        return;
    }
    try {


        const res = await gmail.users.messages.list({
            userId: 'me',
            pageToken: pageToken,
            maxResults: MAX_RESULTS,
        });

        if (!res.data.messages) {
            console.log('No messages found.');
            return;
        }

        console.log(`Fetched ${res.data.messages.length} messages. Processing...`);

        const messagePromises = res.data.messages.map(message =>
            getMessage(auth, message.id)
        );

        await Promise.all(messagePromises);

        const newCount = processedMessagesCount + res.data.messages.length;
        if (res.data.nextPageToken) {
            console.log('Fetching the next set of messages...');
            await listMessages(auth, res.data.nextPageToken, newCount);
        } else {
            console.log('No more messages to process.');
        }
    } catch (error) {
        console.error('Error fetching messages:', error);
    }
}

async function getMessage(auth, messageId) {
    const gmail = google.gmail({ version: 'v1', auth });
    try {
        const res = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
        });

        const payload = res.data.payload;

        if (payload.parts) {
            for (let part of payload.parts) {
                if (part.body && part.body.data) {
                    await processEmailPart(part.body.data, messageId, payload.headers);
                }
            }
        } else if (payload.body && payload.body.data) {
            await processEmailPart(payload.body.data, messageId, payload.headers);
        }
    } catch (error) {
        console.error(`Error fetching message ${messageId}:`, error);
    }
}

async function processEmailPart(bodyData, messageId, headers) {
    try {

        if (answer === '1') {
            await downloadInvoicesFromEmail(bodyData, messageId, headers);
        } else if (answer === '2') {
            await unsubFromEmail(bodyData, messageId, headers);
        } else {
            console.error('Invalid input. Please enter "invoices" or "unsubscribe".');
        }

    } catch (error) {
        console.error('Error processing email part:', error);
    }
}

async function downloadInvoicesFromEmail(bodyData, messageId, headers) {
    try {
        const emailBody = Buffer.from(bodyData, 'base64').toString('ascii').toLowerCase();
        const invoiceKeywords = ['invoice', 'rechnung', 'bill', 'statement'];
        const attachmentLinks = extractAttachmentLinks(emailBody, invoiceKeywords);

        const subjectHeader = headers.find(header => header.name === 'Subject');
        const fromHeader = headers.find(header => header.name === 'From');
        const subject = subjectHeader ? subjectHeader.value : 'No Subject';
        const from = fromHeader ? fromHeader.value : 'Unknown Sender';

        if (attachmentLinks.length > 0) {
            console.log(`Found ${attachmentLinks.length} attachment links in message ${messageId} (Subject: "${subject}", From: "${from}").`);
            await downloadAttachments(attachmentLinks);
        } else {
            // console.log(`No attachment links found in message ${messageId} (Subject: "${subject}", From: "${from}").`);
        }
    } catch (error) {
        console.error('Error processing email part:', error);
    }
}

function extractAttachmentLinks(emailBody, keywords) {
    const regex = /<a\s+[^>]*href="([^"]*?)"/ig;
    const matches = [...emailBody.matchAll(regex)];
    return matches
        .map(match => match[1].replace(/&amp;/g, '&'))
        .filter(link => keywords.some(keyword => link.toLowerCase().includes(keyword)));
}

async function downloadAttachments(links) {
    console.log("should download attachments", links);
    return;

    const downloadDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir);
    }

    for (let link of links) {
        try {
            const response = await fetch(link);
            const buffer = await response.buffer();
            const fileName = path.basename(new URL(link).pathname);
            const filePath = path.join(downloadDir, fileName);
            fs.writeFileSync(filePath, buffer);
            console.log(`Downloaded ${fileName} to ${filePath}`);
        } catch (error) {
            console.error(`Failed to download ${link}`, error);
        }
    }
}

// Aktualisiere die ursprüngliche `unsubFromEmail`-Funktion
async function unsubFromEmail(bodyData, messageId, headers) {
    try {
        const emailBody = Buffer.from(bodyData, 'base64').toString('ascii');
        const unsubscribeLinks = extractUnsubscribeLinks(emailBody);

        const subjectHeader = headers.find(header => header.name === 'Subject');
        const fromHeader = headers.find(header => header.name === 'From');
        const subject = subjectHeader ? subjectHeader.value : 'No Subject';
        const from = fromHeader ? fromHeader.value : 'Unknown Sender';

        if (unsubscribeLinks.length > 0) {
            console.log(`Found ${unsubscribeLinks.length} unsubscribe links in message ${messageId} (Subject: "${subject}", From: "${from}").`);
            await openLinksWithPuppeteer(unsubscribeLinks);
        } else {
            console.log(`No unsubscribe links found in message ${messageId} (Subject: "${subject}", From: "${from}").`);
        }
    } catch (error) {
        console.error('Error processing email part:', error);
    }
}

// async function unsubFromEmail(bodyData, messageId, headers) {
//     try {
//         const emailBody = Buffer.from(bodyData, 'base64').toString('ascii');
//         const unsubscribeLinks = extractUnsubscribeLinks(emailBody);

//         const subjectHeader = headers.find(header => header.name === 'Subject');
//         const fromHeader = headers.find(header => header.name === 'From');
//         const subject = subjectHeader ? subjectHeader.value : 'No Subject';
//         const from = fromHeader ? fromHeader.value : 'Unknown Sender';

//         if (unsubscribeLinks.length > 0) {
//             console.log(`Found ${unsubscribeLinks.length} unsubscribe links in message ${messageId} (Subject: "${subject}", From: "${from}").`);
//             await openLinksInChrome(unsubscribeLinks);
//         } else {
//             console.log(`No unsubscribe links found in message ${messageId} (Subject: "${subject}", From: "${from}").`);
//         }
//     } catch (error) {
//         throw new Error("Error processing email part: " + error);

//     }

// }

function extractUnsubscribeLinks(emailBody) {
    const regex = /<a\s+[^>]*href="([^"]*?(unsubscribe|abmelden|austragen|opt[-_\s]?out|manage\s+preferences|email\s+settings|newsletter\s+abbestellen|unsubscribe[-_\s]?here)[^"]*)"/ig;
    const matches = [...emailBody.matchAll(regex)];
    return matches.map(match => match[1].replace(/&amp;/g, '&'));
}

async function openLinksInChrome(links) {
    const browserName = process.platform === 'darwin' ? 'google chrome' : process.platform === 'linux' ? 'google-chrome' : 'chrome';

    for (let link of links) {
        try {
            await open(link, { app: { name: browserName } });
            console.log(`Opened ${link}`);
        } catch (error) {
            console.error(`Failed to open ${link}`, error);
        }
    }
}

const puppeteer = require('puppeteer');
const logFilePath = 'unsubscribe_log.json';


// Funktion zum Öffnen und Bearbeiten der Links mit Puppeteer
async function openLinksWithPuppeteer(links) {
    // Lade das Logfile und finde bereits bearbeitete Links
    const logData = fs.existsSync(logFilePath) ? JSON.parse(fs.readFileSync(logFilePath)) : [];
    const processedLinks = logData
        .filter(entry => entry.status === 'Unsubscribed')
        .map(entry => entry.link);

    const linksToProcess = links.filter(link => !processedLinks.includes(link));

    if (linksToProcess.length === 0) {
        console.log('No new links to process. All links have been processed.');
        return; // Beende die Funktion, wenn keine neuen Links zu verarbeiten sind
    }

    console.log(`Found ${linksToProcess.length} new links to process.`);

    const browser = await puppeteer.launch({
        headless: runHeadless,      // Verwende die Benutzerauswahl
        slowMo: runHeadless ? 0 : 100, // Verlangsamen, wenn sichtbar
        defaultViewport: null,
        args: runHeadless ? [] : ['--start-maximized'] // Maximiertes Fenster, wenn sichtbar
    });
    const newLogEntries = [];
    for (let link of linksToProcess) {
        try {
            const page = await browser.newPage();
            console.log(`Opening link: ${link}`);
            await page.goto(link, { waitUntil: 'networkidle2', timeout: 60000 });

            // Suche nach einem Abmelde-Button
            const unsubscribeButtonSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'a[href*="unsubscribe"]',
                'a[href*="abmelden"]',
                'a[href*="opt-out"]',
                'a[href*="preferences"]'
            ];

            let clicked = false;
            for (let selector of unsubscribeButtonSelectors) {
                if (await page.$(selector)) {
                    console.log(`Found and clicking unsubscribe button with selector: ${selector}`);
                    await page.click(selector);
                    clicked = true;

                    // Warte auf mögliche Aktionen
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    break;
                }
            }

            // Füge neuen Eintrag zur Logliste hinzu
            newLogEntries.push({ link, status: clicked ? 'Unsubscribed' : 'No action needed', timestamp: new Date() });
        } catch (error) {
            console.error(`Error processing link ${link}:`, error);
            newLogEntries.push({ link, status: 'Failed', timestamp: new Date(), error: error.message });
        }
    }

    // Speichere das aktualisierte Log
    // fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2));
    updateLog(newLogEntries)
    console.log('Log saved to:', logFilePath);

    await browser.close();
}
// Aktualisiere das Log mit neuen Einträgen
function updateLog(newEntries) {
    let existingLog = [];

    // Versuche, die bestehende Logdatei zu lesen
    if (fs.existsSync(logFilePath)) {
        try {
            const fileContent = fs.readFileSync(logFilePath, 'utf-8');
            existingLog = fileContent ? JSON.parse(fileContent) : [];
        } catch (error) {
            console.error('Error reading existing log file:', error);
            console.log('Initializing log as empty array.');
        }
    }

    // Vermeide doppelte Einträge (nach Link filtern)
    const uniqueLinks = new Set(existingLog.map(entry => entry.link));
    const filteredNewEntries = newEntries.filter(entry => !uniqueLinks.has(entry.link));

    // Füge die neuen Einträge hinzu
    const updatedLog = [...existingLog, ...filteredNewEntries];

    // Schreibe das aktualisierte Log in die Datei
    try {
        fs.writeFileSync(logFilePath, JSON.stringify(updatedLog, null, 2));
        console.log(`Log updated successfully. Added ${filteredNewEntries.length} new entries.`);
    } catch (error) {
        console.error('Error writing to log file:', error);
    }
}

// Starte den Prozess durch Laden der Module
loadModules();