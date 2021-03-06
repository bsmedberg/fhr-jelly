var ONE_DAY = 1000 * 60 * 60 * 24;
var ONE_WEEK = ONE_DAY * 7;
var TWO_WEEKS = ONE_DAY * 14;
var THIRTY_DAYS_IN_SECONDS = 2592000;
var PAINT_TIME_THRESHOLD = 300000;
var CONFIG_URL = 'js/config.json?';
var payload = null;
var prefs = null;

// Is this the first load for the document?
var isFirstLoad = true;

// Converts the date passed [2013-06-13] to a Date object and checks
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

// Gets all dates from the object, sort in the specified
// oder and returns the new array.
var sortDates = function(days, descending) {
    var dates = [];

    // Gather up all of the dates
    for (var day in days) {
        if (days.hasOwnProperty(day)) {
            dates.push(day);
        }
    }
    return descending ? dates.sort().reverse() : dates.sort();
};

// Returns the total open time
var calculateTotalTime = function(healthreport, historically) {
    var days = healthreport.data.days;
    var totalTimeOpen = parseInt(healthreport.data.last['org.mozilla.appSessions.current'].totalTime, 10);

    for (var day in days) {
        if (days.hasOwnProperty(day)) {
            var monthCondition = isCurrentMonth(day) && typeof days[day]['org.mozilla.appSessions.previous'] !== 'undefined';
            var historicalCondition = typeof days[day]['org.mozilla.appSessions.previous'] !== 'undefined';
            // Whether the function is called for the grand historical total or only for this month,
            // will determine the condition used in the below 'if' statement.
            var activeCondition = historically ? historicalCondition : monthCondition;

            // Only total up values for the current month
            // Only proceed if we have appSessions data.
            if (activeCondition) {
                var cleanTotalTimeArray = days[day]['org.mozilla.appSessions.previous'].cleanTotalTime;
                var abortedTotalTimeArray = days[day]['org.mozilla.appSessions.previous'].abortedTotalTime;

                // All sessions will not always have a cleanTotalTime for a day so, ensure it is not
                // undefined before iterating.
                if (typeof cleanTotalTimeArray !== 'undefined') {
                    // cleanTotalTime is an array and we need to add all of the totals together.
                    for (var cleanTotalTime in cleanTotalTimeArray) {
                        if (cleanTotalTimeArray.hasOwnProperty(cleanTotalTime)) {
                            // Parse total time as int
                            var thisCleanTotalTime = parseInt(cleanTotalTimeArray[cleanTotalTime], 10);

                            // If the total time is more than thirty days in seconds, we need to divide by 1000
                            // @see https://bugzilla.mozilla.org/show_bug.cgi?id=856315
                            if (thisCleanTotalTime > THIRTY_DAYS_IN_SECONDS) {
                                // Turn the milliseconds into seconds
                                totalTimeOpen += thisCleanTotalTime / 1000;
                            } else {
                                totalTimeOpen += thisCleanTotalTime;
                            }
                        }
                    }
                }

                // All sessions will not always have a abortedTotalTime for a day so, ensure it is not
                // undefined before iterating.
                if (typeof abortedTotalTimeArray !== 'undefined') {
                    // cleanTotalTime is an array and we need to add all of the totals together.
                    for (var abortedTotalTime in abortedTotalTimeArray) {
                        if (abortedTotalTimeArray.hasOwnProperty(abortedTotalTime)) {
                            // Parse total time as int
                            var thisAbortedTotalTime = parseInt(abortedTotalTimeArray[abortedTotalTime], 10);

                            // If the total time is more than thirty days in seconds, we need to divide by 1000
                            // @see https://bugzilla.mozilla.org/show_bug.cgi?id=856315
                            if (thisAbortedTotalTime > THIRTY_DAYS_IN_SECONDS) {
                                // Turn the milliseconds into seconds
                                totalTimeOpen += thisAbortedTotalTime / 1000;
                            } else {
                                totalTimeOpen += thisAbortedTotalTime;
                            }
                        }
                    }
                }
            }
        }
    }
    // Return time in minutes.
    return Math.round(totalTimeOpen / 60);
};

