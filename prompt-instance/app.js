var fs = require('fs')
var express = require('express');
var https = require('https');
var os = require('os');
var pty = require('node-pty');
var expressWs = require('express-ws')

var options = {
  key: fs.readFileSync('/cert/private.pem'),
  cert: fs.readFileSync('/cert/public.pem'),
};

var app = express();

var server = https.createServer(options, app);
var expressWsInstance = expressWs(app, server);

var terminals = {},
    logs = {};

var instanceToken = process.env.INSTANCE_TOKEN;

app.use('/build', express.static(__dirname + '/../build'));

var requiresValidToken = function (req, res, next) {
  if (req.query.token == instanceToken) {
    next();
  } else {
    res.sendStatus(401);
  }
};

app.get('/', requiresValidToken, function(req, res){
  res.sendFile(__dirname + '/index.html');
});

app.get('/favicon.ico', function(req, res){
  res.sendFile(__dirname + '/favicon.ico');
});

app.get('/style.css', function(req, res){
  res.sendFile(__dirname + '/style.css');
});

app.get('/main.js', requiresValidToken, function(req, res){
  res.sendFile(__dirname + '/main.js');
});

app.post('/terminals', requiresValidToken, function (req, res) {
  var cols = parseInt(req.query.cols),
      rows = parseInt(req.query.rows),
      term = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : 'bash', [], {
        name: 'xterm-color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: process.env.PWD,
        env: process.env
      });

  console.log('Created terminal with PID: ' + term.pid);
  terminals[term.pid] = term;
  logs[term.pid] = '';
  term.on('data', function(data) {
    logs[term.pid] += data;
  });
  res.send(term.pid.toString());
  res.end();
});

app.post('/terminals/:pid/size', requiresValidToken, function (req, res) {
  var pid = parseInt(req.params.pid),
      cols = parseInt(req.query.cols),
      rows = parseInt(req.query.rows),
      term = terminals[pid];

  term.resize(cols, rows);
  console.log('Resized terminal ' + pid + ' to ' + cols + ' cols and ' + rows + ' rows.');
  res.end();
});

app.ws('/terminals/:pid', function (ws, req) {
  if (req.query.token == instanceToken) {
    var term = terminals[parseInt(req.params.pid)];
    console.log('Connected to terminal ' + term.pid);
    ws.send(logs[term.pid]);
  
    term.on('data', function(data) {
      try {
        ws.send(data);
      } catch (ex) {
        // The WebSocket is not open, ignore
      }
    });
    ws.on('message', function(msg) {
      term.write(msg);
    });
    ws.on('close', function () {
      term.kill();
      console.log('Closed terminal ' + term.pid);
      // Clean things up
      delete terminals[term.pid];
      delete logs[term.pid];
    });
  } else {
    ws.close();
  }
  
});

var port = process.env.PORT || 3000,
    host = os.platform() === 'win32' ? '127.0.0.1' : '0.0.0.0';

server.listen(port, function(){
  console.log("Express server listening on port " + port);
});
