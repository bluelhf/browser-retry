// The back-off, in milliseconds, that should be used when re-trying for the first time.
// The back-off is the duration between retries and increases exponentially with the number of retries.
// For Chrome versions <120, back-offs less than one minute (60 000) will likely be inaccurate in production.
// For Chrome versions >120, back-offs less than 30 seconds (30 000) will likely be inaccurate in production.
const CHROME_RETRY_INITIAL_BACKOFF = 5000; // 5 seconds

// The maximum back-off is the maximum delay between requests excluding the jitter.
const CHROME_RETRY_MAXIMUM_BACKOFF = 60000; // 1 minute

// The jitter, in milliseconds, that should be used with re-tries.
// If multiple browsers use this extension, navigation failures may synchronise and cause spikes
// in traffic for the target website. Jitter prevents this by spreading out the requests.
const CHROME_RETRY_JITTER = 2500; // 2.5 seconds

chrome.webNavigation.onErrorOccurred.addListener(async details => {
    const tabIdentifier = details.tabId;

    const retriesSoFar = (await getRetryCount(tabIdentifier)) || 0;
    const backoff = Math.min(CHROME_RETRY_MAXIMUM_BACKOFF, CHROME_RETRY_INITIAL_BACKOFF * Math.pow(2, retriesSoFar));
    const jitter = Math.round(Math.random() * CHROME_RETRY_JITTER);
    const timeToWaitInMilliseconds = backoff + jitter;

    if (await getAlarmForTab(tabIdentifier)) {
        console.log(`Chrome Retry detected another navigation error for tab ${tabIdentifier}, but a new reload was not scheduled because one is already pending.`);
        return;
    }

    await setAlarmForTab(tabIdentifier, timeToWaitInMilliseconds);
    console.log(`Chrome Retry detected a navigation error for tab ${tabIdentifier}. The current back-off is ${backoff}, so a reload has been scheduled ${timeToWaitInMilliseconds} milliseconds from now.`);
});

chrome.webNavigation.onCommitted.addListener(async details => {
    const tabIdentifier = details.tabId;

    if (typeof(await getRetryCount(tabIdentifier)) !== "undefined") {
        await deleteRetryCount(tabIdentifier);
        await deleteAlarmForTab(tabIdentifier);
        console.log(`Chrome Retry detected that tab ${tabIdentifier} was loaded successfully, so its retry count was reset and any scheduled reloads cancelled.`);
    }
});

chrome.alarms.onAlarm.addListener(async alarm => {
    if (!alarm.name.startsWith(CHROME_RETRY_RELOAD_PREFIX)) return;

    const tabIdentifier = getTabForAlarm(alarm);
    const details = await chrome.tabs.get(tabIdentifier).catch(() => undefined);
    if (!details) {
        console.log("Chrome Retry did not perform a scheduled reload, because the tab was closed before the retry timeout expired.");
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

    console.log(`Chrome Retry is performing scheduled reload #${retriesSoFar + 1} for tab ${tabIdentifier} ${relativePhrase}.`);

    await setRetryCount(tabIdentifier, retriesSoFar + 1);
    await chrome.tabs.reload(tabIdentifier);
});


const CHROME_RETRY_RELOAD_PREFIX = "chrome-retry:reload:";

function getAlarmNameForTab(tabIdentifier) {
    return `${CHROME_RETRY_RELOAD_PREFIX}${tabIdentifier}`;
}

async function getAlarmForTab(tabIdentifier) {
    return await chrome.alarms.get(getAlarmNameForTab(tabIdentifier));
}

async function setAlarmForTab(tabIdentifier, timeToWaitInMilliseconds) {
    await chrome.alarms.create(getAlarmNameForTab(tabIdentifier),
        { when: Date.now() + timeToWaitInMilliseconds });
}

async function deleteAlarmForTab(tabIdentifier) {
    await chrome.alarms.clear(getAlarmNameForTab(tabIdentifier));
}

function getTabForAlarm(alarm) {
    // As per specification, tabId is a Number, which includes floats.
    // For integer values, parseFloat will return an equivalent Number to parseInt.
    return parseFloat(alarm.name.substring(CHROME_RETRY_RELOAD_PREFIX.length));
}

const CHROME_RETRY_RETRIES_PREFIX = "chrome-retry:retries:";

function getStorageIndexForTab(tabIdentifier) {
    return `${CHROME_RETRY_RETRIES_PREFIX}${tabIdentifier}`;
}

async function getRetryCount(tabIdentifier) {
    const index = getStorageIndexForTab(tabIdentifier);
    return (await chrome.storage.session.get({ [index]: 0 }))[index];
}

async function setRetryCount(tabIdentifier, retries) {
    await chrome.storage.session.set({ [getStorageIndexForTab(tabIdentifier)]: retries });
}

async function deleteRetryCount(tabIdentifier) {
    await chrome.storage.session.remove(getStorageIndexForTab(tabIdentifier));
}

chrome.alarms.clearAll();
console.log("Chrome Retry service worker is up and running.");
console.log(`Will start with ${CHROME_RETRY_INITIAL_BACKOFF} ms back-off, then advance exponentially to ${CHROME_RETRY_MAXIMUM_BACKOFF} ms.`);
console.log(`Request times will jitter between 0 and ${CHROME_RETRY_JITTER} ms.`);