var getLastCrashDate = function(data) {
    var sortedDates = sortDates(data.days, true);
    var lastCrashDate = '';

    // Loop through the dates from latest to eldest.
    for (var day in sortedDates) {
        if (sortedDates.hasOwnProperty(day)) {
            var currentDay = sortedDates[day];
            var locale = data.last['org.mozilla.appInfo.appinfo'].locale;

            // If the current day has an entry for crashes, use this day for
            // the last crash date, break and return.
            if (typeof data.days[currentDay]['org.mozilla.crashes.crashes'] !== 'undefined') {
                // pass the locale found stored in the payload, and use en-US as a fallback.
                lastCrashDate = new Date(currentDay).toLocaleDateString([locale, 'en-US']);
                break;
            }
        }
    }
    return lastCrashDate;
};

var getBookmarksTotal = function(days) {
    var sortedDates = sortDates(days, true);
    var bookmarksTotal = 0;

    // Loop through the dates from latest to eldest.
    for (var day in sortedDates) {
        if (sortedDates.hasOwnProperty(day)) {
            var currentDay = sortedDates[day];
            var places = days[currentDay]['org.mozilla.places.places'];

            if (typeof places !== 'undefined') {
                bookmarksTotal = places.bookmarks;
            }
        }
    }
    return bookmarksTotal;
};

// Total up crashes for current day.
var calculateCrashesTotal = function(crashes) {
    var crashesTotal = 0;

    // If the current day has an entry for crashes, get in deeper
    // and look for the pending and submitted entries and total up.
    if (typeof crashes !== 'undefined') {
        // Do we have pending crashes
        if (typeof crashes.pending !== 'undefined') {
            crashesTotal += crashes.pending;
        }

        // Do we have submitted crashes
        if (typeof crashes.submitted !== 'undefined') {
            crashesTotal += crashes.submitted;
        }
    }
    return crashesTotal;
};

// Calculate the total number of crashes for a period of time.
// Currently support week, month and all, which is the default.
var getTotalNumberOfCrashes = function(period, customPayload) {
    var crashesTotal = 0;
    var days = customPayload ? customPayload.data.days : payload.data.days;

    for (var day in days) {
        if (days.hasOwnProperty(day)) {
            var crashes = days[day]['org.mozilla.crashes.crashes'];

            if (period !== 'all') {
                var today = new Date();
                // Test whether the current date falls within the last week.
                var weekCondition = days[day] >= today - ONE_WEEK;
                var monthCondition = isCurrentMonth(day);
                var condition = period === 'week' ? weekCondition : monthCondition;

                if (condition) {
                    crashesTotal += calculateCrashesTotal(crashes);
                }
            } else {
                crashesTotal += calculateCrashesTotal(crashes);
            }
        }
    }
    return crashesTotal;
};

var getSessionsCount = function(customPayload) {
    var days = customPayload ? customPayload.data.days : payload.data.days;
    var cleanSessions = 0;
    var abortedSessions = 0;

    for (var day in days) {
        if (days.hasOwnProperty(day)) {
            var sessionsInfo = days[day]['org.mozilla.appSessions.previous'];

            // Test whether the current day contains either session or crash
            // data. If so, increment the session count.
            if (typeof sessionsInfo !== 'undefined') {
                // If there is a cleanTotalTime entry, get its length as
                // this indicates the number of sessions.
                if (typeof sessionsInfo.cleanTotalTime !== 'undefined') {
                    cleanSessions += sessionsInfo.cleanTotalTime.length;
                }

                // If there is an abortedTotalTime entry, get its length as
                // this indicates the number of sessions.
                if (typeof sessionsInfo.abortedTotalTime !== 'undefined') {
                    abortedSessions += sessionsInfo.abortedTotalTime.length;
                }
            }
        }
    }

    return cleanSessions + abortedSessions;
};

