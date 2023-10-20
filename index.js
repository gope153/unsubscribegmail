const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
// Verwenden Sie import(), um das open-Modul dynamisch zu importieren
let open;
import('open').then(module => {
    open = module.default;
}).catch(err => {
    console.error('Failed to import the open module', err);
});

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

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
    console.log('Authorize this app by visiting this url:', authUrl);
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
async function listMessages(auth, pageToken, processedMessagesCount = 0) {
    const gmail = google.gmail({ version: 'v1', auth });
    const maxResults = 100; // Maximum results per request allowed by Gmail API

    // Stop if we have already processed 1000 messages
    if (processedMessagesCount >= 1000) {
        console.log('Processed 1000 messages. Stopping.');
        return;
    }

    // Fetch the next set of messages
    const res = await gmail.users.messages.list({
        userId: 'me',
        pageToken: pageToken,
        maxResults: maxResults, // Fetch maximum messages per request
    });

    if (!res.data.messages) {
        console.log('No messages found.');
        return;
    }

    console.log(`Fetched ${res.data.messages.length} messages. Processing...`);

    // Process each message
    for (const message of res.data.messages) {
        await getMessage(auth, message.id); // Assuming getMessage is an async function
        processedMessagesCount++; // Update the count of processed messages

        // Stop if we have processed 1000 messages
        if (processedMessagesCount >= 1000) {
            console.log('Processed 1000 messages. Stopping.');
            return;
        }
    }

    // If there are more messages, fetch the next set
    if (res.data.nextPageToken) {
        console.log('Fetching the next set of messages...');
        await listMessages(auth, res.data.nextPageToken, processedMessagesCount);
    } else {
        console.log('No more messages to process.');
    }
}
function extractUnsubscribeLinks(emailBody) {
    // Regex, der "unsubscribe", "abmelden", und "austragen" in der URL berücksichtigt
    const regex = /<a href="(http[^"]*?(unsubscribe|abmelden|austragen)[^"]*)"/ig;
    const matches = [...emailBody.matchAll(regex)];
    return matches.map(match => match[1]);
}


async function openLinksInChrome(links) {
    // Verwenden Sie 'google chrome' auf macOS, 'google-chrome' auf Linux und 'chrome' auf Windows.
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

// Ändern Sie Ihre getMessage Funktion, um die Links zu sammeln und dann zu öffnen
function getMessage(auth, messageId) {
    const gmail = google.gmail({ version: 'v1', auth });
    gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
    }, (err, res) => {
        if (err) return console.log('The API returned an error: ' + err);
        const payload = res.data.payload;

        if (payload.parts) {
            payload.parts.forEach(async part => { // Machen Sie diese Funktion asynchron
                if (part.body && part.body.data) {
                    const emailBody = Buffer.from(part.body.data, 'base64').toString('ascii');
                    const unsubscribeLinks = extractUnsubscribeLinks(emailBody);
                    if (unsubscribeLinks.length > 0) {
                        console.log(`Found ${unsubscribeLinks.length} unsubscribe links in message ${messageId}.`);
                        await openLinksInChrome(unsubscribeLinks); // Öffnen Sie die Links
                    }
                }
            });
        } else if (payload.body && payload.body.data) {
            const emailBody = Buffer.from(payload.body.data, 'base64').toString('ascii');
            const unsubscribeLinks = extractUnsubscribeLinks(emailBody);
            if (unsubscribeLinks.length > 0) {
                console.log(`Found ${unsubscribeLinks.length} unsubscribe links in message ${messageId}.`);
                openLinksInChrome(unsubscribeLinks); // Öffnen Sie die Links
            }
        }
    });
}


function main() {
    fs.readFile(CREDENTIALS_PATH, (err, content) => {
        if (err) return console.log('Error loading client secret file:', err);
        authorize(JSON.parse(content), (auth) => {
            listMessages(auth, null); // Starten Sie mit der ersten Seite von Nachrichten
        });
    });
}

main();
