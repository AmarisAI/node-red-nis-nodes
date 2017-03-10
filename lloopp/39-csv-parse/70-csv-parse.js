/**
 * Copyright 2015 Natural Intelligence Solutions
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Author: Michael Angelo Ruta (2015)
 *
 * This module is still on safe BETA testing
 * This is tested and passed using a small set of multiline-record CSV 
 * for use with large data-streams.
 * This module is only compatible and tested using csv-parse ^0.1.4
 * as of October 7, 2016
 *
 **/

var helpers = require('toolbox-helpers');
 
module.exports = function(RED) {
    "use strict";
    function CSVParseNode(n) {
        RED.nodes.createNode(this,n);

        var parse = require('csv-parse');

        function updateNodeConfiguration(node) {
            node.template = (n.temp || "").split(",");
            node.sep = (n.sep || ',').replace("\\t","\t").replace("\\n","\n").replace("\\r","\r").replace("\\x05","\x05");
            node.quo = n.quo || '"';
            node.ret = (n.ret || "\n").replace("\\n","\n").replace("\\r","\r");
            node.winflag = (node.ret === "\r\n");
            node.lineend = n.lineend || "\n";
            node.multi = n.multi || "one";
            node.hdrin = n.hdrin || false;
            node.hdrout = n.hdrout || false;
            node.goodtmpl = true;
            node.legacy = n.legacy || false;
            node.detect = n.detect || false;
        }

        var node = this;
        updateNodeConfiguration(node);

        // pass in an array of column names to be trimed, de-quoted and retrimed
        var clean = function(col) {
            for (var t = 0; t < col.length; t++) {
                col[t] = col[t].trim(); // remove leading and trailing whitespace
                if (col[t].charAt(0) === '"' && col[t].charAt(col[t].length -1) === '"') {
                    // remove leading and trailing quotes (if they exist) - and remove whitepace again.
                    col[t] = col[t].substr(1,col[t].length -2).trim();
                }
            }
            if ((col.length === 1) && (col[0] === "")) { node.goodtmpl = false; }
            else { node.goodtmpl = true; }
            return col;
        }
        node.template = clean(node.template);

        this.lineBuffer = "";
        this.lineBufferSize = 0;

        this.on("input", function(msg) {
            
            if(msg.config) {
                n = helpers.autoConfig(msg.config,n,node.id);
                updateNodeConfiguration(node);
            }

            if (msg.hasOwnProperty("payload")) {
                if (typeof msg.payload == "object") { // convert object to CSV string
                    try {
                        var ou = "";
                        if (node.hdrout) {
                            ou += node.template.join(node.sep) + node.ret;
                        }
                        if (!Array.isArray(msg.payload)) { msg.payload = [ msg.payload ]; }
                        for (var s = 0; s < msg.payload.length; s++) {
                            for (var t=0; t < node.template.length; t++) {

                                // aaargh - resorting to eval here - but fairly contained front and back.
                                var p = RED.util.ensureString(eval("msg.payload[s]."+node.template[t]));

                                if (p === "undefined") { p = ""; }
                                if (p.indexOf(node.sep) != -1) { // add quotes if any "commas"
                                    ou += node.quo + p + node.quo + node.sep;
                                }
                                else if (p.indexOf(node.quo) != -1) { // add double quotes if any quotes
                                    p = p.replace(/"/g, '""');
                                    ou += node.quo + p + node.quo + node.sep;
                                }
                                else { ou += p + node.sep; } // otherwise just add
                            }
                            ou = ou.slice(0,-1) + node.ret; // remove final "comma" and add "newline"
                        }
                        msg.payload = ou;
                        node.send(msg);
                    }
                    catch(e) { node.error(e,msg); }
                }
                else if (typeof msg.payload == "string") { // convert CSV string to object

                    if(node.legacy) {
                        try {
                            var f = true; // flag to indicate if inside or outside a pair of quotes true = outside.
                            var j = 0; // pointer into array of template items
                            var k = [""]; // array of data for each of the template items
                            var o = {}; // output object to build up
                            var a = []; // output array is needed for multiline option
                            var first = true; // is this the first line
                            var line = msg.payload;
                            var tmp = "";

                            // For now we are just going to assume that any \r or \n means an end of line...
                            //   got to be a weird csv that has singleton \r \n in it for another reason...

                            // Now process the whole file/line
                            for (var i = 0; i < line.length; i++) {
                                if ((node.hdrin === true) && first) { // if the template is in the first line
                                    if ((line[i] === "\n")||(line[i] === "\r")) { // look for first line break
                                        node.template = clean(tmp.split(node.sep));
                                        first = false;
                                    }
                                    else { tmp += line[i]; }
                                }
                                else {
                                    if (line[i] === node.quo) { // if it's a quote toggle inside or outside
                                        f = !f;
                                        if (line[i-1] === node.quo) { k[j] += '\"'; } // if it's a quotequote then it's actually a quote
                                        //if ((line[i-1] !== node.sep) && (line[i+1] !== node.sep)) { k[j] += line[i]; }
                                    }
                                    else if ((line[i] === node.sep) && f) { // if we are outside of quote (ie valid separator
                                        if (!node.goodtmpl) { node.template[j] = "col"+(j+1); }
                                        if ( node.template[j] && (node.template[j] !== "") && (k[j] !== "" ) ) {
                                            if ( (k[j].charAt(0) !== "+") && !isNaN(Number(k[j])) ) { k[j] = Number(k[j]); }
                                            o[node.template[j]] = k[j];
                                        }
                                        j += 1;
                                        k[j] = "";
                                    }
                                    else if (f && ((line[i] === "\n") || (line[i] === "\r"))) { // handle multiple lines
                                        //console.log(j,k,o,k[j]);
                                        if (!node.goodtmpl) { node.template[j] = "col"+(j+1); }
                                        if ( node.template[j] && (node.template[j] !== "") && (k[j] !== "") ) {
                                            if ( (k[j].charAt(0) !== "+") && !isNaN(Number(k[j])) ) { k[j] = Number(k[j]); }
                                            else { k[j].replace(/\r$/,''); }
                                            o[node.template[j]] = k[j];
                                        }
                                        if (JSON.stringify(o) !== "{}") { // don't send empty objects
                                            if (node.multi === "one") {
                                                var newMessage = RED.util.cloneMessage(msg);
                                                newMessage.payload = o;
                                                node.send(newMessage); // either send
                                            }
                                            else { a.push(o); } // or add to the array
                                        }
                                        j = 0;
                                        k = [""];
                                        o = {};
                                    }
                                    else { // just add to the part of the message
                                        k[j] += line[i];
                                    }
                                }
                            }
                            // Finished so finalize and send anything left
                            //console.log(j,k,o,k[j]);
                            if (!node.goodtmpl) { node.template[j] = "col"+(j+1); }
                            if ( node.template[j] && (node.template[j] !== "") && (k[j] !== "") ) {
                                if ( (k[j].charAt(0) !== "+") && !isNaN(Number(k[j])) ) { k[j] = Number(k[j]); }
                                else { k[j].replace(/\r$/,''); }
                                o[node.template[j]] = k[j];
                            }
                            if (JSON.stringify(o) !== "{}") { // don't send empty objects
                                if (node.multi === "one") {
                                    var newMessage = RED.util.cloneMessage(msg);
                                    newMessage.payload = o;
                                    node.send(newMessage); // either send
                                }
                                else { a.push(o); } // or add to the aray
                            }
                            if (node.multi !== "one") {
                                msg.payload = a;
                                node.send(msg); // finally send the array
                            }
                        }
                        catch(e) { node.error(e,msg); }
                    } else {

                        var raw = msg.payload;
                        try {

                            var parserConfig = {delimiter:node.sep, columns:node.template, quote:node.quo, auto_parse:n.detect}

                            parse(msg.payload, parserConfig, function(err, parsed){
                                if(!err || (err == "Error: Number of columns on line 1 does not match header" && n.fixed == true)) {
                                    msg.payload = parsed ? (parsed[0] || {}) : {};

                                    // fixed columns ensure that the number of columns matched the header
                                    // definition. this eliminates the errors in parsing multiline records

                                    if(n.fixed == true) {

                                        var bufferSize = Object.keys(msg.payload).length;

                                        // this would replace newline character with space
                                        if(bufferSize < node.template.length) {
                                            node.lineBufferSize += bufferSize
                                            if(node.lineBuffer == "") {
                                                node.lineBuffer += raw;
                                            } else {
                                                node.lineBuffer += " " + raw;
                                            }
                                        }

                                        // for multi-line records
                                        if(node.lineBufferSize+1 > node.template.length) {
                                                parse(node.lineBuffer, parserConfig, function(err, parsed_){
                                                    if(node.lineBufferSize >= node.template.length || bufferSize != node.template.length) {
                                                        node.lineBuffer = ""
                                                        node.lineBufferSize = 0;
                                                        msg.payload = parsed_[0];
                                                    } else {
                                                        msg.payload = parsed[0]
                                                    }
                                                    if(n.nempty) {
                                                        for (var p in msg.payload) {
                                                            if(msg.payload[p]==""||msg.payload[p]==null){
                                                                delete msg.payload[p];
                                                            }
                                                        };
                                                    }
                                                    node.send(msg);
                                                })
                                                node.lineBufferSize = 0;
                                                node.lineBuffer = "";
                                        }

                                        // for single-line records
                                        if(node.lineBufferSize+1 == node.template.length || bufferSize == node.template.length) {
                                            parse(node.lineBuffer, parserConfig, function(err, parsed_){
                                            
                                                if(node.lineBufferSize >= node.template.length || bufferSize != node.template.length) {
                                                    node.lineBuffer = ""
                                                    node.lineBufferSize = 0;
                                                    msg.payload = parsed_[0];
                                                } else {
                                                    msg.payload = parsed[0]
                                                }

                                                if(n.nempty) {
                                                    for (var p in msg.payload) {
                                                        if(msg.payload[p]==""||msg.payload[p]==null){
                                                            delete msg.payload[p];
                                                        }
                                                    };
                                                }

                                                node.send(msg);
                                            })
                                        }
                                    } else {

                                       if(n.nempty) {
                                            for (var p in msg.payload) {
                                                if(msg.payload[p]==""||msg.payload[p]==null){
                                                    delete msg.payload[p];
                                                }
                                            };
                                        }
                                        node.send(msg);
                                    }

                                } else {å
                                    node.error(err,msg);
                                }
                            });
                        }
                        catch(e) { 
                            node.error(e,msg); 
                        }

                    }
                }
                else { node.warn(RED._("csv.errors.csv_js")); }
            }
            else { node.send(msg); } // If no payload - just pass it on.
        });
    }
    // var json = JSON.parse(require('fs').readFileSync('./package.json', 'utf8'))
    // if(json.dependencies['csv-parse'] != "^0.1.4") {
    // if(parse.Parser().regexp_float.toString() != "/^[+-]?(([1-9][0-9]*)|(0))([.,][0-9]+)?$/") {
    //     throw "csv-parse module requires version ^0.1.4";
    // } else {
        RED.nodes.registerType("csv-parse",CSVParseNode);
    // }
}
