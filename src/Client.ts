import { EventEmitter } from 'https://deno.land/std/node/events.ts';

export default class Client extends EventEmitter {
    [x: string]: any;
    ws: any;
    uri: string;
    serverTimeOffset: number;
    user: any;
    participantId: any;
    channel: any;
    ppl: Ppl;
    connectionTime: any;
    connectionAttempts: any;
    desiredChannelId: any;
    desiredChannelSettings: any;
    pingInterval: any;
    canConnect: boolean;
    noteBuffer: any;
    noteBufferTime: number;
    noteFlushInterval: any;
    ['🐈']: any;
    offlineParticipant: Participant;
    autoPickupCrown: boolean;
    token: string;
    constructor (uri: any, token: string) {
        super();
        this.uri = uri;
        this.ws = undefined;
        this.serverTimeOffset = 0;
        this.user = undefined;
        this.participantId = undefined;
        this.channel = undefined;
        this.ppl = {};
        this.connectionTime = undefined;
        this.connectionAttempts = 0;
        this.desiredChannelId = undefined;
        this.desiredChannelSettings = undefined;
        this.pingInterval = undefined;
        this.canConnect = false;
        this.noteBuffer = [];
        this.noteBufferTime = 0;
        this.noteFlushInterval = undefined;
        this['🐈'] = 0;
        this.token = token;

        this.offlineParticipant = {
            _id: "",
            name: "",
            color: "#777",
            id: ""
        };

        this.autoPickupCrown = true;

        this.bindEventListeners();
    }

    bindEventListeners() {
        var self = this;
        this.on("hi", function(msg) {
            self.user = msg.u;
            self.receiveServerTime(msg.t, msg.e || undefined);
            if(self.desiredChannelId) {
                self.setChannel();
            }
        });
        this.on("t", function(msg) {
            self.receiveServerTime(msg.t, msg.e || undefined);
        });
        this.on("ch", function(msg) {
            self.desiredChannelId = msg.ch._id;
            self.desiredChannelSettings = msg.ch.settings;
            self.channel = msg.ch;
            if(msg.p) self.participantId = msg.p;
            self.setParticipants(msg.ppl);
        });
        this.on("p", function(msg) {
            self.participantUpdate(msg);
            self.emit("participant update", self.findParticipantById(msg.id));
        });
        this.on("m", function(msg) {
            if(self.ppl.hasOwnProperty(msg.id)) {
                self.participantUpdate(msg);
            }
        });
        this.on("bye", function(msg) {
            self.removeParticipant(msg.p);
        });
        this.on("ch", function(msg) {
            if (self.autoPickupCrown) {
                if (msg.ch.crown) {
                    var crown = msg.ch.crown;
                    if(!crown.participantId || !self.ppl[crown.participantId]) {
                        var land_time = crown.time + 2000 - self.serverTimeOffset;
                        var avail_time = crown.time + 15000 - self.serverTimeOffset;
                        let countdown_interval: any;
                        clearInterval(countdown_interval);
                        countdown_interval = setInterval(function() {
                            var time = Date.now();
                            if(time >= land_time) {
                                var ms = avail_time - time;
                                if(ms <= 0) {
                                    clearInterval(countdown_interval);
                                    self.pickupCrown();
                                }
                            }
                        }, 1000);
                    }
                }
            }
        });
    }

    findParticipantById(id: string) {
        return this.ppl[id] || this.offlineParticipant;
    };

    receiveServerTime(time: any, echo: any) {
        var self = this;
        var now = Date.now();
        var target = time - now;
        //console.log("Target serverTimeOffset: " + target);
        var duration = 1000;
        var step = 0;
        var steps = 50;
        var step_ms = duration / steps;
        var difference = target - this.serverTimeOffset;
        var inc = difference / steps;
        var iv: any;
        iv = setInterval(function() {
            self.serverTimeOffset += inc;
            if(++step >= steps) {
                clearInterval(iv);
                //console.log("serverTimeOffset reached: " + self.serverTimeOffset);
                self.serverTimeOffset=target;
            }
        }, step_ms);
        // smoothen

        //this.serverTimeOffset = time - now;			// mostly time zone offset ... also the lags so todo smoothen this
                                    // not smooth:
        //if(echo) this.serverTimeOffset += echo - now;	// mostly round trip time offset
    }

    setChannel(id?: any, set?: any) {
        this.desiredChannelId = id || this.desiredChannelId || "lobby";
        this.desiredChannelSettings = set || this.desiredChannelSettings || undefined;
        this.sendArray([{m: "ch", _id: this.desiredChannelId, set: this.desiredChannelSettings}]);
    }

    sendArray(arr: Array<any>) {
        this.send(JSON.stringify(arr));
    }

    setParticipants(ppl: any) {
        for(var id in this.ppl) {
            if(!this.ppl.hasOwnProperty(id)) continue;
            var found = false;
            for(var j = 0; j < ppl.length; j++) {
                if(ppl[j].id === id) {
                    found = true;
                    break;
                }
            }
            if(!found) {
                this.removeParticipant(id);
            }
        }
        // update all
        for(var i = 0; i < ppl.length; i++) {
            this.participantUpdate(ppl[i]);
        }
    }

