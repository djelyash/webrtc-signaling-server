
const request = require('request');

//const serverUri = "http://rdkucs1.il.nds.com:57778/";
const serverUri = "http://localhost:9090/signaling/1.0/";

function getOfferResponse(connectionId) {
    request.get(serverUri + 'connections/'+ connectionId + '/' + 'answer', (err, res, body) => {
        if (res.statusCode !== 200 || err) {
            console.log(err + " " + res.body);
            setTimeout(getOfferResponse, 5000, connectionId);
        } else {
            console.log(JSON.stringify(body));
            //postCandidate(connectionId,  {});
        }


    });
}

function sendOffer(connectionId) {
    const sdp ="v=0\r\no=- 5164509177096042454 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:nFVD\r\na=ice-pwd:u7mXKFTowGoYLH4jZy7MuFWO\r\na=ice-options:trickle\r\na=fingerprint:sha-256 A3:68:64:31:C9:3D:08:86:2E:79:41:4C:C0:56:CB:F0:D3:1C:74:D8:08:30:1E:07:7D:AE:01:A8:A5:36:8A:9B\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\n";
    var offer = {type: "offer", sdp: sdp, deviceId: "TC123"};
    request.post(serverUri + 'application/connections?connectionId='+ connectionId, { json: true ,body:offer}, (err, res, body) => {
        if (err) { return console.log(err); }
        console.log(body.connectionId);
        setTimeout(getOfferResponse, 2000, body.connectionId);
    });
}

function getCandidate(connectionId) {
    request.get(serverUri + 'connections/'+ connectionId + '/' + 'ice', (err, res, body) => {
        if (res.statusCode !== 200 || err) {
            console.log(err);
            console.log("no candidate will try again soon");
            setTimeout(getCandidate, 1000, connectionId);
        } else {
            console.log("got new candidate will try again soon");
            console.log(JSON.stringify(body));
            setTimeout(getCandidate, 1000, connectionId);
        }
    });
}


function getOffer(connectionId) {
    console.log("requesting offer for connection id: " + connectionId)
    request.get(serverUri + 'connections/' + connectionId + '/' + 'offer', (err, res, body) => {
        if (res.statusCode !== 200 || err) {
            console.log(err);
            setTimeout(getOffer, 2000, connectionId);
        } else {
            console.log("Got an offer from signaling server");
            console.log(JSON.stringify(body));

            sendOfferResponse(connectionId);
        }

    });
}

function sendOfferResponse(connectionId) {
    const sdp ="v=0\r\no=- 5259690038522163586 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\nb=AS:30\r\na=ice-ufrag:sZ/d\r\na=ice-pwd:Dv79CJ5M1YutC8olkrbL1lMi\r\na=ice-options:trickle\r\na=fingerprint:sha-256 E8:0D:1B:4F:2B:DF:EB:55:A4:E7:8C:8B:9A:51:1A:FA:8A:5A:6C:71:46:22:67:66:42:F6:88:4A:82:A9:A2:E6\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n";
    var offer = {type: "answer", sdp: sdp};
    request.post(serverUri + 'connections/' + connectionId + '/' + 'answer', { json: true ,body:offer}, (err, res, body) => {
        if (err) { setTimeout(getConnection, 5000, connectionId);return console.log(err); }
        else {
            console.log("start polling for candidate");
            sendOffer(connectionId);
        }
        console.log(connectionId);
    });
}


function getConnection() {
    console.log("Looking for a connection to serve")
    request.get(serverUri + 'client/queue', (err, res, body) => {
        if (res.statusCode !== 200 || err) {setTimeout(getConnection, 10000); return console.log(body); }
        var response = JSON.parse(body)
        console.log("Got a connection id from the signaling server id: " + response.connectionId);
        setTimeout(getOffer, 5000, response.connectionId);
    });
}

getConnection();