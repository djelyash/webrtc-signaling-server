//'use strict';
const config = require('config');
var log4js = require("log4js");


const log4jsConfig = {
    "appenders" : {
        "dynamodbV3" : {
            "type": "console", "layout": {
                "type": "pattern", "pattern": "%[%d{ISO8601_WITH_TZ_OFFSET} %p %c -%] %m", "tokens": {}
            }
        }
    },
    "categories": {"default": { "appenders": ["dynamodbV3"], "level": "info" }}
};

log4js.configure(log4jsConfig, {});
var logger = log4js.getLogger("dynamodbV3");

const tableName = config.aws.dynamodb.tableName;

const { DynamoDBClient, CreateTableCommand, PutItemCommand, GetItemCommand ,UpdateItemCommand, ScanCommand  } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");


const dbclient = new DynamoDBClient({ region: config.aws.sdk.region });


class DynamodbApiV3 {
    static instance;
    constructor() {}
    /*async createModel() {
        this.Connections = dynamoose.model(config.aws.dynamodb.tableName, {
            "id": {
                type: String,
                hashKey: true
            },
            "type": {
                type: String
            },
            "deviceId": {
                type: String,
            },
            "offer": String,
            "debugOffer": String,
            "offerResponse": String,
            "debugOfferResponse": String,
            "peerConnectionStatus": String,
            "keepalive": { type: Date},
            "offerGetTime": { type: Date},
            "status": String
        });
    }*/

    static getInstance() {
        logger.info("dynamodbv3 get instance.");
        if (!DynamodbApiV3.instance) {
            DynamodbApiV3.instance = new DynamodbApiV3();
            (async  () => {
                await DynamodbApiV3.instance.init();
            })();
        }
        return DynamodbApiV3.instance;
    }

    async init() {
        //await this.createModel();
        await this.createTable();
    }

    async addConnection(connectionId, offer, deviceId, keepalive, connectionStatus, type) {
        logger.info(keepalive);
        const connection = {"id" : connectionId, "offer": JSON.stringify(offer), "deviceId": deviceId, "keepalive": keepalive, "connectionStatus": connectionStatus, "type": type,
            debugOffer:"", debugOfferResponse:"", offerGetTime:0, peerConnectionStatus:"", offerResponse:""};

        const params = {
            TableName: tableName,
            Item: marshall(connection)
        };
        const item = marshall(connection);
        let res;
        try {
            res = await dbclient.send(new PutItemCommand(params));
        } catch (error) {
            logger.error(error);
            throw {errorCode: 503, error: "connection add failed " + error};
        }

        logger.info(res);
        logger.info("Save operation was successful.");
        return res;
    }

    async getConnection(connectionId) {
        const params = {
            TableName: tableName,
            Key: marshall({
                id: connectionId
            }),
        };
        try{
            const res =  await dbclient.send(new GetItemCommand(params));
            logger.info(res);
            return unmarshall(res.Item);
        } catch (error) {
            logger.error(error);
            throw {errorCode: 503, error: "trying to get connection that not exist " + error};
        }
    }

    async createTable() {

        // Set the parameters
        const params = {
            AttributeDefinitions: [
                {
                    AttributeName: "id",
                    AttributeType: "S"
                }
            ],
            KeySchema: [
                {
                    AttributeName: "id",
                    KeyType: "HASH"
                }
            ],
            TableName: tableName,
            BillingMode: "PAY_PER_REQUEST",
            StreamSpecification: {
                StreamEnabled: false,
            }
        };
        try{
            const res = await dbclient.send(new CreateTableCommand(params));
            logger.info(res);
            logger.info( "connection table created " );
        }
        catch (error) {
            if (error.name === "ResourceInUseException") {
                logger.info( "connection table creation: table already exist" );
                return;
            }

            logger.error( "connection table creation failed" );
            logger.error(error);
            throw {errorCode: 500, error: "create table failed on: " + error};
        }
    }

