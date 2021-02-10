'use strict';

const express = require('express');
const router = express.Router();
const bodyParser = require("body-parser");
const config = require('config');
const cors = require('cors');
const app = express();
var log4js = require("log4js");
const logging = require('logging-utils')(config.logging);
const logger = logging.mainLogger;
const { nanoid } = require("nanoid");
const prometheus = require('prometheus-utils')(config.metrics);
prometheus.setMetric('openConnections', config.metrics.openConnections.type, config.metrics.openConnections.options);


const log4jsConfig = {
    "appenders" : {
        "server" : {
        "type": "console", "layout": {
            "type": "pattern", "pattern": "%[%d{ISO8601_WITH_TZ_OFFSET} %p %c -%] %m", "tokens": {}
         }
        },
    },
    "categories": {"default": { "appenders": ["server"], "level": "info" }}
};

log4js.configure(log4jsConfig, {});
//var logger = log4js.getLogger("server");
var connectionManager;
(
    async () => {
        connectionManager = await require("./lib/connectionManager").getInstance();
})().then( () => {
    logger.info("starting server");

    const port = config.server.port;

    app.listen(port, () => {
        logger.info("Started on PORT " + port);
    });
    app.use(sigPath, router);
}).catch((error) => {logger.error("Server init Error --- exit"); process.exit(1);});



var jsonParser = bodyParser.json();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ type: 'application/*+json' }));
app.use(cors());


app.use((req, res, next) => {
    const FCID = req.headers.flow_context || nanoid();
    res.set({ 'Access-Control-Allow-Origin': '*', FCID });
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    req.logger = logger.child({ FCID, url: decodeURIComponent(req.url), port: req.socket.localPort, clientIp });
    req.FCID = FCID;
    logger.info(`${req.FCID} ${req.method} ${req.originalUrl} [REQ]`);

    res.on('finish', () => {
        logger.info(`${req.FCID} ${req.method} ${req.originalUrl} ${res.statusCode} ${res.statusMessage} [RES]`);
    });

    next()
});

app.get('/manage/alive',  function(req, res) {
    res.status(200).json({"status":"ok"});
});

app.get('/manage/health',  function(req, res) {
    res.status(200).json({"status":"ok"});
});

app.get('/manage/metrics', (req, res) => {
    const metrics = prometheus.client.register.metrics();
    res.setHeader('Content-Type', 'text/plain');
    res.status(200);
    res.send(metrics);
});

const apiVersion = '1.0';
const sigPath = '/signaling/' + apiVersion;

//
//   Handle offer
//
router.post('/:connectionType/connections', jsonParser, async function(req, res) {
    const connectionType = req.params.connectionType;
    const appConnectionId = req.query.connectionId;
    let status = "success";

    try {
        const connectionId = await connectionManager.addConnection(req.body, connectionType, appConnectionId);
        logger.info("Connection %s created", connectionId);
        res.status(201).json({connectionId:connectionId});
    } catch (error){
        res.status(error.errorCode? error.errorCode : 503).json(error);
        if(error.errorCode >= 500) {
            logger.error(req.FCID + " : " + JSON.stringify(error));
            status = "failure"
        }
    }

    try {
        prometheus.openConnections.inc({ connectionType: connectionType, status: status});
    }
    catch (error) {}
});


//
//   Handle client polling for offer response
//
router.get('/connections/:connectionId/answer', async function(req, res) {
    const connectionId = req.params.connectionId;

    try{
        const offerResp = await connectionManager.getOfferResponse(connectionId);
        logger.info("Connection %s answer has given, signaling part completed!", connectionId);
        res.status(200).json(offerResp);
    } catch (error) {
        res.status(error.errorCode? error.errorCode : 503).json(error);
        if(error.errorCode >= 500) {
            logger.error(req.FCID + " : " + JSON.stringify(error));
        }
    }
});

router.post('/connections/:connectionId/answer', jsonParser, async function(req, res) {
    const connectionId = req.params.connectionId;
    const offerResp = req.body;
    try{
        await connectionManager.saveOfferResponse(connectionId, offerResp);
        logger.info("Connection %s got answer from peer ", connectionId);
        res.status(201).json(offerResp);
    } catch (error) {
        res.status(error.errorCode? error.errorCode : 503).json(error);
        if(error.errorCode >= 500) {
            logger.error(req.FCID + " : " + JSON.stringify(error));
        }
    }
});

