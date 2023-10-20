const http = require('http');
const url = require('url');

// Erstellen Sie einen Server, der auf Anfragen wartet
const server = http.createServer((req, res) => {
  // Analysieren Sie die Anfrage-URL
  const queryObject = url.parse(req.url, true).query;

  // Überprüfen Sie, ob die Anfrage die "code" Abfrageparameter enthält
  if (queryObject.code) {
    console.log('Autorisierungscode:', queryObject.code);

    // Sie können hier den Code verwenden, um das Token zu erhalten
    // ...

    // Senden Sie eine Antwort an den Browser
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write('<h1>Danke!</h1><p>Sie können dieses Fenster jetzt schließen.</p>');
    res.end();
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write('<h1>Warten auf den Autorisierungscode...</h1>');
    res.end();
  }
});

// Starten Sie den Server und lassen Sie ihn auf Port 3000 lauschen
server.listen(3000, () => {
  console.log('Server läuft auf http://localhost:3000/');
});

