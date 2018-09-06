module.exports = function(RED) {
    "use strict";
    var settings = RED.settings;
    const Piot = require("piot");
    const PiotConstants = require("piot/lib/constants")
    const { getInt16, getInt32, setInt16, setString, setHexString } = require( './lib/bytes')
    let connections = {};

    function SetNodeStatus(node, connected) {
        if (connected) {
            node.status({fill:"green",shape:"dot",text:"node-red:common.status.connected"});
        }
        else {
            node.status({fill:"red",shape:"ring",text:"node-red:common.status.not-connected"});
        }
    }

    function PiotNetworkNode(n) {
        RED.nodes.createNode(this,n);
        this.networktype = n.networktype;
        this.serialport = n.serialport;
        this.port = parseInt(n.port);
        this.encrypted = n.encrypted;
        this.blockBroadcast = n.blockbroadcast;
        this.filter = parseInt(n.filter);

        if (isNaN(this.filter)) {
            this.filter = 0;
        }

        if (this.encrypted) {
            // fix encryption as ChaCha20 with Poly1305 and 6 byte nonce
            // this can be modified to allow configuration by user
            this.encryption = PiotConstants.CHACHA20_POLY1305_OPT1;
        }
        else {
            this.encryption = 0;
        }

        this.encryptionKey = new Uint8Array(32);
/*
        if (this.credentials) {
            setHexString (this.encryptionKey, 0, this.credentials.key);
        }
*/
        let node = this;
        node.log("creating network node");

        if (!connections[this.serialport]) {
            node.log("creating serial connection");

            connections[this.serialport] = new Piot(this.serialport);
            this.previousError = "";

            // only one error handler per connection
            connections[this.serialport].on('error', function(error) {
                if (error.toString() !== node.previousError) {
                    node.error(node.port + ":" + node.serialport + " " + error);
                    node.previousError = error.toString();
                }
            });
        }

        this.connection = connections[this.serialport];

        this.connection.on('data', function(data) {
            let address = getInt32(data, 0);
            let port = getInt16(data, 4);
            let pin = getInt16(data, 6);
            node.log("Received data, address " + address + " port " + port + " pin " + pin);
        });


        // open handler per network configuration
        this.connection.on('open', function() {
            node.log("opening sockets");
            node.connection.closeRadioSocket(node.port);
            node.connection.openRadioSocket(node.networktype, node.port, node.filter, node.blockBroadcast, node.encryption, node.encryptionKey);
        });

        this.on("close", function(done) {
            node.log("closing network node");
            node.connection.close(function() {
                node.log("deleting references");
                node.connection = null;
                connections[node.serialport] = null;
                done();
            });
        });
    }
    RED.nodes.registerType("piot-network",PiotNetworkNode, {
        credentials: {
            key: {type: "text"}
        }
    });


    function PiotOutNode(n) {
        RED.nodes.createNode(this,n);
        // use parseInt as address could be set as hex
        this.address = parseInt(n.address);
        this.pin = parseInt(n.pin);
        this.network = RED.nodes.getNode(n.network);

        if (this.network) {
            let node = this;
            let connection = node.network.connection;
            let port = node.network.port;

            SetNodeStatus(node, connection.isOpen());

            node.on("input",function(msg) {
                if (msg.hasOwnProperty("payload")) {

//                    node.log(typeof msg.payload);
//                    node.log(msg.payload.length);
//                    node.log(msg.payload instanceof Array);

                    // TODO: convert boolean to single byte 0 or 1, convert number to uint32
                    // TODO: for some reason an array passed through as msg.payload is giving false to msg.payload instanceof Array
//		    if ((msg.payload instanceof String || msg.payload instanceof Buffer || msg.payload instanceof Uint8Array || msg.payload instanceof Array)
		    if (typeof msg.payload.length != "undefined") {

                        node.log("send packet");
                        let payload = new Uint8Array(msg.payload.length + 2);
                        // set pin number
                        setInt16(payload, 0, this.pin);

		        if (msg.payload instanceof String) {
                            node.log("sending string");
                            setString(payload, 2, msg.payload.length, msg.payload);
                        }
                        else {
                            node.log("sending bytes");
                            for (let i=0; i<msg.payload.length; i++) {
                                payload[2 + i] = msg.payload[i];
                            }
                        }

                        // TODO: check for success or emit error if didn't send?
                        connection.sendRadioPacket(node.address, port, payload);
                    }
                    else {
                        node.error("Incorrect type in msg.payload MUST be String or Buffer or Array or Uint8Array");
                    }
                }
                else {
                    node.error("Message has no payload");
                }
            });
            connection.on('open', function() {
                SetNodeStatus(node, true);
            });
            connection.on('closed', function() {
                SetNodeStatus(node, false);
            });
        }
        else {
            this.error("PiOT network not configured correctly");
        }
    }
    RED.nodes.registerType("piot out",PiotOutNode);


    function PiotInNode(n) {
        RED.nodes.createNode(this,n);
        // use parseInt as address could be set as hex
        this.address = parseInt(n.address);
        this.pin = parseInt(n.pin);
        this.network = RED.nodes.getNode(n.network);

        if (this.network) {
            let node = this;
            let connection = node.network.connection;
            let port = node.network.port;

            SetNodeStatus(node, connection.isOpen());

            // we could look for correct port in PiotNetworkNode to reduce the
            // number of PiotInNode listeners called, but in practise this adds
            // event complications for not much of a performance gain when number
            // of nodes are in the 100's
            node.network.connection.on('data', function(data) {
                if (data.length >= 8) {
                    // first 4 bytes are address, next 2 bytes are port, next 2 are pin, remaining are data
                    let sentAddress = getInt32(data, 0);
                    let sentPort = getInt16(data, 4);
                    let sentPin = getInt16(data, 6);

                    if (sentAddress === node.address
                        && sentPort === port
                        && sentPin === node.pin) {
                        node.send({"payload": data.slice(8), port:node.network.serialport});
                    }
                }
                else {
                    node.error("Received data too short");
                }
            });
            connection.on('open', function() {
                SetNodeStatus(node, true);
            });
            connection.on('closed', function() {
                SetNodeStatus(node, false);
            });
        }
        else {
            this.error("PiOT network not configured correctly");
        }
    }
    RED.nodes.registerType("piot in",PiotInNode);


    RED.httpAdmin.get("/piotcontrollers", RED.auth.needsPermission('serial.read'), function(req,res) {
        Piot.list().then(function (controllers) {
            var ports = [];
            // get all unconnected controllers
            controllers.forEach(function(controller) {
                ports.push(controller.comName);
            });
            // add existing connections
            ports.push.apply(ports, Object.getOwnPropertyNames(connections));

            res.json(ports);
        });
    });
}
