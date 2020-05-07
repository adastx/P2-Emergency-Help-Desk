const fs = require('fs');
const server = require('ws').Server;
const s = new server({ port: 3001 });
let emds = [];
let cases = [];
let counter = 0;

console.log("Listening on port 3001...");
//LoadCases();


// For connecting to the MongoDB server when archiving cases
const mongoose = require("mongoose");
const mongoDbUrl = 'mongodb+srv://dev:dev@clustercms-faqog.gcp.mongodb.net/cmsdb?retryWrites=true&w=majority';

/* Configure Mongoose to Connect to MongoDB */
mongoose.connect(mongoDbUrl, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(response => {
        console.log("MongoDB Connected Successfully.");
    }).catch(err => {
        console.log("Database connection failed.");
});

const caseSchema = new mongoose.Schema({
    name: String,
    phone: String,
    cpr: String,
    pos: {
        lat: Number,
        lng: Number
    },
    desc: String,
    notes: String,
    chatLog: String,
    timeClock: String,
    timeDate: String
});

var Case = mongoose.model('Case', caseSchema);

// Server handling events
s.on('connection', function(client) {

    client.on('close', function() {
        // When a client disconnects, check if they are in the EMD array.
        // If they are, remove them from the array.
        let i = emds.indexOf(client);
        if (i !== -1) {
            // If the EMD had a case open, make it available to other EMDs.
            cases.forEach(function(entry) {
                if(entry.emd == client) {
                    entry.emd = null;
                    SendChatMessage(entry.emd, "A dispatcher has put your case on hold...<br>"); 
                    BroadcastToEMDs({
                        type: "CaseClosed",
                        id: entry.id
                    });
                }
            });
            console.log("EMD disconnected.");
            emds.splice(i, 1);
        } else {
            // Not an EMD, check if they created a case.
            cases.forEach(function(entry) {
                if(entry.creator == client) {
                    entry.creator = null;
                    let msg = "The case creator has disconnected...<br>";
                    SendChatMessage(entry.emd, msg);
                    entry.chatLog += msg;
                }
            });
        }
    });

    // A client has sent a message to the server.
    client.on('message', function(message) {
        let data = JSON.parse(message);

        // Handle the message depening on what 'type' it has.
        switch(data.type) {
            case "EMDConnect":
                // An EMD has connected to the server.
                console.log("EMD connected.");
                emds.push(client);
                cases.forEach(function(entry) {
                    client.send(JSON.stringify(SimpleCase(entry)));
                });
                break;
            case "Case":
                // New case submitted to the server.
                // Give the case an ID and save the client that created for livechat, then send the case to all EMDs.
                data.id = ++counter;
                data.creator = client;
                data.emd = null;
                data.timeDate = new Date().toLocaleDateString();
                data.timeClock = getTimeClock();
                data.chatLog = "";
                data.notes = "";
                console.log("Case created (id: %d)", data.id);
                cases.push(data);
                client.send(JSON.stringify({
                    type: "CaseCreated",
                    id: data.id
                }));
                BroadcastToEMDs(SimpleCase(data));
                //SaveCases();
                break;
            case "RequestOpenCase":
                // An EMD wants to view a case. Allow if the case is available, reject if it is taken.
                var caseObj = GetCaseByID(data.id);
                if (caseObj != null) {
                    if (caseObj.emd == null) {
                        caseObj.emd = client;
                        // Send the case details to the EMD.
                        client.send(JSON.stringify(FullCase(caseObj)));
                        // Notify case creator that an EMD is now viewing the case.
                        SendChatMessage(caseObj.creator, "A dispatcher is now viewing your case...<br>");

                        // Update the case list for all EMDs so they can see the case is no longer available.
                        BroadcastToEMDs({
                            type: "CaseOpened",
                            id: data.id
                        })
                    } else {
                        // The case is not available. Deny the EMDs request.
                        client.send(JSON.stringify({
                            type: "DenyOpenCase"
                        }));
                    }
                }
                break;
            case "CloseCase":
                // An EMD has closed a case. (NOT ARCHIVED). Make the case available to other EMDs again.
                var caseObj = GetCaseByID(data.id);
                if (caseObj != null) {
                    caseObj.emd = null;
                    // Notify the case creator that an EMD is no longer viewing their case.
                    SendChatMessage(caseObj.creator, "A dispatcher has put your case on hold...<br>");
                    BroadcastToEMDs({
                        type: "CaseClosed",
                        id: data.id
                    });
                }
                break;
            case "ChatMessage":
                // Send a chat message. If it is sent from an EMD, forward the message to case creator.
                // If the message comes from case creator, forward it to the EMD.
                var caseObj = GetCaseByID(data.caseID);
                if (caseObj != null) {
                    if (data.emd)  
                        SendChatMessage(caseObj.creator, data.message);
                    else 
                        SendChatMessage(caseObj.emd, data.message);
                    
                    caseObj.chatLog += data.message;
                }
                break;
            case "SaveName":
                // An EMD has edited the Name field in a patient journal.
                var caseObj = GetCaseByID(data.id);
                if (caseObj != null)
                    caseObj.name = data.value;
                break;
            case "SavePhone":
                // An EMD has edited the Phone field in a patient journal.
                var caseObj = GetCaseByID(data.id);
                if (caseObj != null)
                    caseObj.phone = data.value;
                break;
            case "SaveCPR":
                // An EMD has edited the CPR field in a patient journal.
                var caseObj = GetCaseByID(data.id);
                if (caseObj != null)
                    caseObj.cpr = data.value;
                break;
            case "SaveNotes":
                // An EMD has edited the Notes field in a patient journal.
                var caseObj = GetCaseByID(data.id);
                if (caseObj != null)
                    caseObj.notes = data.value;
                break;
            case "RequestReopenCase":
                // A civillian wants to open an already existing case.
                var caseObj = GetCaseByID(data.id);
                if (caseObj != null) {
                    if(caseObj.creator) {
                        // Reject because there is already a civillian viewing the case.
                        client.send(JSON.stringify({
                            type: "DenyReopenCase",
                            reason: 1
                        }));
                    } else {
                        caseObj.creator = client;
                        client.send(JSON.stringify({
                            type: "AllowReopenCase",
                            id: data.id,
                            chatLog: caseObj.chatLog
                        }));
                        let msg = "The case creator has reconnected...<br>";
                        SendChatMessage(caseObj.emd, msg);
                        caseObj.chatLog += msg;
                    }                   
                } else {
                    // Reject because the case has been archived.
                    client.send(JSON.stringify({
                        type: "DenyReopenCase",
                        reason: 2
                    }));
                }
                break;
            case "ArchiveCase":
                // An EMD wants to archive a case.
                var caseObj = GetCaseByID(data.id);
                if (caseObj != null) {
                    // Let all EMDs know so it gets removed from their case list.
                    BroadcastToEMDs(data);

                    SendChatMessage(caseObj.creator, "Your case has now been closed. Further communication is not possible.<br>");

                    // Send the case to MongoDB.
                    const newCase = new Case({
                        name: caseObj.name,
                        phone: caseObj.phone,
                        cpr: caseObj.cpr,
                        pos: caseObj.pos,
                        desc: caseObj.desc,
                        notes: caseObj.notes,
                        chatLog: caseObj.chatLog,
                        timeClock: caseObj.timeClock,
                        timeDate: caseObj.timeDate
                    });
                    newCase.save().then(post => {
                        console.log("Case archived (id: %d)", caseObj.id);
                    });

                    // Remove the case from the cases[] array.
                    let i = cases.indexOf(caseObj);
                    cases.splice(i, 1);
                }
                break;
            default:
                // This should never happen.
                console.log("Received some weird data...");
                break;
        }
    });
});

// Sends a chat message to the client without logging it in a case.
// Useful for chat notifications.
function SendChatMessage(client, msg) {
    if (client != null)
        client.send(JSON.stringify({type: "ChatMessage", message: msg}));
}

// Returns the case object with a specific id from the cases[] array.
function GetCaseByID(id) {
    for (var i = 0; i < cases.length; i++) {
        if(cases[i].id == id)
            return cases[i];
    }
    return null;
}

// Lite version of a case. This is all the data needed for adding it to the EMD case list.
function SimpleCase(data) {
    return {
        type: "Case",
        id: data.id,
        pos: data.pos,
        available: (data.emd == null),
        timeClock: data.timeClock
    };
}

// Full version of a case. This is all the data needed for the chat and patient journal.
function FullCase(data) {
    return {
        type: "AllowOpenCase",
        id: data.id,
        name: data.name,
        phone: data.phone,
        cpr: data.cpr,
        desc: data.desc,
        notes: data.notes,
        chatLog: data.chatLog,
        timeClock: data.timeClock,
        timeDate: data.timeDate
    };
}

// Sends data to all connected EMDs
function BroadcastToEMDs(data) {
    emds.forEach(function(emd) {
        emd.send(JSON.stringify(data));
    });
}

// What time is it? This is the time created value on cases.
function getTimeClock() {
    let time = new Date();
    let hours = time.getHours();
    let minutes = time.getMinutes();
    let seconds = time.getSeconds();
    
    if (hours < 10)
        hours = `0${hours}`;
    if (minutes < 10)
        minutes = `0${minutes}`;
    if (seconds < 10)
        seconds = `0${seconds}`

    return hours + ":" + minutes + ":" + seconds;
}

/*
// Saves current cases to file, which can be loaded in the case of a server restart/crash.
// NOTE: Can be improved if we only add/delete entries in the file when they are added/deleted instead of saving the entire array constantly.
function SaveCases() {
    //console.log("Saving current cases... ");

    //Delete any already existing data in save file
    fs.truncate('cases.txt', 0, function(){});

    // Write this simplified cases array to a file the server can read from next time it starts.
    fs.writeFile('cases.txt', JSON.stringify(cases, ["type", "id", "time", "desc", "pos", "lat", "lng"], 4), (err) => {
        if (err) {
            console.log("Failed to save cases. " + err);
        }
    });
}*/

/*
// Load current cases from file
function LoadCases() {
    //console.log("Loading current cases from previous session... ");

    fs.readFile('cases.txt', {encoding: 'utf-8'}, function(err, data){
        if(err) {
            console.log("Failed to read cases.txt. " + err);
        } else {
            try {
                cases = JSON.parse(data);
                //console.log("Cases loaded successfully. ");

                if(cases.length > 0)
                    counter = cases[cases.length-1].id;

            } catch(jsonError) {
                console.log("There were no cases to load or cases.txt is broken.");
            }
        }
    });
}*/
