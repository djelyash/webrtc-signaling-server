'use strict';

const config = require('config');
const FIFO = require('fifo');
const { nanoid } = require("nanoid");
const queue = require("./queue");
const storage = require("./storage");
const utils = require("./utils");


const log4js = require("log4js");


const log4jsConfig = {
    "appenders" : {
        "connectionManager" : {
            "type": "console", "layout": {
                "type": "pattern", "pattern": "%[%d{ISO8601_WITH_TZ_OFFSET} %p %c -%] %m", "tokens": {}
            }
        }
    },
    "categories": {"default": { "appenders": ["connectionManager"], "level": "info" }}
};

log4js.configure(log4jsConfig, {});
const logger = log4js.getLogger("connectionManager");

const connectionIdleTimeoutSec = config.connectionIdleTimeoutSec;
const processingTimout = config.offerProcessingTimeoutSec;
const connectionTypes = config.connectionTypes;

class ConnectionManager {
    static instance;
    constructor() {

    };
    static async getInstance() {
        logger.info("connection manager get instance.");
        if (!ConnectionManager.instance) {
            ConnectionManager.instance = new ConnectionManager();
            await ConnectionManager.instance.init();

        }
        return ConnectionManager.instance;
    }

    async init () {
        this.queue = await queue.getInstance();
        this.storage = await storage.getInstance();
    }

    async addConnection(connection, connectionType, clientConnectionId, reqLogger) {

        if(!connectionTypes.indexOf(connectionType) < 0 ) {
            throw {errorCode: 503, error: "Unsupported connection type in url path parameter"};
        }
        if(connectionType === "application" && !clientConnectionId) {
            throw {errorCode: 503, error: "Request for a new connection with type application needs to supply the client connection id"};
        }

        const now = new Date().getTime();
        const deviceId = connection.deviceId;


        const connectionId = connectionType === "client" ? deviceId + nanoid(10) : utils.createApplicationConnectionIdFromClientId(clientConnectionId);

        await this.storage.addConnection(connectionId, connection, deviceId, now, "created", connectionType, reqLogger);
        await this.queue.enqueue(connectionId, connectionType, reqLogger);


        return connectionId;
    };

    async yieldConnection(connectionId, reqLogger) {
        await this.storage.updateConnection(connectionId, {connectionStatus: "timeout"}, reqLogger);
    }

    dropConnection(connectionId) {
        this.connectionMap.delete(connectionId);
    }

    async getWaitingOffer(connectionType, reqLogger) {
        const connectionId = await this.queue.dequeue(connectionType, reqLogger);
        let connection;
        try{
            connection = await this.storage.updateConnectionWithCondition(connectionId, {fieldName:"connectionStatus",val: "allocated", conditionVal: "created"}, reqLogger);
        }
        catch (error) {
            if(err.name === "ConditionalCheckFailedException") {
                throw {errorCode: 503, error: "got offer from queue but status was not as expected, try again"}
            } else {
                throw err;
            }
        }

        const now = new Date().getTime();

        if (connection.keepalive + connectionIdleTimeoutSec*1000 < now ){
            throw {errorCode: 503, error: "got offer from queue but client not poll for it for a while, try again"}
        }

        return connectionId;
    };

    async getOffer(connectionId, reqLogger) {
        const now = new Date().getTime();
        let connection;
        try {
            connection = await this.storage.updateConnection(connectionId, {"peerProcessingStartTime": now}, reqLogger);
        } catch (error) {
            throw  error;
        }
        const offer = connection && connection.offer && JSON.parse(connection.offer);
        if(offer) {
            return {offer: offer, connectionType: connection.type};
        } else {
            throw {errorCode: 500, error: "missing offer on connection:  " + connectionId};
        }
    }


    async saveOfferResponse(connectionId, offerResponse, reqLogger) {
        const connection = await this.storage.getConnection(connectionId, reqLogger);
        const now = new Date().getTime();
        if(connection) {
            if (connection.peerProcessingStartTime + processingTimout*1000 >= now) {
                await this.storage.updateConnection(connectionId, {offerResponse: JSON.stringify(offerResponse), connectionStatus: "offerResponse"}, reqLogger);
            }
            else {
                throw {errorCode: 500, error: "offer processing time expire"};
            }

        }
        return connection;
    };

