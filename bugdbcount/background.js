// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var animationFrames = 36;
var animationSpeed = 10; // ms
var canvas = document.getElementById('canvas');
var loggedInImage = document.getElementById('logged_in');
var canvasContext = canvas.getContext('2d');
var pollIntervalMin = 5;  // 5 minutes
var pollIntervalMax = 60;  // 1 hour
var requestTimeout = 1000 * 2;  // 2 seconds
var rotation = 0;
var loadingAnimation = new LoadingAnimation();

// Legacy support for pre-event-pages.
var oldChromeVersion = !chrome.runtime;
var requestTimerId;

function getBugDBUrl() {
  return "https://bug.oraclecorp.com";
}

function getOpenedBugUrl() {
  // "zx" is a Gmail query parameter that is expected to contain a random
  // string and may be ignored/stripped.
  return getBugDBUrl() + "/pls/bug/webbug_reports.my_open_bugs";
}

function isBugDBUrl(url) {
  // Return whether the URL starts with the Gmail prefix.
  return url.indexOf(getBugDBUrl()) == 0;
}

// A "loading" animation displayed while we wait for the first response from
// Gmail. This animates the badge text with a dot that cycles from left to
// right.
function LoadingAnimation() {
  this.timerId_ = 0;
  this.maxCount_ = 8;  // Total number of states in animation
  this.current_ = 0;  // Current state
  this.maxDot_ = 4;  // Max number of dots in animation
}

LoadingAnimation.prototype.paintFrame = function() {
  var text = "";
  for (var i = 0; i < this.maxDot_; i++) {
    text += (i == this.current_) ? "." : " ";
  }
  if (this.current_ >= this.maxDot_)
    text += "";

  chrome.browserAction.setBadgeText({text:text});
  this.current_++;
  if (this.current_ == this.maxCount_)
    this.current_ = 0;
}

LoadingAnimation.prototype.start = function() {
  if (this.timerId_)
    return;

  var self = this;
  this.timerId_ = window.setInterval(function() {
    self.paintFrame();
  }, 100);
}

LoadingAnimation.prototype.stop = function() {
  if (!this.timerId_)
    return;

  window.clearInterval(this.timerId_);
  this.timerId_ = 0;
}

function updateIcon() {
  if (!localStorage.hasOwnProperty('openedCount')) {
    chrome.browserAction.setIcon({path:"bugDB_not_logged_in.png"});
    chrome.browserAction.setBadgeBackgroundColor({color:[190, 190, 190, 230]});
    chrome.browserAction.setBadgeText({text:"?"});
  } else {
    chrome.browserAction.setIcon({path: "bugDB_logged_in.png"});
    chrome.browserAction.setBadgeBackgroundColor({color:[208, 0, 24, 255]});
    chrome.browserAction.setBadgeText({
      text: localStorage.openedCount != "0" ? localStorage.openedCount : ""
    });
  }
}

function scheduleRequest() {
  console.log('scheduleRequest');
  var randomness = Math.random() * 2;
  var exponent = Math.pow(2, localStorage.requestFailureCount || 0);
  var multiplier = Math.max(randomness * exponent, 1);
  var delay = Math.min(multiplier * pollIntervalMin, pollIntervalMax);
  delay = Math.round(delay);
  console.log('Scheduling for: ' + delay);

  if (oldChromeVersion) {
    if (requestTimerId) {
      window.clearTimeout(requestTimerId);
    }
    requestTimerId = window.setTimeout(onAlarm, delay*60*1000);
  } else {
    console.log('Creating alarm');
    // Use a repeating alarm so that it fires again if there was a problem
    // setting the next alarm.
    chrome.alarms.create('refresh', {periodInMinutes: delay});
  }
}

// ajax stuff
function startRequest(params) {
  // Schedule request immediately. We want to be sure to reschedule, even in the
  // case where the extension process shuts down while this request is
  // outstanding.
  if (params && params.scheduleRequest) scheduleRequest();

  function stopLoadingAnimation() {
    if (params && params.showLoadingAnimation) loadingAnimation.stop();
  }

  if (params && params.showLoadingAnimation)
    loadingAnimation.start();

  getOpenedCount(
    function(count) {
      stopLoadingAnimation();
      updateOpenedCount(count);
    },
    function() {
      stopLoadingAnimation();
      delete localStorage.openedCount;
      updateIcon();
    }
  );
}

function getOpenedCount(onSuccess, onError) {
  var xhr = new XMLHttpRequest();
  var abortTimerId = window.setTimeout(function() {
    xhr.abort();  // synchronously calls onreadystatechange
  }, requestTimeout);

  function handleSuccess(count) {
    localStorage.requestFailureCount = 0;
    window.clearTimeout(abortTimerId);
    if (onSuccess)
      onSuccess(count);
  }

  var invokedErrorCallback = false;
  function handleError() {
    ++localStorage.requestFailureCount;
    window.clearTimeout(abortTimerId);
    if (onError && !invokedErrorCallback)
      onError();
    invokedErrorCallback = true;
  }

  try {
    xhr.onreadystatechange = function() {
      if (xhr.readyState != 4)
        return;

      console.log("return data from Server");
      if (xhr.responseText) {
        var htmlContent = xhr.responseText;
        var count = parseCountFromHtml(htmlContent);
        handleSuccess(count);
         return;
      } else {
          console.error("praser count error");
      }

      handleError();
    };

    xhr.onerror = function(error) {
      handleError();
    };

    xhr.open("GET", getOpenedBugUrl(), true);
    xhr.send(null);
  } catch(e) {
    console.error("get Content from Server Error");
    handleError();
  }
}