    async updateConnectionWithCondition(connectionId, update) {
        logger.info(update);
        logger.info(connectionId);

        let updateExpression= "set " + update.fieldName + " = :newVal"
        let conditionExpression = update.fieldName + " = :oldVal"

        let expressionAttributeValues = {":newVal" : update.val, ":oldVal": update.conditionVal};


        const params = {
            TableName: tableName,
            Key: marshall({
                id: connectionId,
            }),
            // Define expressions for the new or updated attributes
            UpdateExpression: updateExpression,
            // For example, "'set Title = :t, Subtitle = :s'"
            /*
            Convert the attribute JavaScript object you are updating to the required
            Amazon  DynamoDB record. The format of values specifies the datatype. The
            following list demonstrates different datatype formatting requirements:
            String: "String",
            NumAttribute: 1,
            BoolAttribute: true,
            ListAttribute: [1, "two", false],
            MapAttribute: { foo: "bar" },
            NullAttribute: null
             */
            ExpressionAttributeValues: marshall(expressionAttributeValues),
            ConditionExpression: conditionExpression,
            ReturnValues: "ALL_NEW"
        };

        try {

            const res = await dbclient.send(new UpdateItemCommand(params));
            return unmarshall(res.Attributes);

        } catch (err) {
            if(err.name === "ConditionalCheckFailedException") {
                throw err;
            } else{
                throw {errorCode: 500, error: "got mongo db error: " + err};
            }
        }


    }


    async updateConnection(connectionId, update) {
        logger.info(update);
        logger.info(connectionId);

        let expressionAttributeValues = {}, updateExpression= "set ";
        for (const [key, value] of Object.entries(update)) {
            expressionAttributeValues [":" + key] = value;
            updateExpression += key;
            updateExpression += " = :";
            updateExpression += key;
            updateExpression += ",";
        }

        const params = {
            TableName: tableName,
            Key: marshall({
                id: connectionId,
            }),
            // Define expressions for the new or updated attributes
            UpdateExpression: updateExpression.substr(0, updateExpression.length -1),
            // For example, "'set Title = :t, Subtitle = :s'"
            /*
            Convert the attribute JavaScript object you are updating to the required
            Amazon  DynamoDB record. The format of values specifies the datatype. The
            following list demonstrates different datatype formatting requirements:
            String: "String",
            NumAttribute: 1,
            BoolAttribute: true,
            ListAttribute: [1, "two", false],
            MapAttribute: { foo: "bar" },
            NullAttribute: null
             */
            ExpressionAttributeValues: marshall(expressionAttributeValues)
        };

        try {

            await dbclient.send(new UpdateItemCommand(params));

        } catch (err) {
            if(err.errorCode) {
                throw err;
            } else{
                throw {errorCode: 500, error: "queue receive message error: " + err};
            }
        }


    }

    async getConnectionIdByDeviceId(deviceId, startAt){
        let  res;

        // Set parameters
        const params = {
            KeyConditionExpression: "deviceId = :deviceId",
            ExpressionAttributeValues: {
                ":deviceId": { S: deviceId },
            },
            TableName: tableName
        };

        try {
            if(startAt) {
                params.ExclusiveStartKey = startAt;
            }

            res = await dbclient.send(new ScanCommand(params));

        } catch (err) {
            if(err.errorCode) {
                throw err;
            } else{
                throw {errorCode: 500, error: "error looking for connection with deviceId " + deviceId + ". " + err};
            }
        }
        if ((res || []).length === 0 && res.lastKey === undefined ) {
            throw {errorCode: 503, error: "did not find an existing connection with deviceId " + deviceId};
        } else if ((res || []).length === 0 && res.lastKey !== undefined ){
            return this.getConnectionIdByDeviceId(deviceId, res.lastKey);
        }

        return res[0].id;
    }


}

module.exports.getInstance = DynamodbApiV3.getInstance;