    addCandidate(connectionId, ice) {
        const connection = this.connectionMap.get(connectionId);
        if(connection) {
            const now = new Date().getTime();
            connection.keepalive = now;
            connection.ice.push(({state:"new", content: ice}));
            this.connectionMap.set(connectionId, connection);
            return true;
        }
        return false;
    };

    async setKeepalive(connectionId, time, reqLogger) {

        await this.storage.updateConnection(connectionId, {"keepalive": time}, reqLogger);
    }

    getCandidate(connectionId) {
        const connection = this.connectionMap.get(connectionId);
        if(connection) {
           const candidate = connection.ice.find( (candidate) => {return candidate.state === "new" });
           if (candidate) {
               candidate.state = "retrieve";
               return  candidate.content;
           }
        }

        return false;
    };

    async stopConnection(connectionId, reqLogger) {
        await this.storage.updateConnection(connectionId, {"connectionStatus": "ended"}, reqLogger);
    }

    async getOfferResponse(connectionId, reqLogger) {
        const connection = await this.storage.getConnection(connectionId, reqLogger);
        const offerResponse =  connection && connection.offerResponse && JSON.parse(connection.offerResponse);
        if(!offerResponse) {
            throw {errorCode: 404, message: "offer response not yet arrived keep polling"};
        }
        const now = new Date().getTime();
        setImmediate(async ()=>{
            try {
                await this.setKeepalive( connectionId, now, reqLogger);
            } catch (error) {
                reqLogger.error ( "Failed to set connection keep alive for connection: " + connectionId + " error: " + utils.stringifyError(error));
            }
        });
        if(connection.type === "application") {
            const clientConnectionId = utils.getClientConnectionIdFromApplicationId(connectionId);
            await this.storage.updateConnection(clientConnectionId, {"peerConnectionStatus": "connected"}, reqLogger);
        } else if (connection.type === "client") {
            if(connection.peerConnectionStatus !== "connected") {
                reqLogger.info("Connection %s all steps completed, but it need to wait to his peer application connection to establish, before starting clint connection", connectionId);
                throw {errorCode: 404, message: "Connection Not yet fully established keep polling"};
            }
        }

        return {offerResponse: offerResponse, connectionType: connection.type};
    };

    /***   debug offers    ***/

    async getConnectionIdByDeviceId(deviceId){
        return await this.storage.getConnectionIdByDeviceId(deviceId);
    }

    async putDebugOffer(connectionId, debugOffer, reqLogger){
        await this.storage.updateConnection(connectionId, {"debugOffer": JSON.stringify(debugOffer)}, reqLogger);
        return connectionId;
    }

    async getDebugOffer(connectionId, reqLogger) {
        const connection = await this.storage.getConnection(connectionId, reqLogger);
        const debugOffer = connection && connection.debugOffer && JSON.parse(connection.debugOffer);
        if(!debugOffer){
            throw {errorCode: 404, error: "no connections available to serve right now try again later"};
        }
        return debugOffer;
    }

    async putDebugOfferAnswer(connectionId, offerResponse, reqLogger) {
        const connection = await this.storage.getConnection(connectionId, reqLogger);
        if(connection) {
            await this.storage.updateConnection(connectionId, {debugOfferResponse: JSON.stringify(offerResponse)}, reqLogger);
        }
    };

    async getDebugOfferResponse(connectionId) {
        const connection = await this.storage.getConnection(connectionId, reqLogger);
        const debugOfferResponse =  connection && connection.debugOfferResponse && JSON.parse(connection.debugOfferResponse);
        if(!debugOfferResponse) {
            throw {errorCode: 404, message: "debug offer response not yet arrived keep polling"};
        }
        else{
            return debugOfferResponse;
        }
    }

    async deleteDebugOffer(connectionId){
        await this.storage.updateConnection(connectionId, {"debugOffer": "", "debugOfferResponse": ""}, reqLogger);
    }

}

module.exports.getInstance = ConnectionManager.getInstance;
