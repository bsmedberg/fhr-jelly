var ONE_DAY = 1000 * 60 * 60 * 24;
var ONE_WEEK = ONE_DAY * 7;
var TWO_WEEKS = ONE_DAY * 14;
var THIRTY_DAYS_IN_SECONDS = 2592000;
var PAINT_TIME_THRESHOLD = 300000;
var CONFIG_URL = 'js/config.json?';
var payload = null;
var prefs = null;

Promise.prototype.finally = function(fn) {
    return this.then(
        (v) => {
            fn();
            return v;
        },
        (err) => {
            fn();
            throw err;
        }
    );
};

// Is this the first load for the document?
var isFirstLoad = true;

// Converts the date passed to a Date object and checks
// whether the current month is equal to the month of the
// day argument passed.
var isCurrentMonth = function(day) {
    var currentYear = new Date().getYear();
    var currentMonth = new Date().getMonth() + 1;
    var year = new Date(day).getYear();
    var month = new Date(day).getMonth() + 1;

    if (currentYear === year && currentMonth === month) {
        return true;
    }
    return false;
};

function isPastNDays(day, n) {
    let difference = new Date().getTime() - new Date(day).getTime();
    return difference < ONE_DAY * n;
}

function populateEnvironment(environment) {
    var vitalStatsValueContainers = $('#vital_stats .statsBoxSection-value');

    // XXX localize me?
    let channel = environment.settings.update.channel;

    // XXX localize me!
    let updates = environment.settings.update.enabled ?
      (environment.settings.update.autoDownload ? "automatic" : "prompt") : "disabled";
    var vitalStats = [
        environment.build.version,
        channel,
        updates,
    ];

    vitalStatsValueContainers.each(function(index) {
        $(this).text(vitalStats[index]);
    });

    var addonsValueContainers = $('#addons .statsBoxSection-value');

    let activeAddons = 0;
    for (let id of Object.keys(environment.addons.activeAddons)) {
        ++activeAddons;
    }
    let activePlugins = 0;
    let clickPlugins = 0;
    for (let plugin of environment.addons.activePlugins) {
        if (plugin.clicktoplay) {
            ++clickPlugins;
        } else {
            ++activePlugins;
        }
    }
    for (let plugin of Object.keys(environment.addons.activeGMPlugins)) {
        ++activePlugins;
    }

    var addons = [
        activeAddons,
        activePlugins,
        clickPlugins,
    ];

    addonsValueContainers.each(function(index) {
        $(this).text(addons[index]);
    });
}

let pendingIDs = new Map();
function promiseFetchPing(id) {
    let evt = new CustomEvent('RemoteHealthReportCommand', {
        detail: {
            command: 'RequestTelemetryPingData',
            id: id,
        }
    });
    document.dispatchEvent(evt);
    return new Promise((resolve, reject) => {
        pendingIDs.set(id, [resolve, reject]);
    }).finally(() => { pendingIDs.delete(id); });
}

let pendingCurrentSubsession = null;
function promiseFetchCurrentSubsession() {
    sendToBrowser("RequestCurrentPingData");
    return new Promise((resolve, reject) => {
        pendingCurrentSubsession = resolve;
    }).finally(() => { pendingCurrentSubsession = null; });
}

function pingReceived(id, data) {
    let [resolve, reject] = pendingIDs.get(id);
    resolve(data);
}

function pingError(id, err) {
    let [resolve, reject] = pendingIDs.get(id);
    reject(err);
}

function crashesFromMainPing(ping, type) {
    let base = ping.payload.keyedHistograms['SUBPROCESS_ABNORMAL_ABORT'];
    if (base === undefined) {
        return 0;
    }
    let h = base[type];
    if (h === undefined) {
        return 0;
    }
    return h.values[0];
}