router.get('/connections/:connectionId/offer', async function(req, res) {
    const connectionId = req.params.connectionId;
    try{
        const offer = await connectionManager.getOffer(connectionId);
        logger.info("Connection %s TC started webrtc connections establishment", connectionId);
        res.status(200).json(offer);

    } catch (error) {
        res.status(error.errorCode? error.errorCode : 503).json(error);
        if(error.errorCode >= 500) {
            logger.error(req.FCID + " : " + JSON.stringify(error));
        }
    }
});

//
//   Handle trans container trquest to get unserved offer
//
router.get('/:connectionType/queue', async function(req, res) {
    const connectionType = req.params.connectionType;

    try{
        const connectionId = await connectionManager.getWaitingOffer(connectionType);
        logger.info("Connection %s allocated to TC", connectionId);
        res.status(200).json({connectionId:connectionId});
    } catch (error) {
        res.status(error.errorCode? error.errorCode : 503).json(error);
        if(error.errorCode >= 500) {
            logger.error(req.FCID + " : " + JSON.stringify(error));
        }

    }

});

router.post('/connections/:connectionId/stop', jsonParser, async function(req, res) {
    const connectionId = req.params.connectionId;

    try{
        const offerResp = await connectionManager.stopConnection(connectionId);
        logger.info("Connection %s ended!", connectionId);
        res.status(200).json(offerResp);
    } catch (error) {
        res.status(error.errorCode? error.errorCode : 503).json(error);
        if(error.errorCode >= 500) {
            logger.error(req.FCID + " : " + JSON.stringify(error));
        }
    }
});


/*
router.post('/connections/:connectionId/ice', jsonParser, function(req, res) {
    logger.info( "post ice request Received .. " );

    const connectionId = req.params.connectionId;
    const ice = req.body;

    if(!connectionManager.addCandidate(connectionId, ice)) {
        res.status(404).json({err:"offer not exist"});
    } else {
        res.sendStatus(201);
    }
});


router.get('/connections/:connectionId/ice', function(req, res) {
    logger.info( "get ice request Received .. " )

    const connectionId = req.params.connectionId;
    const candidate = connectionManager.getCandidate(connectionId);

    if(!candidate) {
        res.status(404).json({err:"offer not exist"});
    } else {
        res.status(200).json(candidate);
    }
});

*/

/*  Handle debug offers and answers */

// 1. debug client gets connectionId by deviceId
router.get('/connections', async function(req, res) {
    let deviceId = req.query.deviceId;
    try{
        let connectionId = await connectionManager.getConnectionIdByDeviceId(deviceId);
        res.status(200).json({connectionId: connectionId});
    }
    catch (error) {
        res.status(error.errorCode? error.errorCode : 503).json(error);
    }
});

// 2. debug clients puts it's offer
router.put('/connections/:connectionId/debug-offer', jsonParser, async function(req, res) {
    const appConnectionId = req.params.connectionId;

    try {
        await connectionManager.putDebugOffer(appConnectionId, req.body);
        res.status(201).send();
    } catch (error){
        res.status(error.errorCode? error.errorCode : 500).json(error);
    }
});

// 3. tc gets debug offer
router.get('/connections/:connectionId/debug-offer', async function(req, res) {
    const connectionId = req.params.connectionId;
    try{
        const offer = await connectionManager.getDebugOffer(connectionId);
        res.status(200).json(offer);
    } catch (error) {
        res.status(error.errorCode? error.errorCode : 503).json(error);
    }
});

// 4. tc puts it's answer
router.put('/connections/:connectionId/debug-answer', jsonParser, async function(req, res) {
    const appConnectionId = req.params.connectionId;

    try {
        await connectionManager.putDebugOfferAnswer(appConnectionId, req.body);
        res.status(201).send();
    } catch (error){
        res.status(error.errorCode? error.errorCode : 503).json(error);
    }
});

// 5. debug client gets tc answer
router.get('/connections/:connectionId/debug-answer', async function(req, res) {
    const connectionId = req.params.connectionId;

    try{
        const offerResp = await connectionManager.getDebugOfferResponse(connectionId);
        res.status(200).json(offerResp);
    } catch (error) {
        res.status(error.errorCode? error.errorCode : 503).json(error);
    }
});

// 6. when debug client disconnects tc deletes the offer to allow a new debug connection
router.delete('/connections/:connectionId/debug-offer', jsonParser, async function(req, res) {
    const appConnectionId = req.params.connectionId;

    try {
        await connectionManager.deleteDebugOffer(appConnectionId);
        res.status(200).send();
    } catch (error){
        res.status(error.errorCode? error.errorCode : 503).json(error);
    }
});



