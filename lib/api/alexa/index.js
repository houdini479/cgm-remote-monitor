'use strict';

var moment = require('moment');
var _ = require('lodash');


function configure (app, wares, ctx, env) {
    var entries = ctx.entries;
    var express = require('express')
        , api = express.Router( )
        ;

    // invoke common middleware
    api.use(wares.sendJSONStatus);
    // text body types get handled as raw buffer stream
    api.use(wares.bodyParser.raw());
    // json body types get handled as parsed json
    api.use(wares.bodyParser.json());

    ctx.plugins.eachEnabledPlugin(function each(plugin){
        if (plugin.alexa) {
            if (plugin.alexa.intentHandlers) {
                console.log(plugin.name + ' is Alexa enabled');
                _.each(plugin.alexa.intentHandlers, function (route) {
                    if (route) {
                        ctx.alexa.configureIntentHandler(route.intent, route.intentHandler, route.routableSlot, route.slots);
                    }
                });
            }
            if (plugin.alexa.rollupHandlers) {
                console.log(plugin.name + ' is Alexa rollup enabled');
                _.each(plugin.alexa.rollupHandlers, function (route) {
                    console.log('Route');
                    console.log(route);
                    if (route) {
                        ctx.alexa.addToRollup(route.rollupGroup, route.rollupHandler, route.rollupName);
                    }
                });
            }
        } else {
            console.log('Plugin ' + plugin.name + ' is not Alexa enabled');
        }
    });

    api.post('/alexa', ctx.authorization.isPermitted('api:*:read'), function (req, res, next) {
        console.log('Incoming request from Alexa');
        switch (req.body.request.type) {
            case 'IntentRequest':
                onIntent(req.body.request.intent, function (title, response) {
                    res.json(ctx.alexa.buildSpeechletResponse(title, response, '', 'true'));
                    next( );
                });
                break;
            case 'LaunchRequest':
                onLaunch(req.body.request.intent, function (title, response) {
                    res.json(ctx.alexa.buildSpeechletResponse(title, response, '', 'true'));
                    next( );
                });
                break;
            case 'SessionEndedRequest':
                onSessionEnded(req.body.request.intent, function (alexaResponse) {
                    res.json(alexaResponse);
                    next( );
                });
                break;
        }
    });

    ctx.alexa.addToRollup('Status', function bgRollupHandler(slots, sbx, callback) {
        entries.list({count: 1}, function(err, records) {
            var direction = '';
            if (records[0].direction === 'FortyFiveDown') {
                direction = ' and slightly dropping';
            } else if (records[0].direction === 'FortyFiveUp') {
                direction = ' and slightly rising';
            } else if (records[0].direction === 'Flat') {
                direction = ' and holding';
            } else if (records[0].direction === 'SingleUp') {
                direction = ' and rising';
            } else if (records[0].direction === 'SingleDown') {
                direction = ' and dropping';
            } else if (records[0].direction === 'DoubleDown') {
                direction = ' and rapidly dropping';
            } else if (records[0].direction === 'DoubleUp') {
                direction = ' and rapidly rising';
            } else {
                direction = records[0].direction;
            }
            var status = sbx.scaleMgdl(records[0].sgv) + direction + ' as of ' + moment(records[0].date).from(moment(sbx.time)) + '.';
            callback(null, {results: status, priority: -1});
        });
        // console.log('BG results called');
        // callback(null, 'BG results');
    }, 'BG Status');

    ctx.alexa.configureIntentHandler('AddTreatment', function (callback, slots, sbx) {
        // On amazon developer portal,
        // 1. Add new intent with appropriate slots in Intent schema
        // 2. Add phrase in sample utterances
        if(slots) {
            var data = {
                "eventType": "New Treatment",
                "glucose": slots.glucose.value,
                "glucoseType": "sensor",
                "carbs": slots.carbs.value,
                "insulin": slots.insulin.value,
                "notes": "Added a treatment using alexa",
                "enteredBy": slots.enteredBy.value,
                "reason": slots.reason.value,
            };

            // make api call to api.post('/treatments') to add new treatment
            // sample treatment entry {"_id":"5985e31f850787634b19aff2","enteredBy":"","eventType":"<none>","glucose":6.8,"reason":"","glucoseType":"Finger","duration":0,"units":"mmol","created_at":"2017-08-05T15:24:14.144Z","carbs":null,"insulin":null}
            $.post({
                url: 'https://lennoxt1d.azurewebsites.net/api/v1/treatments',
                headers: {
                    "Content-Type": "application/json"
                },
                data: data,
                success: function(result) {
                    callback('Successfully added treatment', JSON.stringify(result));
                },
                error: function(e) {
                    callback('Something went wrong with the request.');
                }
            });
            // callback('[Test] Successfully added treatment', JSON.stringify(data));
        } else {
            callback('Not enough information to add a treatment');
        }
    });

    ctx.alexa.configureIntentHandler('MetricNow', function (callback, slots, sbx) {
        entries.list({count: 1}, function(err, records) {
            var direction = '';
            if (records[0].direction === 'FortyFiveDown') {
                direction = ' and slightly dropping';
            } else if (records[0].direction === 'FortyFiveUp') {
                direction = ' and slightly rising';
            } else if (records[0].direction === 'Flat') {
                direction = ' and holding';
            } else if (records[0].direction === 'SingleUp') {
                direction = ' and rising';
            } else if (records[0].direction === 'SingleDown') {
                direction = ' and dropping';
            } else if (records[0].direction === 'DoubleDown') {
                direction = ' and rapidly dropping';
            } else if (records[0].direction === 'DoubleUp') {
                direction = ' and rapidly rising';
            }
            var status = sbx.scaleMgdl(records[0].sgv) + direction + ' as of ' + moment(records[0].date).from(moment(sbx.time));
            callback('Current blood glucose', status);
        });
    }, 'metric', ['bg', 'blood glucose', 'number']);

    ctx.alexa.configureIntentHandler('NSStatus', function(callback, slots, sbx) {
        ctx.alexa.getRollup('Status', sbx, slots, function (status) {
            callback('Full status', status);
        });
    });


    function onLaunch() {
        console.log('Session launched');
    }

    function onIntent(intent, next) {
        console.log('Received intent request');
        console.log(JSON.stringify(intent));
        handleIntent(intent.name, intent.slots, next);
    }

    function onSessionEnded() {
        console.log('Session ended');
    }

    function handleIntent(intentName, slots, next) {
        var handler = ctx.alexa.getIntentHandler(intentName, slots);
        if (handler){
            var sbx = initializeSandbox();
            handler(next, slots, sbx);
        } else {
            next('Unknown Intent', 'I\'m sorry I don\'t know what you\'re asking for');
        }
    }

    function initializeSandbox() {
        var sbx = require('../../sandbox')();
        sbx.serverInit(env, ctx);
        ctx.plugins.setProperties(sbx);
        return sbx;
    }

    return api;
}

module.exports = configure;
