module.exports = function(RED) {
    "use strict";
    var settings = RED.settings;
    const Piot = require("piot");
    const PiotConstants = require("piot/constants")
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

        if (encrypted) {
            // fix encryption as ChaCha20 with Poly1305 and 6 byte nonce
            // this can be modified to allow configuration by user
            this.encryption = PiotConstants.CHACHA20_POLY1305_OPT1;
        }
        else {
            this.encryption = 0;
        }

        this.encryptionKey = new Uint8Array(32);
        if (this.credentials) {
            setHexString (this.encryptionKey, 0, this.credentials.key);
        }

        let node = this;
        node.error("creating network node");

        if (!connections[this.serialport]) {
            node.error("creating connection");

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

        // open handler per network configuration
        this.connection.on('open', function() {
            node.error("opening sockets");
            node.connection.closeRadioSocket(node.port);
            node.connection.openRadioSocket(node.networktype, node.port, node.filter, node.blockBroadcast, node.encryption, node.encryptionKey);
        });

        this.on("close", function(done) {
            node.error("closing network node");
            node.connection.close(function() {
                node.error("deleting references");
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
                    node.error("send packet");

                    let payload = new Uint8Array(msg.payload.length + 2);
                    // set pin number
                    setInt16(payload, 0, this.pin);

                    if (msg.payload instanceof String) {
                        node.error("sending string");
                        setString(payload, 2, msg.payload.length, msg.payload);
                    }
                    else if (msg.payload instanceof Buffer || msg.payload instanceof Uint8Array) {
                        node.error("sending bytes");
                        for (let i=0; i<msg.payload.length; i++) {
                            payload[2 + i] = msg.payload[i];
                        }
                    }
                    
                    // TODO: check for success or emit error if didn't send?
                    connection.sendRadioPacket(node.address, port, payload);
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
        this.pin = parsesInt(n.pin);
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
                node.error("data event");
                // first 4 bytes are address, next 2 bytes are port, next 2 are pin, remaining are data
                if (getInt32(data, 0) === node.address 
                    && getInt16(data, 4) === port
                    && getInt16(data, 6) === node.pin) {
                    node.send({"payload": data.slice(8), port:node.network.serialport});
                }
                else {
                    node.error("address didn't match " + node.address + " " + getInt32(data,0));
                    node.error("port didn't match " + node.network.port + " " + getInt16(data,4));
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