// Computes the median of an array of values.
var computeMedian = function(values) {
    if (values.length === 0) {
        return null;
    }
    if (values.length === 1) {
        return values[0];
    }
    values.sort(function(a, b) { return a - b; });
    var half = Math.floor(values.length / 2);
    if (values.length % 2)
        return values[half];
    else
        return (values[half - 1] + values[half]) / 2;
};

// Gets all startup times (paintTimes), or the median for each day over
// the past 14 days. Data will be returned as an obejct as follows:
// graphData = {
//     dateCount: 2,
//     startupTimes: [['1360108800000', 657], ['1360108800000', 989]]
// }
var getAllStartupTimes = function(median) {
    var days = payload.data.days;
    var graphData = {
            dateCount: 0,
            startupTimes: []
        };
    var sortedDates = sortDates(payload.data.days, false);
    var today = new Date();
    var twoWeeksAgo = new Date(today - TWO_WEEKS);

    for (var day in sortedDates) {
        var currentDay = sortedDates[day];

        // For our comparison in the below 'if' statement,
        // we need currentDay as a Date object.
        var currentDayAsDate = new Date(currentDay);

        // We only want to display startup times for at most the last 14 days.
        if (currentDayAsDate >= twoWeeksAgo && sortedDates.hasOwnProperty(day)) {
            var sessionsInfo = days[currentDay]['org.mozilla.appSessions.previous'];
            var paintTimes = null;
            var paintTimesLength = 0;
            var paintTime = 0;
            var startupTimesTotal = 0;

            // Test whether the current day contains either session or crash
            // data. If so, increment the session count.
            if (typeof sessionsInfo !== 'undefined') {
                paintTimes = sessionsInfo.firstPaint;
                paintTimesLength = paintTimes.length;

                // For each day for which we have data, increase the dateCount.
                ++graphData.dateCount;

                // First test whether we need to return the median startup times.
                if (median) {
                    // If we have more than one sessions paint time for the day
                    // we need to calculate the median.
                    if (paintTimesLength > 1) {
                        var validTimes = [];

                        for (paintTime in paintTimes) {
                            // If paint time is greater than our threshold or negative, ignore it as it is
                            // probably bad data @see https://bugzilla.mozilla.org/show_bug.cgi?id=856315#c30
                            if (paintTimes.hasOwnProperty(paintTime) &&
                                (paintTimes[paintTime] > 0 && paintTimes[paintTime] < PAINT_TIME_THRESHOLD)) {
                                validTimes.push(paintTimes[paintTime]);
                            }
                        }
                        // Calculate the median, convert to seconds and push onto array
                        if (validTimes.length > 0) {
                            graphData.startupTimes.push([new Date(currentDay).getTime(), computeMedian(validTimes) / 1000]);
                        }
                    } else {
                        // This day only has one session, convert to seconds, no need to calculate
                        // a median.
                        if (paintTimes[paintTime] > 0 && paintTimes[paintTime] < PAINT_TIME_THRESHOLD) {
                            graphData.startupTimes.push([new Date(currentDay).getTime(), paintTimes[paintTime] / 1000]);
                        }
                    }
                } else {
                    for (paintTime in paintTimes) {
                        if (paintTimes[paintTime] > 0 && paintTimes[paintTime] < PAINT_TIME_THRESHOLD) {
                            graphData.startupTimes.push([new Date(currentDay).getTime(), paintTimes[paintTime] / 1000]);
                        }
                    }
                }
            }
        }
    }
    var latest = new Date().getTime();
    // Add one more for the current day.
    var currentPaintTime = payload.data.last['org.mozilla.appSessions.current'].firstPaint;

    if (currentPaintTime > 0 && currentPaintTime < PAINT_TIME_THRESHOLD) {
        graphData.dateCount = graphData.dateCount + 1;
        // Add the current session's startup time to the end of the array
        graphData.startupTimes.push([
            latest,
            currentPaintTime / 1000
        ]);
    }

    return graphData;
};

