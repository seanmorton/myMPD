"use strict";
// SPDX-License-Identifier: GPL-3.0-or-later
// myMPD (c) 2018-2026 Juergen Mang <mail@jcgames.de>
// https://github.com/jcorporation/mympd

/** @module localplayback_js */

/**
 * Initializes the local playback related elements
 * @returns {void}
 */
function initLocalPlayback() {
    elGetById('localPlaybackVolumeBar').addEventListener('change', function(event) {
        setLocalPlaybackVolume(Number(event.target.value));
    }, false);
    // @ts-ignore
    elGetById('localPlayer').volume = 0.5;

    if (features.featLocalPlaybackOutput === true) {
        const localPlayerDeviceSelectEl = elGetById('localPlayerDeviceSelect');
        localPlayerDeviceSelectEl.addEventListener('focus', async () => {
            await navigator.mediaDevices.getUserMedia({
                audio: true,
            });
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioOutputs = devices.filter(
                (device) =>
                    device.kind === 'audiooutput' && device.deviceId !== 'default',
            );

            elClear(localPlayerDeviceSelectEl);
            localPlayerDeviceSelectEl.appendChild(
                elCreateTextTn('option', {'value': ''}, 'Default output device')
            );
            audioOutputs.forEach((device) => {
                localPlayerDeviceSelectEl.appendChild(
                    elCreateText('option', {'value': device.deviceId}, device.label)
                );
            });
        }, false);

        localPlayerDeviceSelectEl.addEventListener('change', async () => {
            const value = getSelectValue(localPlayerDeviceSelectEl);
            await elGetById('localPlayer').setSinkId(value);
        });
    }
}

/**
 * Changes the local volume by +/-10%
 * @param {string} dir direction, up or down
 * @returns {void}
 */
//eslint-disable-next-line no-unused-vars
function localPlaybackVolumeStep(dir) {
    const increment = dir === 'up'
        ? 0.1
        : -0.1;
    const volumeBar = elGetById('localPlaybackVolumeBar');
    let newValue = Number(volumeBar.value) + increment;
    if (newValue < 0) {
        newValue = 0;
    }
    else if (newValue > 1) {
        newValue = 1;
    }
    volumeBar.value = newValue;
    setLocalPlaybackVolume(newValue);
}

/**
 * Sets local playback volume
 * @param {number} volume volume to set
 * @returns {void}
 */
function setLocalPlaybackVolume(volume) {
    // @ts-ignore
    elGetById('localPlayer').volume = volume;
}

/**
 * Sets the local playback state
 * @param {string} newState one of play, stop, pause
 * @returns {void}
 */
function controlLocalPlayback(newState) {
    // TODO test this plays nice with autoplay
    if (features.featLocalPlayback === false ||
        localSettings.localPlaybackAutoplay === false)
    {
        return;
    }
    const el = elGetById('localPlaybackBtn');
    const curState = getData(el, 'state');

    switch(newState) {
        case 'play':
            if (curState === 'stop' ||
                curState === undefined)
            {
                el.click();
            }
            break;
        case 'stop':
        case 'pause':
            if (curState === 'play') {
                el.click();
            }
            break;
        default:
            logError('Invalid state: ' + newState);
    }
}

/**
 * Compares the playback's current time to a previous time to ensure
 * playback is progressing. If playback time has not progressed enough,
 * the local playback state is transitioned to error.
 *
 * This is a reliable way to detect when playback has meaningfully stalled,
 * when audio playback has stopped but the stream has not explicitly failed.
 * An alternative would be to fail fast on the element's stalled event,
 * but this approach is usually too eager. Often times, playback quickly
 * self-recovers from brief stalls and an error state can be avoided.
 *
 * @param {prevCurrentTime} the last playback time reading to compare to
 * @returns {void}
 */
function checkPlaybackProgress(prevCurrentTime) {
    logWarn('Checking local playback progress');
    const el = elGetById('localPlaybackBtn');
    const curState = getData(el, 'state');
    const localPlayer = elGetById('localPlayer');
    if (curState === 'stop' || !localPlayer) {
        logDebug('Playback has stopped, exiting playback progress check');
        localPlaybackProgressTimer = null;
        return;
    }

    // If playback hasn't progressed at least 50% of the last window, fail
    const minProgressThreshold = localPlaybackProgressDelay / 1000 / 2;
    const currentTime = localPlayer.currentTime;
    if (currentTime - prevCurrentTime < minProgressThreshold) {
      logError("Local playback hasn't progressed enough, transitioning to error state");
      localPlaybackProgressTimer = null;
      onLocalPlaybackError('watchdog');
      return;
    }

    logWarn(`Playback progress is healthy, checking again in ${localPlaybackProgressDelay / 1000}s`);
    localPlaybackProgressTimer = setTimeout(() => checkPlaybackProgress(currentTime), localPlaybackProgressDelay);
}

