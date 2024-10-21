const fs = require('fs');
const { google } = require('googleapis');
const express = require('express');
const path = require('path');

let open;

// Dynamische Importe für ES-Module
async function loadModules() {
    try {
        const openModule = await import('open');
        open = openModule.default;
    } catch (err) {
        console.error('Failed to import the open module', err);
    }

    if (open) {
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

function exchangeCodeForToken(code) {
    oAuth2Client.getToken(code, (err, token) => {
        if (err) {
            console.error('Error retrieving access token', err);
            return;
        }
        oAuth2Client.setCredentials(token);
        fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
            if (err) {
                console.error('Error storing the token', err);
            } else {
                console.log('Token stored to', TOKEN_PATH);
                console.log('Authorization complete. You can now access your Gmail data.');
                listMessages(oAuth2Client);
                console.log("Finished processing messages.");

            }
        });
    });
}

async function listMessages(auth, pageToken = null, processedMessagesCount = 0) {
    console.log("Processing messages...");

    const gmail = google.gmail({ version: 'v1', auth });
    const MAX_PROCESSED_MESSAGES = 100;
    const MAX_RESULTS = 100;

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
    const emailBody = Buffer.from(bodyData, 'base64').toString('ascii');
    const unsubscribeLinks = extractUnsubscribeLinks(emailBody);

    const subjectHeader = headers.find(header => header.name === 'Subject');
    const fromHeader = headers.find(header => header.name === 'From');
    const subject = subjectHeader ? subjectHeader.value : 'No Subject';
    const from = fromHeader ? fromHeader.value : 'Unknown Sender';

    if (unsubscribeLinks.length > 0) {
        console.log(`Found ${unsubscribeLinks.length} unsubscribe links in message ${messageId} (Subject: "${subject}", From: "${from}").`);
        await openLinksInChrome(unsubscribeLinks);
    } else {
        console.log(`No unsubscribe links found in message ${messageId} (Subject: "${subject}", From: "${from}").`);
    }
}

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

// Starte den Prozess durch Laden der Module
loadModules();