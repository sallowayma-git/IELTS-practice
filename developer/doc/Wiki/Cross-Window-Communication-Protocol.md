# Cross-Window Communication Protocol

> **Relevant source files**
> * [AGENTS.md](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/AGENTS.md)
> * [js/app/examSessionMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js)
> * [js/app/suitePracticeMixin.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js)
> * [js/practice-page-enhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js)
> * [js/utils/environmentDetector.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/utils/environmentDetector.js)

## Purpose and Scope

This document describes the `postMessage`-based communication protocol between the parent application window (main app) and child exam windows (opened popups or tabs). The protocol enables session initialization, answer data collection, and suite practice orchestration across window boundaries.

For information about the data collection mechanisms that operate within exam windows, see [Practice Page Enhancement & Data Collection](/sallowayma-git/IELTS-practice/5.2-practice-page-enhancement-and-data-collection). For details on suite practice orchestration and window management, see [Suite Practice Mode](/sallowayma-git/IELTS-practice/5.4-suite-practice-mode). For session lifecycle management and persistence, see [PracticeRecorder & ScoreStorage](/sallowayma-git/IELTS-practice/5.1-practicerecorder-and-scorestorage).

---

## Protocol Overview

The cross-window communication protocol uses the browser's `window.postMessage` API to establish a bidirectional communication channel between:

* **Parent Window**: The main application (running in `index.html`, theme portals, or `Welcome.html`)
* **Child Window**: The exam page (opened via `window.open()` in a popup or new tab)

All messages follow a standardized envelope structure:

```yaml
{
  type: "MESSAGE_TYPE",    // String identifier for message category
  data: {                  // Message-specific payload
    // ... type-specific fields
  }
}
```

Messages are sent to the wildcard origin `'*'` to support both local file protocol and HTTP(S) deployments.

**Sources**: [js/app/examSessionMixin.js L852-L855](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L852-L855)

 [js/practice-page-enhancer.js L379-L416](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L379-L416)

---

## Message Types & Payloads

### Core Session Messages

| Message Type | Direction | Purpose | Key Fields |
| --- | --- | --- | --- |
| `INIT_SESSION` | Parent → Child | Initialize practice session and inject examId | `sessionId`, `examId`, `parentOrigin`, `timestamp`, `suiteSessionId?` |
| `SESSION_READY` | Child → Parent | Confirm initialization complete | `sessionId`, `examId`, `url`, `title`, `pageType`, `suiteSessionId?` |
| `PRACTICE_COMPLETE` | Child → Parent | Submit answers and scoreInfo | `sessionId`, `examId`, `duration`, `answers`, `scoreInfo`, `answerComparison`, `correctAnswers` |
| `REQUEST_INIT` | Child → Parent | Request session initialization (retry loop) | `examId?`, `derivedExamId`, `url`, `title`, `timestamp` |

### Suite Practice Messages

| Message Type | Direction | Purpose | Key Fields |
| --- | --- | --- | --- |
| `SUITE_NAVIGATE` | Parent → Child | Navigate to next exam in suite | `url`, `examId` |
| `SUITE_CLOSE_ATTEMPT` | Child → Parent | Notify parent of close/navigation attempt | `examId`, `suiteSessionId`, `reason`, `timestamp` |
| `SUITE_FORCE_CLOSE` | Parent → Child | Tear down guards and allow window close | `suiteSessionId` |

**Sources**: [js/app/examSessionMixin.js L843-L855](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L843-L855)

 [js/practice-page-enhancer.js L385-L416](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L385-L416)

 [js/app/suitePracticeMixin.js L759-L764](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L759-L764)

---

## Handshake Sequence

### Standard Practice Session Handshake

```mermaid
sequenceDiagram
  participant Parent Window
  participant (examSessionMixin)
  participant Child Window
  participant (practice-page-enhancer)

  note over Parent Window,(examSessionMixin): User clicks "Start Exam"
  Parent Window->>Parent Window: "openExam(examId)"
  Parent Window->>Child Window: "window.open(examUrl)"
  Parent Window->>Parent Window: "injectDataCollectionScript()"
  note over Child Window,(practice-page-enhancer): Script injection detected
  Child Window->>Child Window: "initialize()"
  Child Window->>Child Window: "startInitRequestLoop()"
  Child Window->>Parent Window: "postMessage(REQUEST_INIT)"
  note over Child Window,(practice-page-enhancer): Retry every 2s until initialized
  Parent Window->>Child Window: "postMessage(INIT_SESSION)"
  note over Child Window,(practice-page-enhancer): Receive sessionId & examId
  Child Window->>Child Window: "stopInitRequestLoop()"
  Child Window->>Child Window: "Store sessionId, examId"
  Child Window->>Parent Window: "postMessage(SESSION_READY)"
  note over Parent Window,(examSessionMixin): Store window reference
  note over Child Window,(practice-page-enhancer): User answers questions
  note over Child Window,(practice-page-enhancer): User clicks Submit
  Child Window->>Child Window: "extractCorrectAnswers()"
  Child Window->>Child Window: "generateAnswerComparison()"
  Child Window->>Parent Window: "postMessage(PRACTICE_COMPLETE)"
  note over Parent Window,(examSessionMixin): Pass to PracticeRecorder
```