function parseCountFromHtml(htmlContent){
	var match = new RegExp("<span id=\"selectedbugsbottom\">\\((\\d+).*</span>").exec(htmlContent);
	return match[1];
}


function updateOpenedCount(count) {
  var changed = localStorage.openedCount != count;
  localStorage.openedCount = count;
  updateIcon();
  if (changed)
    animateFlip();
}


function ease(x) {
  return (1-Math.sin(Math.PI/2+x*Math.PI))/2;
}

function animateFlip() {
  rotation += 1/animationFrames;
  drawIconAtRotation();

  if (rotation <= 1) {
    setTimeout(animateFlip, animationSpeed);
  } else {
    rotation = 0;
    updateIcon();
  }
}

function drawIconAtRotation() {
  canvasContext.save();
  canvasContext.clearRect(0, 0, canvas.width, canvas.height);
  canvasContext.translate(
      Math.ceil(canvas.width/2),
      Math.ceil(canvas.height/2));
  canvasContext.rotate(2*Math.PI*ease(rotation));
  canvasContext.drawImage(loggedInImage,
      -Math.ceil(canvas.width/2),
      -Math.ceil(canvas.height/2));
  canvasContext.restore();

  chrome.browserAction.setIcon({imageData:canvasContext.getImageData(0, 0,
      canvas.width,canvas.height)});
}

function goToBugDB() {
  console.log('Going to inbox...');
  chrome.tabs.getAllInWindow(undefined, function(tabs) {
    for (var i = 0, tab; tab = tabs[i]; i++) {
      if (tab.url && isBugDBUrl(tab.url)) {
        console.log('Found BugDB tab: ' + tab.url + '. ' +
                    'Focusing and refreshing count...');
        chrome.tabs.update(tab.id, {selected: true});
        startRequest({scheduleRequest:false, showLoadingAnimation:false});
        return;
      }
    }
    console.log('Could not find BugDB tab. Creating one...');
    chrome.tabs.create({url: getOpenedBugUrl()});
  });
}

function onInit() {
  console.log('onInit');
  localStorage.requestFailureCount = 0;  // used for exponential backoff
  startRequest({scheduleRequest:true, showLoadingAnimation:true});
  if (!oldChromeVersion) {
    // TODO(mpcomplete): We should be able to remove this now, but leaving it
    // for a little while just to be sure the refresh alarm is working nicely.
    chrome.alarms.create('watchdog', {periodInMinutes:5});
  }
}

function onAlarm(alarm) {
  console.log('Got alarm', alarm);
  // |alarm| can be undefined because onAlarm also gets called from
  // window.setTimeout on old chrome versions.
  if (alarm && alarm.name == 'watchdog') {
    onWatchdog();
  } else {
    startRequest({scheduleRequest:true, showLoadingAnimation:false});
  }
}

function onWatchdog() {
  chrome.alarms.get('refresh', function(alarm) {
    if (alarm) {
      console.log('Refresh alarm exists. Yay.');
    } else {
      console.log('Refresh alarm doesn\'t exist!? ' +
                  'Refreshing now and rescheduling.');
      startRequest({scheduleRequest:true, showLoadingAnimation:false});
    }
  });
}

if (oldChromeVersion) {
  updateIcon();
  onInit();
} else {
  chrome.runtime.onInstalled.addListener(onInit);
  chrome.alarms.onAlarm.addListener(onAlarm);
}

var filters = {
  // TODO(aa): Cannot use urlPrefix because all the url fields lack the protocol
  // part. See crbug.com/140238.
  url: [{urlContains: getBugDBUrl().replace(/^https?\:\/\//, '')}]
};

function onNavigate(details) {
  if (details.url && isBugDBUrl(details.url)) {
    console.log('Recognized BugDB navigation to: ' + details.url + '.' +
                'Refreshing count...');
    startRequest({scheduleRequest:false, showLoadingAnimation:false});
  }
}
if (chrome.webNavigation && chrome.webNavigation.onDOMContentLoaded &&
    chrome.webNavigation.onReferenceFragmentUpdated) {
  chrome.webNavigation.onDOMContentLoaded.addListener(onNavigate, filters);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(
      onNavigate, filters);
} else {
  chrome.tabs.onUpdated.addListener(function(_, details) {
    onNavigate(details);
  });
}

chrome.browserAction.onClicked.addListener(goToBugDB);

if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(function() {
    console.log('Starting browser... updating icon.');
    startRequest({scheduleRequest:false, showLoadingAnimation:false});
    updateIcon();
  });
} else {
  // This hack is needed because Chrome 22 does not persist browserAction icon
  // state, and also doesn't expose onStartup. So the icon always starts out in
  // wrong state. We don't actually use onStartup except as a clue that we're
  // in a version of Chrome that has this problem.
  chrome.windows.onCreated.addListener(function() {
    console.log('Window created... updating icon.');
    startRequest({scheduleRequest:false, showLoadingAnimation:false});
    updateIcon();
  });
}
