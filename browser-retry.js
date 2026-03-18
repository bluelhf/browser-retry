// The back-off, in milliseconds, that should be used when re-trying for the first time.
// The back-off is the duration between retries and increases exponentially with the number of retries.
// For Chrome versions <120, back-offs less than one minute (60 000) will likely be inaccurate in production.
// For Chrome versions >120, back-offs less than 30 seconds (30 000) will likely be inaccurate in production.
const BROWSER_RETRY_INITIAL_BACKOFF = 5000; // 5 seconds

// The maximum back-off is the maximum delay between requests excluding the jitter.
const BROWSER_RETRY_MAXIMUM_BACKOFF = 60000; // 1 minute

// The jitter, in milliseconds, that should be used with re-tries.
// If multiple browsers use this extension, navigation failures may synchronise and cause spikes
// in traffic for the target website. Jitter prevents this by spreading out the requests.
const BROWSER_RETRY_JITTER = 2500; // 2.5 seconds

const _browser = typeof browser === 'undefined' ? chrome : browser;

async function handleTabError(tabIdentifier, type) {
    await deleteRetryStateForTab(tabIdentifier);
    const retriesSoFar = (await getRetryCount(tabIdentifier)) || 0;
    const backoff = Math.min(BROWSER_RETRY_MAXIMUM_BACKOFF, BROWSER_RETRY_INITIAL_BACKOFF * Math.pow(2, retriesSoFar));
    const jitter = Math.round(Math.random() * BROWSER_RETRY_JITTER);
    const timeToWaitInMilliseconds = backoff + jitter;

    if (await getAlarmForTab(tabIdentifier)) {
        console.debug(`Browser Retry detected another error on tab ${tabIdentifier}, but a new reload was not scheduled because one is already pending.`);
        return;
    }

    await setAlarmForTab(tabIdentifier, timeToWaitInMilliseconds);
    console.log(`Browser Retry detected a ${type} error on tab ${tabIdentifier}. The current back-off is ${backoff} ms, so a reload has been scheduled ${timeToWaitInMilliseconds} ms from now.`);
}

async function handleTabSuccess(tabIdentifier, type) {
    const retryState = await addRetryStateForTab(tabIdentifier, type);
    switch (retryState) {
        case "full": {
            await deleteRetryCount(tabIdentifier);
            await deleteAlarmForTab(tabIdentifier);
            await deleteRetryStateForTab(tabIdentifier);
            console.log(`Browser Retry detected a successful load of tab ${tabIdentifier}.`);
            return;
        }
        case "navigation":
        case "web request": {
            console.debug(`Browser Retry detected ${retryState} success on tab ${tabIdentifier}. This is insufficient to consider it to be working.`);
            return;
        }
    }
}

browser.webRequest.onCompleted.addListener(async details => {
    if (details.tabId < 0) return;

    if (details.statusCode >= 400 && details.statusCode < 600) await handleTabError(details.tabId, "web request");
    else await handleTabSuccess(details.tabId, "web request");
}, { urls: ["<all_urls>"], types: ["main_frame"] });


_browser.webNavigation.onErrorOccurred.addListener(async (details) => {
    await handleTabError(details.tabId, "navigation")
});

_browser.webNavigation.onCommitted.addListener(async details => {
    await handleTabSuccess(details.tabId, "navigation");
});

_browser.alarms.onAlarm.addListener(async alarm => {
    if (!alarm.name.startsWith(BROWSER_RETRY_RELOAD_PREFIX)) return;

    const tabIdentifier = getTabForAlarm(alarm);
    const details = await _browser.tabs.get(tabIdentifier).catch(() => undefined);
    if (!details) {
        console.log("Browser Retry did not perform a scheduled reload, because the tab was closed before the retry timeout expired.");
        await deleteRetryCount(tabIdentifier);
        return;
    }

    const retriesSoFar = (await getRetryCount(tabIdentifier)) || 0;

    const relativeTime = alarm.scheduledTime - Date.now();
    const relativePhrase = (
      relativeTime === 0
        ? "exactly as scheduled"
        : (relativeTime < 0
          ? `${-relativeTime} ms earlier than scheduled`
          : `$relativeTime ms later than scheduled`));

    console.debug(`Browser Retry is performing scheduled reload #${retriesSoFar + 1} for tab ${tabIdentifier} ${relativePhrase}.`);

    await setRetryCount(tabIdentifier, retriesSoFar + 1);
    await _browser.tabs.reload(tabIdentifier);
});