**Detailed Flow**:

1. **Window Creation** [js/app/examSessionMixin.js L89-L176](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L89-L176) * Parent calls `openExam(examId)` in response to user action * `openExamWindow()` creates popup/tab with user gesture to avoid popup blockers * Window reference stored in `this.examWindows` Map
2. **Script Injection** [js/app/examSessionMixin.js L460-L533](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L460-L533) * Parent calls `injectDataCollectionScript(examWindow, examId)` * Waits for `document.readyState === 'complete'` or `'interactive'` * Fetches and injects `practice-page-enhancer.js` into child window * Falls back to inline script injection if fetch fails
3. **Initialization Request Loop** [js/practice-page-enhancer.js L420-L449](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L420-L449) * Child starts `initRequestTimer` sending `REQUEST_INIT` every 2 seconds * Includes `derivedExamId` extracted from URL path and `title` * Continues until `sessionId` is received or window closes
4. **Session Initialization** [js/app/examSessionMixin.js L813-L887](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L813-L887) * Parent calls `initializePracticeSession(examWindow, examId)` * Generates unique `sessionId = ${examId}_${Date.now()}` * Resolves `suiteSessionId` from `currentSuiteSession` if suite mode active * Sends `INIT_SESSION` with payload containing `sessionId`, `examId`, `suiteSessionId`
5. **Session Confirmation** [js/practice-page-enhancer.js L385-L401](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L385-L401) * Child receives `INIT_SESSION`, stores `sessionId` and `examId` * Stops retry loop via `stopInitRequestLoop()` * Enables suite guards if `suiteSessionId` present * Responds with `SESSION_READY` including `pageType` and `url`
6. **Completion Notification** [js/practice-page-enhancer.js L1290-L1340](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1290-L1340) * Child intercepts submit button or `gradeAnswers()` function * Extracts correct answers from DOM/scripts * Generates `answerComparison` mapping each question to correctness * Sends `PRACTICE_COMPLETE` with complete session data

**Sources**: [js/app/examSessionMixin.js L89-L176](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L89-L176)

 [js/app/examSessionMixin.js L460-L533](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L460-L533)

 [js/app/examSessionMixin.js L813-L887](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L813-L887)

 [js/practice-page-enhancer.js L379-L416](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L379-L416)

 [js/practice-page-enhancer.js L1290-L1340](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1290-L1340)

---

## Session Initialization Details

### Parent-Side Implementation

The parent window maintains session state in `this.examWindows` Map:

```yaml
this.examWindows.set(examId, {
  window: examWindow,           // Window reference
  sessionId: sessionId,          // Generated session identifier
  initTime: Date.now(),          // Initialization timestamp
  status: 'initialized',         // Session status
  suiteSessionId: suiteSessionId || null,  // Suite session if applicable
  dataCollectorReady: false      // Whether child confirmed ready
});
```

**Initialization Payload** [js/app/examSessionMixin.js L843-L855](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L843-L855)

:

```javascript
const initPayload = {
  sessionId: `${examId}_${Date.now()}`,
  examId: examId,
  parentOrigin: window.location.origin,
  timestamp: Date.now(),
  suiteSessionId: suiteSessionId || null
};

examWindow.postMessage({
  type: 'INIT_SESSION',
  data: initPayload
}, '*');
```

### Child-Side Implementation

The child window stores session context in `window.practicePageEnhancer`:

```python
window.practicePageEnhancer = {
  sessionId: null,        // Received from parent
  examId: null,           // Unique exam identifier
  parentWindow: window.opener || window.parent,
  answers: {},            // User answers collected
  correctAnswers: {},     // Extracted correct answers
  interactions: [],       // User interaction log
  startTime: Date.now(),
  // ...
};
```

**Response Payload** [js/practice-page-enhancer.js L394-L400](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L394-L400)

:

```yaml
this.sendMessage('SESSION_READY', {
  pageType: this.detectPageType(),  // 'P1', 'P2', 'P3', or 'unknown'
  sessionId: this.sessionId,
  suiteSessionId: this.suiteSessionId || null,
  url: window.location.href,
  title: document.title
});
```

**Sources**: [js/app/examSessionMixin.js L814-L883](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L814-L883)

 [js/practice-page-enhancer.js L298-L361](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L298-L361)

---

## Suite Practice Protocol Extensions

Suite practice mode adds additional protocol layers to coordinate multi-exam sequences and prevent accidental window closure.

### Suite Mode Initialization

```mermaid
sequenceDiagram
  participant Parent Window
  participant (suitePracticeMixin)
  participant Child Window
  participant (enhancer + guards)

  note over Parent Window,(suitePracticeMixin): startSuitePractice()
  Parent Window->>Parent Window: "Generate suiteSessionId"
  Parent Window->>Parent Window: "Select 3 random exams (P1,P2,P3)"
  Parent Window->>Child Window: "openExam(firstExam, {suiteSessionId})"
  Parent Window->>Child Window: "postMessage(INIT_SESSION)"
  note over Parent Window,(enhancer + guards): Standard handshake includes suiteSessionId
  Child Window->>Child Window: "enableSuiteMode()"
  Child Window->>Child Window: "installSuiteGuards()"
  note over Child Window,(enhancer + guards): Override window.close()
  Child Window->>Parent Window: "postMessage(SESSION_READY)"
  Parent Window->>Parent Window: "Store window guard reference"
  note over Child Window,(enhancer + guards): User attempts window.close()
  Child Window->>Child Window: "guardClose() - Block close"
  Child Window->>Parent Window: "postMessage(SUITE_CLOSE_ATTEMPT)"
  note over Parent Window,(suitePracticeMixin): Log attempt, show warning
  note over Child Window,(enhancer + guards): User completes P1
  Child Window->>Parent Window: "postMessage(PRACTICE_COMPLETE)"
  Parent Window->>Parent Window: "handleSuitePracticeComplete()"
  Parent Window->>Parent Window: "Record result, increment index"
  Parent Window->>Child Window: "postMessage(SUITE_NAVIGATE, {url: p2Url})"
  note over Child Window,(enhancer + guards): Navigate to P2 in same window
  Child Window->>Child Window: "window.location.href = p2Url"
  note over Parent Window,(enhancer + guards): Repeat for P2 → P3
  note over Child Window,(enhancer + guards): User completes P3
  Child Window->>Parent Window: "postMessage(PRACTICE_COMPLETE)"
  Parent Window->>Parent Window: "finalizeSuiteRecord()"
  Parent Window->>Parent Window: "Aggregate scores, save suite record"
  Parent Window->>Child Window: "postMessage(SUITE_FORCE_CLOSE)"
  Child Window->>Child Window: "teardownSuiteGuards()"
  Child Window->>Child Window: "Restore window.close()"
  Child Window->>Child Window: "window.close()"
```

### Window Guard Mechanism

**Guard Installation** [js/practice-page-enhancer.js L462-L517](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L462-L517)

:

The child window installs guards when `suiteSessionId` is present in `INIT_SESSION`:

```javascript
// Store native functions
this._nativeClose = window.close.bind(window);
this._nativeOpen = window.open.bind(window);

// Override close to block and notify
const guardClose = () => {
  this.notifySuiteCloseAttempt('script_request');
  return undefined;  // Prevents close
};

window.close = guardClose;
window.self.close = guardClose;
window.top.close = guardClose;

// Override open to block self-navigation
window.open = (url, target, features) => {
  if (isSelfTarget(target)) {
    this.notifySuiteCloseAttempt('self_target_open');
    return window;  // Return existing window
  }
  return this._nativeOpen(url, target, features);
};
```

**Parent-Side Guard Installation** [js/app/suitePracticeMixin.js L855-L945](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L855-L945)

:

The parent also installs guards when window is accessible (non-cross-origin):

```javascript
const guardInfo = {
  sessionId: session.id,
  nativeClose: targetWindow.close.bind(targetWindow),
  nativeOpen: targetWindow.open.bind(targetWindow),
  windowName: targetWindow.name.trim().toLowerCase()
};

targetWindow.close = () => {
  this._recordSuiteCloseAttempt(session, 'script_request');
  return undefined;
};

targetWindow.__IELTS_SUITE_PARENT_GUARD__ = guardInfo;
```

### Suite Navigation Protocol

**Navigation Message** [js/app/suitePracticeMixin.js L175-L235](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L175-L235)