    send(raw: string) {
        if(this.isConnected()) this.ws.send(raw);
    }

    isConnected() {
        return this.isSupported() && this.ws && this.ws.readyState === WebSocket.OPEN;
    }
    
    isConnecting() {
        return this.isSupported() && this.ws && this.ws.readyState === WebSocket.CONNECTING;
    }

    isSupported() {
        return true;
    }

    start() {
        this.canConnect = true;
        this.connect();
    }

    stop() {
        this.canConnect = false;
        this.ws.close();
    }

    connect() {
        if(!this.canConnect || !this.isSupported() || this.isConnected() || this.isConnecting())
            return;
        this.emit("status", "Connecting...");
        this.ws = new WebSocket(this.uri);
        var self = this;
        this.ws.addEventListener("close", function(evt: any) {
            self.user = undefined;
            self.participantId = undefined;
            self.channel = undefined;
            self.setParticipants([]);
            clearInterval(self.pingInterval);
            clearInterval(self.noteFlushInterval);
    
            self.emit("disconnect", evt);
            self.emit("status", "Offline mode");
    
            // reconnect!
            if(self.connectionTime) {
                self.connectionTime = undefined;
                self.connectionAttempts = 0;
            } else {
                ++self.connectionAttempts;
            }
            var ms_lut = [50, 2950, 7000, 10000];
            var idx = self.connectionAttempts;
            if(idx >= ms_lut.length) idx = ms_lut.length - 1;
            var ms = ms_lut[idx];
            setTimeout(self.connect.bind(self), ms);
        });
        this.ws.addEventListener("error", function (err: any)  {
            self.emit("wserror", err);
            self.ws.close(); // self.ws.emit("close");
        });
        this.ws.addEventListener("open", function(evt: any) {
            self.connectionTime = Date.now();
            self.sendArray([{"m": "hi", "🐈": self['🐈']++ || undefined, "token": self.token }]);
            self.pingInterval = setInterval(function() {
                self.sendArray([{m: "t", e: Date.now()}]);
            }, 20000);
            //self.sendArray([{m: "t", e: Date.now()}]);
            self.noteBuffer = [];
            self.noteBufferTime = 0;
            self.noteFlushInterval = setInterval(function() {
                if(self.noteBufferTime && self.noteBuffer.length > 0) {
                    self.sendArray([{m: "n", t: self.noteBufferTime + self.serverTimeOffset, n: self.noteBuffer}]);
                    self.noteBufferTime = 0;
                    self.noteBuffer = [];
                }
            }, 200);
    
            self.emit("connect");
            self.emit("status", "Joining channel...");
        });
        this.ws.addEventListener("message", function(evt: any) {
            var transmission = JSON.parse(evt.data);
            for(var i = 0; i < transmission.length; i++) {
                var msg = transmission[i];
                self.emit(msg.m, msg);
            }
        });
    }

    removeParticipant(id: string) {
        if(this.ppl.hasOwnProperty(id)) {
            var part = this.ppl[id];
            delete this.ppl[id];
            this.emit("participant removed", part);
            this.emit("count", this.countParticipants());
        }
    }

    participantUpdate(update: Participant) {
        var part: Participant = this.ppl[update.id] || null;
        if(part === null) {
            part = update;
            this.ppl[part.id] = part;
            this.emit("participant added", part);
            this.emit("count", this.countParticipants());
        } else {
            if(update.x) part.x = update.x;
            if(update.y) part.y = update.y;
            if(update.color) part.color = update.color;
            if(update.name) part.name = update.name;
        }
    }

    countParticipants() {
        var count = 0;
        for(var i in this.ppl) {
            if(this.ppl.hasOwnProperty(i)) ++count;
        }
        return count;
    }

    setName(str: string) {
        if (str.length > 40) return;
        this.sendArray([{m:'userset', set:{name:str}}]);
    }

    kickban(_id: string, ms: number) {
        if (ms > 60*60*1000) ms = 60*60*1000;
        if (ms < 0) ms = 0;
        this.sendArray([{m:'kickban', _id: _id, ms: ms}]);
    }

    chown(id: string) {
        if (!this.isOwner()) return;
        this.sendArray([{m:'chown', id: id}]);
    }

    pickupCrown() {
        this.sendArray([{m:'chown', id: this.getOwnParticipant().id}]);
    }

    isOwner() {
        return this.channel && this.channel.crown && this.channel.crown.participantId === this.participantId;
    }

    getParticipant(str: string) {
        let ret;
        for (let id in this.ppl) {
            let part: Participant = this.ppl[id];
            if (part.name.toLowerCase().includes(str.toLowerCase()) || part._id.toLowerCase().includes(str.toLowerCase()) || part.id.toLowerCase().includes(str.toLowerCase())) {
                ret = part;
            }
        }
        if (typeof(ret) !== "undefined") {
            return ret;
        }
    }

    getOwnParticipant() {
        return this.findParticipantById(this.participantId);
    }
}

interface Participant {
    x?: number,
    y?: number,
    color: string,
    name: string,
    _id: string,
    id: string
}

interface Ppl {
    [key: string]: Participant
}

export { Client };