function populateThisMonth(pingList) {
    let totalSessionThisMonth = 0;
    let totalTimeThisMonth = 0;
    let mainCrashesThisMonth = 0;
    let pluginCrashesThisMonth = 0;

    let mainCrashes30Days = 0;

    let startupTimes = [];

    function finish() {
        var currentMonthValueContainers = $('#current_month .statsBoxSection-value');

        // XXX: localize me
        let displayTime;
        if (totalTimeThisMonth < 60 * 60) {
            displayTime = Math.floor(totalTimeThisMonth / 60) + " minutes";
        } else if (totalTimeThisMonth < 60 * 60 * 48) {
            displayTime = Math.floor(totalTimeThisMonth / 60 / 60) + " hours";
        } else {
            displayTime = Math.floor(totalTimeThisMonth / 60 / 60 / 24) + " days";
        }

        var thisMonth = [
            totalSessionThisMonth,
            displayTime,
            mainCrashesThisMonth,
            pluginCrashesThisMonth,
        ];

        currentMonthValueContainers.each(function(index) {
            $(this).text(thisMonth[index]);
        });

        if (mainCrashes30Days > 2) {
            $('#crashyfox').show('slow');
        }

        if (startupTimes < 5) {
            $('#hungryfox').show('slow');
        } else {
            startupTimes.sort((a, b) => (a[0] - b[0]));
            drawGraph(startupTimes);
        }
    }

    function processMainPing(data) {
        if (isPastNDays(data.payload.info.subsessionStartDate, 30)) {
            if (data.payload.info.subsessionCounter == 1 &&
                data.payload.simpleMeasurements.firstPaint) {
                let sd = new Date(data.payload.info.subsessionStartDate).getTime();
                startupTimes.push([sd, data.payload.simpleMeasurements.firstPaint]);
            }
            mainCrashes30Days += crashesFromMainPing(data, "content");
        }
        if (isCurrentMonth(data.payload.info.subsessionStartDate)) {
            if (data.payload.info.subsessionCounter == 1) {
                ++totalSessionThisMonth;
            }
            totalTimeThisMonth += data.payload.info.subsessionLength;
            mainCrashesThisMonth += crashesFromMainPing(data, "content");
            pluginCrashesThisMonth += crashesFromMainPing(data, "plugin");
            pluginCrashesThisMonth += crashesFromMainPing(data, "gmplugin");
        }
    }

    let pending = 1;
    function pendingFinished() {
        if (--pending == 0) {
            finish();
        }
    }
    promiseFetchCurrentSubsession()
        .then(processMainPing)
        .finally(pendingFinished);

    for (let {type, timestampCreated, id} of pingList) {
        if (!isPastNDays(timestampCreated, 35)) {
            continue;
        }
        if (type == "main") {
            ++pending;
            promiseFetchPing(id)
                .then(processMainPing)
                .finally(pendingFinished);
        } else if (type == "crash") {
            ++pending;
            promiseFetchPing(id).then(
                (data) => {
                    if (isPastNDays(timestampCreated, 30)) {
                        mainCrashes30Days += 1;
                    }
                    if (isCurrentMonth(timestampCreated)) {
                        mainCrashesThisMonth += 1;
                    }
                }
            ).finally(pendingFinished);
        }
    }
}

function init() {
    var fhr = {};
    var cache_buster = Math.random();

    $.getJSON(CONFIG_URL + cache_buster, function(data) {
        fhr = data.fhr;
        if (fhr.debug == 'true') {
            var custom_event = {
                    data: {
                        type: 'payload',
                        content: ''
                    }
                };

            $.getJSON(fhr.jsonurl, function(data) {
                // receiveMessage expects a string.
                custom_event.data.content = JSON.stringify(data);
                receiveMessage(custom_event);
            });
        } else {
            window.addEventListener('message', receiveMessage, false);
            reqPrefs();
        }
    });
}

function receiveMessage(event) {
    // If this is the initial load of the page, we are only requesting prefs in
    // init and then only once the message for this is received do we ask for
    // the payload.
    if (isFirstLoad && event.data.type === 'prefs') {
        reqPayload();
        isFirstLoad = false;
    }

    // The below handles all other on demand requests for prefs or payloads.
    switch (event.data.type) {
    case 'prefs':
        prefs = event.data.content;
        if (prefs.enabled) {
            showStatusPanel($('.enabledPanel'), true, false);
        } else {
            showStatusPanel($('.disabledPanel'), false, false);
        }
        break;
    case 'telemetry-current-environment-data':
        populateEnvironment(event.data.content);
        break;
    case 'telemetry-ping-list':
        populateThisMonth(event.data.content);
        document.querySelector('.rawdata-display pre').textContent = JSON.stringify(payload, null, 2);
        break;
    case 'telemetry-ping-data':
        if (event.data.content.pingData !== undefined) {
            pingReceived(event.data.content.id, event.data.content.pingData);
        } else {
            pingError(event.data.content.id, event.data.content.error);
        }
        break;
    case 'telemetry-current-ping-data':
        pendingCurrentSubsession(event.data.content);
        break;
    }
}

function disableSubmission() {
    sendToBrowser('DisableDataSubmission');
}

function enableSubmission() {
    sendToBrowser('EnableDataSubmission');
}

function reqPrefs() {
    sendToBrowser('RequestCurrentPrefs');
}

function reqPayload() {
    sendToBrowser('RequestCurrentEnvironment');
    sendToBrowser('RequestTelemetryPingList');
}

function sendToBrowser(type) {
    var event = new CustomEvent('RemoteHealthReportCommand', {
        detail: {
            command: type
        }
    });
    try {
        document.dispatchEvent(event);
    } catch (e) {
        console.log(e);
    }
}
