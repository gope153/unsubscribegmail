# unsubscribegmail
Unsubscribe from all newsletters and stuff

this repo is just a quick hack to unsubscribe from all newsletters and stuff. It's not meant to be used by anyone else than me, but if you want to use it, feel free to do so.

## Usage

clone repo and do 'npm install' and 'npm start'. Then the following process will be automatic:


Visit the Google Cloud Console.
Create a new project.
Search for the "Gmail API" and activate it for your project.
Go to "Credentials" and create OAuth Client ID credentials. Select "Web Application" and make sure you specify the correct authorized redirect URIs (e.g., http://localhost:3000/oauth2callback if you are doing local development).
Download the configuration file for your credentials and save it in your project directory. it should be called credentials.json
start start server.js

on server.js you can now create your token. insert it in terminal and press enter. 
now rerun server.js and it gets 1000 emails of your gmail and opens all links "unsubscribe" in a new tab. you can then look through all of them if already is unsubbed or you still have to click something.

this was just written quickly. if someone needs this just write kuhn@360opg.de or open an issue. 

## start via electron

if you want to start the script via electron, you can do so by running 'npm start'. This will start the script in an electron window.