:

```javascript
const nextEntry = session.sequence[session.currentIndex];
session.activeExamId = nextEntry.examId;

// Reuse existing window
const nextWindow = await this.openExam(nextEntry.examId, {
  target: 'tab',
  windowName: session.windowName,
  reuseWindow: session.windowRef,
  suiteSessionId: session.id,
  sequenceIndex: session.currentIndex
});
```

The `reuseWindow` option causes `openExamWindow` to navigate instead of opening:

```
if (reuseWindow && !reuseWindow.closed) {
  reuseWindow.location.href = finalUrl;
  reuseWindow.focus();
  return reuseWindow;
}
```

**Sources**: [js/practice-page-enhancer.js L452-L517](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L452-L517)

 [js/app/suitePracticeMixin.js L855-L945](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L855-L945)

 [js/app/suitePracticeMixin.js L175-L235](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/suitePracticeMixin.js#L175-L235)

---

## Timeout and Error Handling

### Initialization Timeout

**Request Retry Loop** [js/practice-page-enhancer.js L420-L449](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L420-L449)

:

The child window implements a persistent retry mechanism:

```javascript
startInitRequestLoop: function() {
  if (!this.parentWindow || this.parentWindow === window) {
    return;  // No parent available
  }
  
  const sendRequest = () => {
    if (this.sessionId) {
      this.stopInitRequestLoop();
      return;  // Already initialized
    }
    
    this.sendMessage('REQUEST_INIT', {
      examId: this.examId || null,
      derivedExamId: this.extractExamIdFromUrl(),
      url: window.location.href,
      title: document.title,
      timestamp: Date.now()
    });
  };
  
  sendRequest();  // Immediate send
  this.initRequestTimer = setInterval(sendRequest, 2000);  // Retry every 2s
}
```

The retry loop continues indefinitely until:

1. `INIT_SESSION` is received and `sessionId` is assigned
2. Window is closed or navigated away

**Parent-Side Handling**:

The parent does not currently implement timeout detection for stalled handshakes. The exam window remains open until manually closed by the user or completed normally. Future enhancement could add:

* Detection of windows stuck in initialization
* Automatic cleanup of stale window references
* User notification of handshake failures

### Cross-Origin Limitations

**Script Injection Failure** [js/app/examSessionMixin.js L471-L483](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L471-L483)

:

When cross-origin policies prevent script injection:

```
try {
  doc = examWindow.document;
  if (!doc) {
    console.warn('[DataInjection] 无法访问窗口文档');
    return;
  }
} catch (e) {
  console.warn('[DataInjection] 跨域限制，无法注入脚本');
  // For cross-origin cases, can only wait for page to initiate communication
  return;
}
```

**Fallback Strategy**:

If the exam HTML already includes `practice-page-enhancer.js` as a static script, it will initialize automatically and send `REQUEST_INIT` messages, establishing the protocol without dynamic injection.

### Inline Script Fallback

**Backup Injection Method** [js/app/examSessionMixin.js L538-L809](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L538-L809)

:

If fetch fails, the parent falls back to inline script injection:

```javascript
injectInlineScript(examWindow, examId) {
  const inlineScript = examWindow.document.createElement('script');
  inlineScript.textContent = `
    (function() {
      if (window.__IELTS_INLINE_ENHANCER__) {
        return;  // Already injected
      }
      window.__IELTS_INLINE_ENHANCER__ = true;
      
      // Inline implementation of suite guards and data collection
      // ... (complete inline enhancer code)
    })();
  `;
  
  examWindow.document.head.appendChild(inlineScript);
}
```

The inline script provides:

* Basic answer collection via `document.addEventListener('change')`
* Suite guard installation
* `postMessage` protocol implementation
* Fallback `practiceDataCollector` object

**Sources**: [js/app/examSessionMixin.js L420-L533](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L420-L533)

 [js/app/examSessionMixin.js L538-L809](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L538-L809)

 [js/practice-page-enhancer.js L420-L449](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L420-L449)

---

## Message Routing & Event Handling

### Parent Window Message Handler

**Main Event Listener** [js/app/examSessionMixin.js L920-L1028](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L920-L1028)

:

```javascript
setupExamWindowManagement(examWindow, examId, exam, options = {}) {
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') {
      return;
    }
    
    // Route to appropriate handler
    switch (message.type) {
      case 'SESSION_READY':
        this.handleSessionReady(examId, message.data);
        break;
      case 'PRACTICE_COMPLETE':
        this.handlePracticeComplete(examId, message.data);
        break;
      case 'SUITE_CLOSE_ATTEMPT':
        this.handleSuiteCloseAttempt(examId, message.data);
        break;
      case 'REQUEST_INIT':
        this.handleInitRequest(examId, message.data);
        break;
    }
  });
}
```

**Session Ready Handler** [js/app/examSessionMixin.js L928-L950](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L928-L950)

:

```javascript
handleSessionReady(examId, data) {
  if (!this.examWindows || !this.examWindows.has(examId)) {
    return;
  }
  
  const windowInfo = this.examWindows.get(examId);
  windowInfo.dataCollectorReady = true;
  windowInfo.status = 'active';
  windowInfo.pageType = data.pageType;
  
  this.examWindows.set(examId, windowInfo);
}
```

**Practice Complete Handler** [js/app/examSessionMixin.js L952-L1020](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L952-L1020)

:

```sql
async handlePracticeComplete(examId, data) {
  // Check if suite mode active
  if (this.currentSuiteSession && this.suiteExamMap?.has(examId)) {
    return await this.handleSuitePracticeComplete(examId, data);
  }
  
  // Single exam mode - pass to recorder
  if (this.components?.practiceRecorder) {
    await this.components.practiceRecorder.handleSessionCompleted(data);
  } else {
    await this.savePracticeRecordFallback(examId, data);
  }
  
  // Update UI
  this.updateExamStatus?.(examId, 'completed');
  this.refreshOverviewData?.();
}
```

### Child Window Message Handler

**Event Listener** [js/practice-page-enhancer.js L379-L416](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L379-L416)

:

```javascript
window.addEventListener('message', (event) => {
  const payload = event?.data;
  if (!payload || typeof payload.type !== 'string') {
    return;
  }
  
  if (payload.type === 'INIT_SESSION') {
    const initData = payload.data || {};
    this.sessionId = initData.sessionId;
    this.examId = initData.examId;
    
    if (initData.suiteSessionId) {
      this.enableSuiteMode(initData);
    }
    
    this.stopInitRequestLoop();
    this.sendMessage('SESSION_READY', { /* ... */ });
    return;
  }
  
  if (!this.suiteModeActive) {
    return;  // Ignore suite messages if not in suite mode
  }
  
  if (payload.type === 'SUITE_NAVIGATE') {
    this.handleSuiteNavigation(payload.data);
  } else if (payload.type === 'SUITE_FORCE_CLOSE') {
    this.teardownSuiteGuards();
    this._nativeClose?.();
  }
});
```

**Sources**: [js/app/examSessionMixin.js L920-L1028](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L920-L1028)

 [js/practice-page-enhancer.js L379-L416](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L379-L416)

---

## Protocol State Diagram

```

```

**Sources**: [js/app/examSessionMixin.js L89-L176](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L89-L176)

 [js/practice-page-enhancer.js L309-L361](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L309-L361)

 [js/practice-page-enhancer.js L452-L568](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L452-L568)

---

## Implementation Checklist

### Parent Window Requirements

* Implement `window.addEventListener('message')` global handler
* Maintain `examWindows` Map with session metadata
* Generate unique `sessionId` per exam session
* Detect suite mode and include `suiteSessionId` in `INIT_SESSION`
* Install parent-side window guards for suite mode (non-cross-origin only)
* Route `PRACTICE_COMPLETE` to `PracticeRecorder` or fallback storage
* Handle `SUITE_CLOSE_ATTEMPT` notifications gracefully
* Clean up window references and guards on session end

### Child Window Requirements

* Implement `window.addEventListener('message')` protocol handler
* Start `REQUEST_INIT` retry loop on page load
* Stop retry loop when `sessionId` received
* Store `sessionId` and `examId` from `INIT_SESSION`
* Send `SESSION_READY` with `pageType`, `url`, `title`
* Install suite guards if `suiteSessionId` present
* Collect answers and extract correct answers throughout session
* Generate `answerComparison` on submit
* Send `PRACTICE_COMPLETE` with full session data
* Respond to `SUITE_NAVIGATE` by navigating to next URL
* Tear down guards on `SUITE_FORCE_CLOSE`

### Error Handling Requirements

* Gracefully handle cross-origin script injection failures
* Provide inline script fallback for injection errors
* Continue `REQUEST_INIT` loop if initial message lost
* Detect and log message format errors
* Handle window closure during handshake
* Validate message payloads before processing
* Log communication errors for debugging

**Sources**: [js/app/examSessionMixin.js L89-L1028](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/app/examSessionMixin.js#L89-L1028)

 [js/practice-page-enhancer.js L298-L1500](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L298-L1500)