// This calculates our median startup time to determine whether
// we have a slow fox. For details:
// @see https://bugzilla.mozilla.org/show_bug.cgi?id=849879
var calculateMedianStartupTime = function() {
    var days = payload.data.days;
    var sortedDates = sortDates(days, true);
    var counter = 0;
    var median = 0;
    var startupTimes = [];

    for (var day in sortedDates) {
        if (sortedDates.hasOwnProperty(day)) {
            var currentDay = sortedDates[day];
            var sessionsInfo = days[currentDay]['org.mozilla.appSessions.previous'];
            var paintTimes = null;

            // Do we have session info?
            if (typeof sessionsInfo !== 'undefined') {
                paintTimes = sessionsInfo.firstPaint;

                // We only want the latest 10 paint times,
                // and ensure that we have paint times to add.
                if (counter < 10 && typeof paintTimes !== 'undefined') {
                    for (var paintTime in paintTimes) {
                        if (paintTime > 0 && paintTime < PAINT_TIME_THRESHOLD) {
                            startupTimes.push(paintTimes[paintTime]);
                            ++counter;
                        }
                    }
                }
            }
        }
        // Sort the paint times from fastest to slowest
        startupTimes.sort().reverse();

        // Get items 7 and 8 (75th percentile), then calculate the average
        median = Math.round(((startupTimes[6]) + (startupTimes[7]) / 2));

    }
    // Covert the median to seconds before returning.
    return median / 1000;
};

/**
 * Returns addon stats using old HealthReport data format
 * for extensions and plugins. This is kept for backwards
 * compatibility untill sunset of Fx ESR24
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=966871#c0
 * @param {object} addonState - Empty addonsState object to populate and return
 * @param {array} addons - Array of addons from org.mozilla.addons.active
 * @param {string} type - The type of addon to include in calculation
 * @return populated addonsState object.
 */
var getAddonsForPreviousDataFormat = function(addonStats, addons, type) {
    for (var addon in addons) {
        if (addons.hasOwnProperty(addon) && typeof addons[addon].type !== 'undefined') {
            var currentAddon = addons[addon];
            // Only total addons of the type specified.
            if (currentAddon.type !== type) {
                continue;
            }

            if (currentAddon.userDisabled === 'askToActivate') {
                ++addonStats.clickToPlay;
            } else if (currentAddon.userDisabled || currentAddon.appDisabled) {
                ++addonStats.disabled;
            } else {
                ++addonStats.enabled;
            }
        }
    }
    return addonStats;
};

/**
 * Returns addon stats for the extensions addon type.
 * @param {object} addonState - Empty addonsState object to populate and return
 * @param {array} addons - Array of addons from org.mozilla.addons.addons
 * @return populated addonsState object.
 */
var getExtensionsStats = function(addonStats, extensions) {
    for (var extension in extensions) {
        // The extensions array contains an additional element indicating the version of the API so,
        // we need to make sure that we are dealing with an actual extension therefore, check that
        // the type property exists.
        if (extensions.hasOwnProperty(extension) && typeof extensions[extension].type !== 'undefined') {
            var currentExtension = extensions[extension];

            if (currentExtension.userDisabled === 'askToActivate') {
                ++addonStats.clickToPlay;
            } else if (currentExtension.userDisabled || currentExtension.appDisabled) {
                ++addonStats.disabled;
            } else {
                ++addonStats.enabled;
            }
        }
    }
    return addonStats;
};

/**
 * Returns addon stats for the plugin addon type.
 * @param {object} addonState - Empty addonsState object to populate and return
 * @param {array} addons - Array of addons from org.mozilla.addons.plugins
 * @return populated addonsState object.
 */