// TODO remove errText after debugging
function onLocalPlaybackError(errText) {
    localPlaybackReconnectCurRetry += 1;
    // TODO remove debug ui
    const msg = elGetById('errorLocalPlayback');
    elReplaceChild(msg,
        elCreateText('span', {}, 'Stream failed: ' + errText + '; retry #' + localPlaybackReconnectCurRetry)
    );
    // end TODO

    const el = elGetById('localPlaybackBtn');
    elShowId('errorLocalPlayback');
    elClear(el);
    elReplaceChild(el,
        elCreateText('span', {"class": ["mi"]}, 'stop')
    );
    btnWaiting(el, false);

    clearTimeout(localPlaybackProgressTimer);
    localPlaybackProgressTimer = null;

    if (localPlaybackReconnectCurRetry >= localPlaybackReconnectMaxRetries) {
        logWarn('Max retry attempts met');
        setData(el, 'state', 'stop');
        elReplaceChild(el,
            elCreateText('span', {"class": ["mi"]}, 'play_arrow')
        );
        elClear(domCache.localPlayerProgress);
        return;
    }


    // TODO feature flag?
    if (localPlaybackReconnectTimer === null) {
        logWarn('Starting local playback auto-reconnect timer');
        localPlaybackReconnectTimer = setTimeout(() => {
            logDebug('Attempting local playback auto-reconnect');

            const localPlayer = elGetById('localPlayer');
            if (!localPlayer) {
              logWarn('local player not found, bailing on retry');
              return;
            }
            elClear(el);
            btnWaiting(el, true);
            localPlayer.load();
            localPlayer.play();

            localPlaybackReconnectTimer = null;
        }, localPlaybackReconnectDelay);
    }
}

/**
 * Creates the local playback element
 * @param {Event} createEvent triggering event
 * @returns {void}
 */
//eslint-disable-next-line no-unused-vars
function createLocalPlaybackEl(createEvent) {
    createEvent.stopPropagation();
    const el = createEvent.target.nodeName === 'SPAN' ?
        createEvent.target.parentNode :
        createEvent.target;
    const curState = getData(el, 'state');
    elReplaceChild(el,
        elCreateText('span', {"class": ["mi"]}, 'play_arrow')
    );

    //stop playback off old audio element
    const curAudioEl = elGetById('localPlayer');
    curAudioEl.setAttribute('disabled', 'disabled');
    // @ts-ignore
    curAudioEl.pause();
    // @ts-ignore
    curAudioEl.removeAttribute('src');
    curAudioEl.load();

    // Clear out previous progress and reconnect state
    elHideId('errorLocalPlayback');
    localPlaybackReconnectCurRetry = 0;
    clearTimeout(localPlaybackProgressTimer);
    clearTimeout(localPlaybackReconnectTimer);
    localPlaybackProgressTimer = null;
    localPlaybackReconnectTimer = null;

    // remember current settings
    const oldSinkId = features.featLocalPlaybackOutput === true
        ? curAudioEl.sinkId
        : 0;
    // @ts-ignore
    const oldVolume = curAudioEl.volume;

    //replace old audio element
    const parent = curAudioEl.parentNode;
    curAudioEl.remove();
    /** @type {HTMLAudioElement} */
    // @ts-ignore
    const localPlayer = elCreateEmpty('audio', {"class": ["mx-4"], "preload": "none", "id": "localPlayer"});
    localPlayer.volume = oldVolume;
    if (features.featLocalPlaybackOutput === true) {
        localPlayer.setSinkId(oldSinkId);
    }
    parent.appendChild(localPlayer);


    //add event handlers
    localPlayer.addEventListener('canplay', function(event) {
        logDebug('localPlayer event: canplay');
        localPlaybackReconnectCurRetry = 0;
        elHideId('errorLocalPlayback');
        setData(el, 'state', 'play');
        btnWaiting(el, false);
        elReplaceChild(el,
            elCreateText('span', {"class": ["mi"]}, 'stop')
        );

        if (localPlaybackProgressTimer === null) {
          logWarn('Starting local playback progress check');
          const currentTime = event.target.currentTime;
          localPlaybackProgressTimer = setTimeout(() => checkPlaybackProgress(currentTime), localPlaybackProgressDelay);
        }
    });
    localPlayer.addEventListener('timeupdate', function(event) {
        // @ts-ignore
        if (isNaN(event.target.currentTime)) {
            return;
        }
        // @ts-ignore
        domCache.localPlayerProgress.textContent = fmtSongDuration(event.target.currentTime);
    });
    if (features.featLocalPlaybackVolume === true) {
        localPlayer.addEventListener('volumechange', function(event) {
            // @ts-ignore
            elGetById('localPlaybackVolumeBar').value = elGetById('localPlayer').volume;
            elGetById('localPlaybackVolume').textContent = Math.floor(
                // @ts-ignore
                event.target.volume * 100) + ' %';
        });
    }

    for (const ev of ['error', 'ended']) {
        localPlayer.addEventListener(ev, function(event) {
            // @ts-ignore
            if (event.target.error &&
                // @ts-ignore
                event.target.error.code === 3)
            {
                //ignore NS_ERROR_DOM_MEDIA_MEDIASINK_ERR
                return;
            }
            logError('localPlayer event: ' + ev);
            onLocalPlaybackError(ev);

        });
    }

    if (curState === undefined ||
        curState === 'stop')
    {
        //load and play
        localPlayer.src = settings.partition.streamUri || (getMyMPDuri() + '/stream/' + localSettings.partition);
        // localPlayer.load();  yo not needed: https://html.spec.whatwg.org/multipage/media.html#location-of-the-media-resource
        localPlayer.play();
        elClear(el);
        btnWaiting(el, true);
        elGetById('localPlaybackVolumeBar').value = localPlayer.volume;
        elGetById('localPlaybackVolume').textContent = Math.round(localPlayer.volume * 100).toString() + ' %';
    }
    else {
        setData(el, 'state', 'stop');
        elClear(domCache.localPlayerProgress);
    }
}
