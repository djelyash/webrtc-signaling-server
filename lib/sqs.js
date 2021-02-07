const config = require('config');

const log4js = require("log4js");


const log4jsConfig = {
    "appenders" : {
        "sqs" : {
            "type": "console", "layout": {
                "type": "pattern", "pattern": "%[%d{ISO8601_WITH_TZ_OFFSET} %p %c -%] %m", "tokens": {}
            }
        }
    },
    "categories": {"default": { "appenders": ["sqs"], "level": "info" }}
};

log4js.configure(log4jsConfig, {});
const logger = log4js.getLogger("sqs");

const { SQSClient,  CreateQueueCommand, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand} = require("@aws-sdk/client-sqs");




class SqsApi {
    static instance;
    constructor() {
    }
    static async getInstance() {
        logger.info("SqsApi get instance.");
        if (!SqsApi.instance) {
            SqsApi.instance = new SqsApi();
            await SqsApi.instance.init();
        }
        return SqsApi.instance;
    }


    async init () {
        this.queueUrls = {};
        const params = {
            Attributes: {
                MessageRetentionPeriod: 60, VisibilityTimeout: 300, ReceiveMessageWaitTimeSeconds: 20
            }
        };
        try {
            // Create SQS service object
            this.sqs = new SQSClient({"region": config.aws.sdk.region});
            var queue;
            for( queue of config.aws.sqs.queues) {
                try {
                    params.QueueName = queue.name;

                    if(queue.type === "client" && process.env["CLIENT_QUEUE_NAME"] !== undefined){
                        params.QueueName = process.env.CLIENT_QUEUE_NAME;
                    }

                    if(queue.type === "application" && process.env["APPLICATION_QUEUE_NAME"] !== undefined){
                        params.QueueName = process.env.APPLICATION_QUEUE_NAME;
                    }

                    logger.info("Trying to create/Connect queue " + params.QueueName);
                    const data = await this.sqs.send(new CreateQueueCommand(params));
                    logger.info("Got. Queue URL: " + data.QueueUrl);
                    this.queueUrls[queue.type] = data.QueueUrl;

                } catch (error) {
                    logger.error("Error", error);
                    throw {errorCode :503, error: "aws sdk crete queue error: " + error};
                }

            }
        } catch (error) {
            logger.error("Error", error);
            throw {errorCode :503, error: "aws sdk int error: " + error};
        }


    }

    async enqueue(connectionId, connectionType) {
        if(!this.queueUrls[connectionType]){
            throw {errorCode: 503, error : "Wrong connection Type" + connectionType};
        }
        const params = {
            QueueUrl: this.queueUrls[connectionType],
            MessageBody: connectionId
        }
        try {
            const data = await this.sqs.send(new SendMessageCommand(params));
            logger.info("Success, message sent. MessageID:", data.MessageId);
            return true;
        } catch (err) {
            logger.info("Error", err);
            throw {errorCode:500, error: "queue send message failed queue error: " + err};
        }
    }

    async dequeue(connectionType) {
        if(!this.queueUrls[connectionType]){
            throw {errorCode: 503, error : "Wrong connection Type" + connectionType};
        }
        const receiveParam = {
            AttributeNames: ["SentTimestamp"],
            MaxNumberOfMessages: 1,
            MessageAttributeNames: ["All"],
            QueueUrl: this.queueUrls[connectionType]
        };
        try {
            const data = await this.sqs.send(new ReceiveMessageCommand(receiveParam));
            if (data.Messages) {
                var deleteParams = {
                    QueueUrl: this.queueUrls[connectionType],
                    ReceiptHandle: data.Messages[0].ReceiptHandle,
                };
                try {
                    const data = await this.sqs.send(new DeleteMessageCommand(deleteParams));
                    logger.info("Message Deleted", data);
                } catch (err) {
                    logger.info("Message not Deleted", data);
                    logger.error(err);
                }
                return data.Messages[0].Body;
            } else {
                logger.info("No messages");
                throw {errorCode: 404, error: "no connections available to serve right now try again later"};
            }

        } catch (err) {
            logger.info("Receive Error", err);
            if(err.errorCode) {
                throw err;
            } else{
                throw {errorCode: 500, error: "queue receive message error: " + err};
            }

        }
    }
}

module.exports.getInstance = SqsApi.getInstance;