const BROWSER_RETRY_STATE_SET_PREFIX = "browser-retry:retry-state-set:";
function getRetryStateSetKeyForTab(tabIdentifier) {
    return `${BROWSER_RETRY_STATE_SET_PREFIX}${tabIdentifier}`;
}

function getRetryState(stateSet) {
    if (stateSet.has("web request") && stateSet.has("navigation")) {
        return "full";
    }
    if (stateSet.has("web request")) return "web request";
    if (stateSet.has("navigation")) return "navigation";
    return "none";
}

const internal = (() => {
    async function getRetryStateSetForTab(tabIdentifier) {
        return new Set((await _browser.storage.session.get({ [getRetryStateSetKeyForTab(tabIdentifier)]: [] }))[getRetryStateSetKeyForTab(tabIdentifier)]);
    }

    async function setRetryStateSetForTab(tabIdentifier, value) {
        await _browser.storage.session.set({ [getRetryStateSetKeyForTab(tabIdentifier)]: value });
    }

    return {getRetryStateSetForTab, setRetryStateSetForTab};
})();

async function addRetryStateForTab(tabIdentifier, type) {
    const stateSet = await internal.getRetryStateSetForTab(tabIdentifier);
    stateSet.add(type);

    await internal.setRetryStateSetForTab(tabIdentifier, [...stateSet]);
    return getRetryState(stateSet);
}

async function deleteRetryStateForTab(tabIdentifier) {
    await _browser.storage.session.remove(getRetryStateSetKeyForTab(tabIdentifier));
}

const BROWSER_RETRY_RELOAD_PREFIX = "browser-retry:reload:";

function getAlarmNameForTab(tabIdentifier) {
    return `${BROWSER_RETRY_RELOAD_PREFIX}${tabIdentifier}`;
}

async function getAlarmForTab(tabIdentifier) {
    return await _browser.alarms.get(getAlarmNameForTab(tabIdentifier));
}

async function setAlarmForTab(tabIdentifier, timeToWaitInMilliseconds) {
    await _browser.alarms.create(getAlarmNameForTab(tabIdentifier),
        { when: Date.now() + timeToWaitInMilliseconds });
}

async function deleteAlarmForTab(tabIdentifier) {
    await _browser.alarms.clear(getAlarmNameForTab(tabIdentifier));
}

function getTabForAlarm(alarm) {
    // As per specification, tabId is a Number, which includes floats.
    // For integer values, parseFloat will return an equivalent Number to parseInt.
    return parseFloat(alarm.name.substring(BROWSER_RETRY_RELOAD_PREFIX.length));
}

const BROWSER_RETRY_RETRIES_PREFIX = "browser-retry:retries:";

function getStorageIndexForTab(tabIdentifier) {
    return `${BROWSER_RETRY_RETRIES_PREFIX}${tabIdentifier}`;
}

async function getRetryCount(tabIdentifier) {
    const index = getStorageIndexForTab(tabIdentifier);
    return (await _browser.storage.session.get({ [index]: 0 }))[index];
}

async function setRetryCount(tabIdentifier, retries) {
    await _browser.storage.session.set({ [getStorageIndexForTab(tabIdentifier)]: retries });
}

async function deleteRetryCount(tabIdentifier) {
    await _browser.storage.session.remove(getStorageIndexForTab(tabIdentifier));
}

browser.alarms.clearAll().then(_ => { /* fire-and-forget */ });
console.log("Browser Retry service worker is up and running.");
console.log(`Will start with ${BROWSER_RETRY_INITIAL_BACKOFF} ms back-off, then advance exponentially to ${BROWSER_RETRY_MAXIMUM_BACKOFF} ms.`);
console.log(`Request times will jitter between 0 and ${BROWSER_RETRY_JITTER} ms.`);
