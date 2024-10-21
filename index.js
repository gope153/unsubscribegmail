const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const path = require('path');

let open;
let pLimit;

async function loadModules() {
    try {
        const openModule = await import('open');
        open = openModule.default;
    } catch (err) {
        console.error('Failed to import the open module', err);
    }

    try {
        const pLimitModule = await import('p-limit');
        pLimit = pLimitModule.default;
    } catch (err) {
        console.error('Failed to import the p-limit module', err);
    }

    if (open && pLimit) {
        main();
    } else {
        console.error('Required modules could not be loaded. Exiting.');
    }
}

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';
const MESSAGE_PROCESS_LIMIT = 5;
const MAX_PROCESSED_MESSAGES = 1000;
const MAX_RESULTS = 100;
const LOG_FILE_PATH = 'processed_emails.log';

function authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this URL:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

async function listMessages(auth, pageToken = null, processedMessagesCount = 0) {
    const limit = pLimit(MESSAGE_PROCESS_LIMIT);
    const gmail = google.gmail({ version: 'v1', auth });

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
            limit(() => processMessage(auth, message.id))
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
        console.log('Retrying after a short delay...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        await listMessages(auth, pageToken, processedMessagesCount);
    }
}

async function processMessage(auth, messageId) {
    const logExists = fs.existsSync(LOG_FILE_PATH);
    if (logExists) {
        const logContent = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
        if (logContent.includes(messageId)) {
            console.log(`Message ${messageId} already processed. Skipping.`);
            return;
        }
    }

    await getMessage(auth, messageId);

    fs.appendFileSync(LOG_FILE_PATH, `${messageId}\n`);
}

function extractUnsubscribeLinks(emailBody) {
    const regex = /<a\s+[^>]*href="([^"]*?(unsubscribe|abmelden|austragen|opt[-_\s]?out|preferences|manage\s+preferences|email\s+settings|newsletter\s+abbestellen|unsubscribe[-_\s]?here)[^"]*)"/ig;
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

async function getMessage(auth, messageId) {
    const gmail = google.gmail({ version: 'v1', auth });
    try {
        const res = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full'
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

function main() {
    fs.readFile(CREDENTIALS_PATH, (err, content) => {
        if (err) {
            console.log('Error loading client secret file:', err);
            return;
        }
        authorize(JSON.parse(content), (auth) => {
            listMessages(auth);
        });
    });
}

// Lade die Module und starte das Hauptprogramm
loadModules();