var getPluginsStats = function(addonStats, plugins) {
    for (var plugin in plugins) {
        // The plugins array contains an additional element indicating the version of the API so,
        // we need to make sure that we are dealing with an actual plugin therefore, check that
        // the name property exists.
        if (plugins.hasOwnProperty(plugin) && typeof plugins[plugin].name !== 'undefined') {
            var currentPlugin = plugins[plugin];

            if (currentPlugin.clicktoplay) {
                ++addonStats.clickToPlay;
            } else if (currentPlugin.disabled || currentPlugin.blocklisted) {
                ++addonStats.disabled;
            } else {
                ++addonStats.enabled;
            }
        }
    }
    return addonStats;
};

/**
 * Returns an addonsState object indicating the number of addons that are
 * either enabled or disabled.
 * @param {object} healthreport - The JSON object
 * @param {string} type - The type of addon to collect information about. Possible values extension and plugin
 * @returns A populated addonsStats object.
 */
var getAddonStats = function(healthreport, type) {
    var data = healthreport.data.last;
    var addons = data['org.mozilla.addons.active'];
    var addonStats = {
            enabled: 0,
            disabled: 0,
            clickToPlay: 0
        };

    if (type === 'extension') {
        if (typeof addons === 'undefined') {
            addonStats = getExtensionsStats(addonStats, data['org.mozilla.addons.addons']);
        } else {
            addonStats = getAddonsForPreviousDataFormat(addonStats, addons, type);
        }
    } else {
        if (typeof addons === 'undefined') {
            addonStats = getPluginsStats(addonStats, data['org.mozilla.addons.plugins']);
        } else {
            addonStats = getAddonsForPreviousDataFormat(addonStats, addons, type);
        }
    }

    return addonStats;
};

// Populates the front end templates located in index.html.
var populateData = function(healthreport) {
    // Get all containers for the data.
    var vitalStatsValueContainers = $('#vital_stats .statsBoxSection-value');
    var currentMonthValueContainers = $('#current_month .statsBoxSection-value');
    var addonsValueContainers = $('#addons .statsBoxSection-value');
    var pluginValuesContainer = $('#plugins .statsBoxSection-value');
    var vitalStats = [];
    var thisMonth = [];
    var addons = [];
    var plugins = [];
    var extensionsInfo = getAddonStats(healthreport, 'extension');
    var pluginsInfo = getAddonStats(healthreport, 'plugin');

    // Create all of the needed data arrays.
    vitalStats.push(healthreport.geckoAppInfo.platformVersion);
    vitalStats.push(calculateTotalTime(healthreport, true) + ' min');
    vitalStats.push(getLastCrashDate(healthreport.data));
    vitalStats.push(getBookmarksTotal(healthreport.data.days));

    thisMonth.push(calculateTotalTime(healthreport, false) + ' min');
    thisMonth.push(getTotalNumberOfCrashes('month'));

    addons.push(extensionsInfo.enabled);
    addons.push(extensionsInfo.disabled);

    plugins.push(pluginsInfo.enabled);
    plugins.push(pluginsInfo.clickToPlay);
    plugins.push(pluginsInfo.disabled);

    // Populate vital statistics.
    vitalStatsValueContainers.each(function(index) {
        $(this).text(vitalStats[index]);
    });

    // Populate data for this month.
    currentMonthValueContainers.each(function(index) {
        $(this).text(thisMonth[index]);
    });

    // Populate data for addons.
    addonsValueContainers.each(function(index) {
        $(this).text(addons[index]);
    });

    // Populate data for plugins.
    pluginValuesContainer.each(function(index) {
        $(this).text(plugins[index]);
    });
};

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
    case 'payload':
        payload = JSON.parse(event.data.content);
        populateData(payload);
        document.querySelector('.rawdata-display pre').textContent = JSON.stringify(payload, null, 2);
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
    sendToBrowser('RequestCurrentPayload');
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
