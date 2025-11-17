# Practice Page Enhancement & Data Collection

> **Relevant source files**
> * [js/practice-page-enhancer.js](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js)

## Purpose and Scope

This document explains the practice page enhancement system, which runs inside exam windows to capture user answers, extract correct answers, and track user interactions during practice sessions. The enhancer is injected into exam pages and serves as the data collection agent that feeds information back to the parent application window.

For information about how the collected data is persisted and processed after collection, see [PracticeRecorder & ScoreStorage](/sallowayma-git/IELTS-practice/5.1-practicerecorder-and-scorestorage). For details about the communication protocol between the enhancer and parent window, see [Cross-Window Communication Protocol](/sallowayma-git/IELTS-practice/5.3-cross-window-communication-protocol). For exam window lifecycle management, see [Exam Window Management & Resource Resolution](/sallowayma-git/IELTS-practice/5.5-exam-window-management-and-resource-resolution).

**Sources:** [js/practice-page-enhancer.js L1-L10](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1-L10)

## System Architecture

The practice page enhancer operates as an injected script within exam windows, creating a global `window.practicePageEnhancer` object that manages all data collection activities. It embeds a `CorrectAnswerExtractor` class for extracting answer keys and establishes bidirectional communication with the parent window.

### Core Components

```mermaid
flowchart TD

ENHANCER["window.practicePageEnhancer<br>Main Enhancer Object"]
EXTRACTOR["CorrectAnswerExtractor<br>Answer Key Extraction"]
LISTENERS["DOM Event Listeners<br>Answer Capture"]
INTERCEPTORS["Submit Interceptors<br>gradeAnswers/grade hooks"]
TRACKING["Interaction Tracker<br>Click/Scroll Events"]
USER_ANSWERS["this.answers<br>User Answer Map"]
CORRECT_ANSWERS["this.correctAnswers<br>Correct Answer Map"]
INTERACTIONS["this.interactions<br>Interaction Log Array"]
PARENT["parentWindow<br>window.opener/parent"]
MESSAGES["postMessage Protocol<br>INIT_SESSION/PRACTICE_COMPLETE"]
INPUTS["Input Elements<br>input/textarea/select"]
DROPZONES["Dropzones<br>Drag-and-Drop Areas"]
RESULTS["Results Display<br>#results element"]
SCRIPTS["Script Elements<br>Answer Data Sources"]

LISTENERS --> USER_ANSWERS
EXTRACTOR --> CORRECT_ANSWERS
TRACKING --> INTERACTIONS
INPUTS --> LISTENERS
DROPZONES --> LISTENERS
RESULTS --> EXTRACTOR
SCRIPTS --> EXTRACTOR
ENHANCER --> MESSAGES
ENHANCER --> USER_ANSWERS
ENHANCER --> CORRECT_ANSWERS
ENHANCER --> INTERACTIONS

subgraph subGraph3 ["Page Elements"]
    INPUTS
    DROPZONES
    RESULTS
    SCRIPTS
end

subgraph Communication ["Communication"]
    PARENT
    MESSAGES
    MESSAGES --> PARENT
end

subgraph subGraph1 ["Data Storage"]
    USER_ANSWERS
    CORRECT_ANSWERS
    INTERACTIONS
end

subgraph subGraph0 ["Exam Window (practice-page-enhancer.js)"]
    ENHANCER
    EXTRACTOR
    LISTENERS
    INTERCEPTORS
    TRACKING
    ENHANCER --> LISTENERS
    ENHANCER --> INTERCEPTORS
    ENHANCER --> TRACKING
    ENHANCER --> EXTRACTOR
    INTERCEPTORS --> ENHANCER
end
```

**Sources:** [js/practice-page-enhancer.js L298-L361](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L298-L361)

 [js/practice-page-enhancer.js L19-L296](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L19-L296)

### Initialization Sequence

The enhancer initializes automatically when the page loads, setting up all monitoring systems and establishing communication with the parent window.

```mermaid
sequenceDiagram
  participant Exam Page Load
  participant practicePageEnhancer
  participant window.storage
  participant CorrectAnswerExtractor
  participant Parent Window

  Exam Page Load->>practicePageEnhancer: DOMContentLoaded / immediate init
  practicePageEnhancer->>practicePageEnhancer: cleanup previous instance
  practicePageEnhancer->>window.storage: setNamespace('exam_system')
  practicePageEnhancer->>practicePageEnhancer: setupCommunication()
  practicePageEnhancer->>practicePageEnhancer: setupAnswerListeners()
  practicePageEnhancer->>CorrectAnswerExtractor: extractCorrectAnswers()
  practicePageEnhancer->>practicePageEnhancer: interceptSubmit()
  practicePageEnhancer->>practicePageEnhancer: setupInteractionTracking()
  practicePageEnhancer->>Parent Window: startInitRequestLoop()
  loop [Every 2 seconds until initialized]
    practicePageEnhancer->>Parent Window: postMessage(REQUEST_INIT)
  end
  Parent Window->>practicePageEnhancer: postMessage(INIT_SESSION)
  practicePageEnhancer->>practicePageEnhancer: stopInitRequestLoop()
  practicePageEnhancer->>Parent Window: postMessage(SESSION_READY)
  note over practicePageEnhancer: Ready to collect data
```

**Sources:** [js/practice-page-enhancer.js L309-L361](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L309-L361)

 [js/practice-page-enhancer.js L372-L418](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L372-L418)

 [js/practice-page-enhancer.js L420-L450](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L420-L450)

## CorrectAnswerExtractor System

The `CorrectAnswerExtractor` class provides multiple strategies for extracting correct answers from exam pages, which may store answer keys in various formats and locations.

### Extraction Strategy Chain

The extractor tries strategies in order until one succeeds:

| Priority | Strategy | Method | Target |
| --- | --- | --- | --- |
| 1 | Global Objects | `extractFromAnswersObject()` | `window.answers`, `window.correctAnswers`, etc. |
| 2 | Results Tables | `extractFromResultsTable()` | `.results-table`, `.answer-table` |
| 3 | DOM Attributes | `extractFromDOM()` | `[data-correct-answer]`, `.correct-answer` |
| 4 | Script Content | `extractFromScripts()` | Parse script tags for JSON/object literals |

**Sources:** [js/practice-page-enhancer.js L20-L47](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L20-L47)

### Strategy 1: Global Answer Objects

Searches for answer data in global JavaScript variables:

```mermaid
flowchart TD

START["extractFromAnswersObject()"]
CHECK1["Check window.answers"]
CHECK2["Check window.correctAnswers"]
CHECK3["Check window.examAnswers"]
CHECK4["Check window.questionAnswers"]
CHECK5["Check window.solutionAnswers"]
EXTRACT["extractFromScriptVariables()"]
PARSE["parseAnswersObject()"]
MANUAL["manualParseAnswers()"]
RETURN["Return answers object"]

START --> CHECK1
CHECK5 --> EXTRACT
CHECK1 --> RETURN
CHECK2 --> RETURN
CHECK3 --> RETURN
CHECK4 --> RETURN
CHECK5 --> RETURN
PARSE --> RETURN
MANUAL --> RETURN

subgraph subGraph1 ["Script Variable Search"]
    EXTRACT
    PARSE
    MANUAL
    EXTRACT --> PARSE
    PARSE --> MANUAL
end

subgraph subGraph0 ["Global Variable Search"]
    CHECK1
    CHECK2
    CHECK3
    CHECK4
    CHECK5
    CHECK1 --> CHECK2
    CHECK2 --> CHECK3
    CHECK3 --> CHECK4
    CHECK4 --> CHECK5
end
```

The method searches for common variable names and falls back to parsing script content if direct variable access fails.

**Sources:** [js/practice-page-enhancer.js L49-L64](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L49-L64)

 [js/practice-page-enhancer.js L66-L120](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L66-L120)

### Strategy 2: Results Table Extraction

Parses answer tables that appear after submission:

```mermaid
flowchart TD

START["extractFromResultsTable()"]
SELECT1[".results-table"]
SELECT2[".answer-table"]
SELECT3[".score-table"]
SELECT4["table[class*='result']"]
SELECT5["table[class*='answer']"]
SELECT6[".exam-results table"]
PARSE["parseAnswersFromTable()"]
CELLS["Extract cells from row"]
Q_CELL["Identify question cell"]
A_CELL["findAnswerCell()"]
EXTRACT_Q["extractQuestionId()"]
EXTRACT_A["extractAnswerFromElement()"]
RESULT["Return answers map"]

START --> SELECT1
SELECT1 --> PARSE
SELECT2 --> PARSE
SELECT3 --> PARSE
SELECT4 --> PARSE
SELECT5 --> PARSE
SELECT6 --> PARSE
PARSE --> CELLS
EXTRACT_Q --> RESULT
EXTRACT_A --> RESULT

subgraph subGraph1 ["Row Processing"]
    CELLS
    Q_CELL
    A_CELL
    EXTRACT_Q
    EXTRACT_A
    CELLS --> Q_CELL
    CELLS --> A_CELL
    Q_CELL --> EXTRACT_Q
    A_CELL --> EXTRACT_A
end

subgraph subGraph0 ["Table Selection"]
    SELECT1
    SELECT2
    SELECT3
    SELECT4
    SELECT5
    SELECT6
    SELECT1 --> SELECT2
    SELECT2 --> SELECT3
    SELECT3 --> SELECT4
    SELECT4 --> SELECT5
    SELECT5 --> SELECT6
end
```

This strategy is particularly effective for exams that display a comparison table after submission showing user answers alongside correct answers.

**Sources:** [js/practice-page-enhancer.js L122-L221](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L122-L221)

 [js/practice-page-enhancer.js L715-L769](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L715-L769)

### Strategy 3: DOM Attribute Extraction

Searches for correct answers stored in DOM element attributes:

The method queries for elements with answer-related attributes and classes:

* `[data-correct-answer]`
* `.correct-answer`
* `.solution`
* `[class*="correct"]`
* `[id*="correct"]`

For each element found, it extracts the question ID using `extractQuestionId()` and the answer value using `extractAnswerFromElement()`.

**Sources:** [js/practice-page-enhancer.js L139-L158](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L139-L158)

 [js/practice-page-enhancer.js L686-L713](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L686-L713)

### Strategy 4: Script Content Parsing

Parses JavaScript in `<script>` tags to find answer data:

The extractor searches script content for patterns like:

```
answers = {...}
correct = {...}
```

It attempts JSON parsing and falls back to regex-based extraction when structured parsing fails.

**Sources:** [js/practice-page-enhancer.js L160-L181](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L160-L181)

### Answer Normalization

All extracted answers are normalized to ensure consistency:

```mermaid
flowchart TD

INPUT["Raw Answers"]
KEY_CHECK["Key starts with 'q'?"]
ADD_Q["Prefix with 'q'"]
TRIM["Trim whitespace"]
BOOL_CHECK["Boolean pattern?"]
BOOL_NORM["Normalize to TRUE/FALSE"]
LETTER_CHECK["Single letter?"]
LETTER_NORM["Uppercase"]
OUTPUT["Normalized Answers"]

INPUT --> KEY_CHECK
KEY_CHECK --> TRIM
ADD_Q --> TRIM
LETTER_CHECK --> OUTPUT
BOOL_NORM --> OUTPUT
LETTER_NORM --> OUTPUT

subgraph subGraph1 ["Value Normalization"]
    TRIM
    BOOL_CHECK
    BOOL_NORM
    LETTER_CHECK
    LETTER_NORM
    TRIM --> BOOL_CHECK
    BOOL_CHECK --> BOOL_NORM
    BOOL_CHECK --> LETTER_CHECK
    LETTER_CHECK --> LETTER_NORM
end

subgraph subGraph0 ["Key Normalization"]
    KEY_CHECK
    ADD_Q
    KEY_CHECK --> ADD_Q
end
```

Normalization rules:

* Question keys are prefixed with 'q' if not already present
* Boolean values (true/false/yes/no) are normalized to 'TRUE'/'FALSE'
* Single letter answers are uppercased (A→A, b→B)
* All string values are trimmed

**Sources:** [js/practice-page-enhancer.js L267-L294](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L267-L294)

## Answer Collection Mechanisms

The enhancer uses multiple mechanisms to capture user answers as they interact with the exam page.

### Event Listener System

```mermaid
flowchart TD

CHANGE["change event"]
INPUT_EVENT["input event"]
CLICK["click event"]
DROP["drop event"]
VISIBILITY["visibilitychange"]
BLUR["window blur"]
BEFOREUNLOAD["beforeunload"]
RECORD["recordAnswer(element)"]
EXCLUDE_CHECK["isExcludedControl()"]
GET_Q_ID["getQuestionId()"]
GET_VALUE["getInputValue()"]
STORE["this.answers[questionId]"]
LOG_INTERACTION["this.interactions.push()"]
DROPZONE["collectDropzoneAnswers()"]
ALL_ANSWERS["collectAllAnswers()"]

CHANGE --> EXCLUDE_CHECK
INPUT_EVENT --> EXCLUDE_CHECK
CLICK --> EXCLUDE_CHECK
DROP --> DROPZONE
VISIBILITY --> ALL_ANSWERS
BLUR --> ALL_ANSWERS
BEFOREUNLOAD --> ALL_ANSWERS

subgraph subGraph2 ["Special Collections"]
    DROPZONE
    ALL_ANSWERS
    DROPZONE --> ALL_ANSWERS
end

subgraph subGraph1 ["Answer Recording"]
    RECORD
    EXCLUDE_CHECK
    GET_Q_ID
    GET_VALUE
    STORE
    LOG_INTERACTION
    EXCLUDE_CHECK --> RECORD
    RECORD --> GET_Q_ID
    RECORD --> GET_VALUE
    GET_Q_ID --> STORE
    GET_VALUE --> STORE
    STORE --> LOG_INTERACTION
end

subgraph subGraph0 ["DOM Event Listeners"]
    CHANGE
    INPUT_EVENT
    CLICK
    DROP
    VISIBILITY
    BLUR
    BEFOREUNLOAD
end
```

**Sources:** [js/practice-page-enhancer.js L771-L829](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L771-L829)

### Excluded Controls

The enhancer filters out non-answer UI controls to avoid capturing unrelated user interactions:

```
// Example excluded controls
#volume-slider
#playback-speed
#speed-control (container)
#volume-container (container)
```

This prevents audio player controls, speed adjustments, and other UI elements from being recorded as exam answers.

**Sources:** [js/practice-page-enhancer.js L831-L844](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L831-L844)

### Question ID Extraction

The `getQuestionId()` method uses multiple strategies to identify which question an input element belongs to:

| Priority | Source | Example |
| --- | --- | --- |
| 1 | `element.name` | `name="q1"` |
| 2 | `element.id` | `id="q1_input"` → `q1` |
| 3 | `data-question` | `data-question="q1"` |
| 4 | `data-for` | `data-for="q1"` |
| 5 | Parent element | Search up DOM tree |
| 6 | Associated label | `<label for="input1">Question 1</label>` |

**Sources:** [js/practice-page-enhancer.js L1105-L1130](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1105-L1130)

### Comprehensive Collection Strategy

The `collectAllAnswers()` method performs a complete scan of the page:

```mermaid
flowchart TD

START["collectAllAnswers()"]
INPUTS["Query all input/textarea/select"]
FILTER["Filter excluded controls"]
EXTRACT_ID["getQuestionId()"]
EXTRACT_VAL["getInputValue()"]
DROPZONES["collectDropzoneAnswers()"]
DATA_ATTRS["Elements with data-answer"]
MATCHING["collectMatchingAnswers()"]
ORDERING["collectOrderingAnswers()"]
STRUCTURE["collectFromPageStructure()"]
STORE["Store in this.answers"]
LOG["Log collection results"]

START --> INPUTS
EXTRACT_VAL --> STORE
START --> DROPZONES
START --> DATA_ATTRS
START --> MATCHING
START --> ORDERING
START --> STRUCTURE
DROPZONES --> STORE
DATA_ATTRS --> STORE
MATCHING --> STORE
ORDERING --> STORE
STRUCTURE --> STORE
STORE --> LOG

subgraph subGraph1 ["Special Question Types"]
    DROPZONES
    DATA_ATTRS
    MATCHING
    ORDERING
    STRUCTURE
end

subgraph subGraph0 ["Standard Inputs"]
    INPUTS
    FILTER
    EXTRACT_ID
    EXTRACT_VAL
    INPUTS --> FILTER
    FILTER --> EXTRACT_ID
    EXTRACT_ID --> EXTRACT_VAL
end
```

This multi-pronged approach ensures answers are captured regardless of the exam's HTML structure.

**Sources:** [js/practice-page-enhancer.js L1049-L1103](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1049-L1103)

### Drag-and-Drop Answer Collection

Specialized collection for drag-and-drop question types:

**Dropzone Types:**

1. **Standard dropzones** (`.dropzone`): Collects cards dropped into zones
2. **Paragraph dropzones** (`.paragraph-dropzone`): Collects headings matched to paragraphs
3. **Match dropzones** (`.match-dropzone`): Collects items matched to targets

**Sources:** [js/practice-page-enhancer.js L887-L925](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L887-L925)

### Matching and Ordering Questions

Special collectors for interactive question formats:

**Matching Questions:**

* Searches for `.matching-container`, `.match-exercise`
* Extracts pairs from `.match-pair`, `.matched-item`
* Reads `data-question` and `data-answer` attributes

**Ordering Questions:**

* Searches for `.ordering-container`, `.sort-exercise`
* Collects ordered items from `.order-item`, `.sortable-item`
* Joins values with comma separation

**Sources:** [js/practice-page-enhancer.js L1167-L1200](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1167-L1200)

## Submit Interception and Data Capture

The enhancer intercepts exam submission to capture final answers and scores before sending data to the parent window.

### Interception Points

```mermaid
flowchart TD

GRADE_ANSWERS["window.gradeAnswers()"]
GRADE["window.grade()"]
ORIG_GA["originalGradeAnswers"]
ORIG_G["originalGrade"]
FORM_SUBMIT["form submit event"]
BUTTON_CLICK["button click event"]
RESULTS_MONITOR["startResultsMonitoring()"]
CHECK_LOOP["Check every 500ms"]
RESULTS_VISIBLE["#results visible?"]
COLLECT["collectAllAnswers()"]
HANDLE["handleSubmit()"]

GRADE_ANSWERS --> COLLECT
GRADE --> COLLECT
FORM_SUBMIT --> COLLECT
BUTTON_CLICK --> COLLECT
ORIG_GA --> COLLECT
ORIG_G --> COLLECT
COLLECT --> ORIG_GA
COLLECT --> ORIG_G
COLLECT --> HANDLE
RESULTS_VISIBLE --> COLLECT

subgraph Monitoring ["Monitoring"]
    RESULTS_MONITOR
    CHECK_LOOP
    RESULTS_VISIBLE
    RESULTS_MONITOR --> CHECK_LOOP
    CHECK_LOOP --> RESULTS_VISIBLE
end

subgraph subGraph1 ["Event Interception"]
    FORM_SUBMIT
    BUTTON_CLICK
end

subgraph subGraph0 ["Function Interception"]
    GRADE_ANSWERS
    GRADE
    ORIG_GA
    ORIG_G
end
```

The enhancer wraps native grading functions to intercept calls, while also monitoring the DOM for results display.

**Sources:** [js/practice-page-enhancer.js L927-L991](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L927-L991)

 [js/practice-page-enhancer.js L1024-L1047](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1024-L1047)

### Submit Button Detection

Button click events are monitored for submission indicators:

```
// Detection criteria
button.textContent includes: 'Submit', '提交', '完成', 'Check'
button.classList contains: 'primary'
button.id === 'submit-btn'
button.onclick contains: 'grade'
```

**Sources:** [js/practice-page-enhancer.js L969-L985](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L969-L985)

### Score Extraction

The `extractScore()` method parses score information from the results display using multiple pattern matching strategies:

| Pattern | Example | Extracted Data |
| --- | --- | --- |
| Final Score | `Final Score: 85% (11/13)` | correct: 11, total: 13, percentage: 85 |
| Simple Score | `Score: 11/13` | correct: 11, total: 13, calculated % |
| Accuracy Percent | `Accuracy: 85%` | percentage: 85 |
| Standalone Percent | `85%` | percentage: 85 |
| Table Cells | `.result-correct` vs `.result-incorrect` | count correct/incorrect cells |

**Sources:** [js/practice-page-enhancer.js L1321-L1433](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1321-L1433)

### Data Submission Flow

```mermaid
sequenceDiagram
  participant User
  participant Submit Handler
  participant practicePageEnhancer
  participant CorrectAnswerExtractor
  participant Parent Window

  User->>Submit Handler: Click submit button
  Submit Handler->>practicePageEnhancer: handleSubmit()
  note over practicePageEnhancer: Generate sessionId if missing
  practicePageEnhancer->>practicePageEnhancer: Wait 500ms
  practicePageEnhancer->>CorrectAnswerExtractor: extractFromResultsTable()
  practicePageEnhancer->>practicePageEnhancer: Wait 1000ms
  loop [No correct answers found]
    practicePageEnhancer->>CorrectAnswerExtractor: extractCorrectAnswersBackup()
  end
  practicePageEnhancer->>practicePageEnhancer: generateAnswerComparison()
  practicePageEnhancer->>practicePageEnhancer: extractScore()
  practicePageEnhancer->>Parent Window: postMessage(PRACTICE_COMPLETE, results)
  note over Parent Window: Data includes:
```

The submission handler includes deliberate delays to ensure the results display is fully rendered and correct answers are available before data collection.

**Sources:** [js/practice-page-enhancer.js L1225-L1276](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1225-L1276)

## Interaction Tracking

The enhancer logs user interactions to provide context about how the user engaged with the exam.

### Tracked Events

```mermaid
flowchart TD

CLICK["Click Events"]
SCROLL["Scroll Events"]
ANSWER_CHANGE["Answer Changes"]
TYPE["type: 'click'/'scroll'/'answer'"]
TARGET["target: element description"]
VALUE["value: for answers"]
TIMESTAMP["timestamp: Date.now()"]
METADATA["elementType: input type"]
ARRAY["this.interactions[]"]

CLICK --> TYPE
SCROLL --> TYPE
ANSWER_CHANGE --> TYPE
TYPE --> ARRAY
TARGET --> ARRAY
VALUE --> ARRAY
TIMESTAMP --> ARRAY
METADATA --> ARRAY

subgraph subGraph1 ["Interaction Log Entry"]
    TYPE
    TARGET
    VALUE
    TIMESTAMP
    METADATA
end

subgraph subGraph0 ["User Actions"]
    CLICK
    SCROLL
    ANSWER_CHANGE
end
```

**Interaction Types:**

* **click**: Tracks clicks with target element tag and class
* **scroll**: Records scroll position with 500ms debouncing
* **answer**: Records answer changes with question ID and value

**Sources:** [js/practice-page-enhancer.js L1202-L1223](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1202-L1223)

 [js/practice-page-enhancer.js L876-L884](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L876-L884)

## Answer Comparison and Validation

The enhancer generates a comprehensive comparison between user answers and correct answers.

### Comparison Generation

```mermaid
flowchart TD

START["generateAnswerComparison()"]
MERGE["Merge all question keys<br>from answers and correctAnswers"]
GET_USER["Get user answer"]
GET_CORRECT["Get correct answer"]
COMPARE["compareAnswers()"]
USER_ANS["userAnswer: value or null"]
CORRECT_ANS["correctAnswer: value or null"]
IS_CORRECT["isCorrect: boolean"]
RESULT["Return comparison map"]

START --> MERGE
MERGE --> GET_USER
MERGE --> GET_CORRECT
USER_ANS --> RESULT
CORRECT_ANS --> RESULT
IS_CORRECT --> RESULT

subgraph subGraph1 ["For Each Question"]
    GET_USER
    GET_CORRECT
    COMPARE
    GET_USER --> COMPARE
    GET_CORRECT --> COMPARE
    COMPARE --> USER_ANS
    COMPARE --> CORRECT_ANS
    COMPARE --> IS_CORRECT

subgraph subGraph0 ["Comparison Object"]
    USER_ANS
    CORRECT_ANS
    IS_CORRECT
end
end
```

Example comparison output:

```json
{
  "q1": {
    "userAnswer": "A",
    "correctAnswer": "B",
    "isCorrect": false
  },
  "q2": {
    "userAnswer": "TRUE",
    "correctAnswer": "TRUE",
    "isCorrect": true
  }
}
```

**Sources:** [js/practice-page-enhancer.js L1278-L1309](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1278-L1309)

### Answer Comparison Algorithm

The `compareAnswers()` method normalizes and compares answers:

1. **Null check**: Returns `false` if either answer is missing
2. **Normalization**: Converts both to lowercase trimmed strings
3. **Equality check**: Returns `true` only if normalized values match

This ensures that minor formatting differences (e.g., "A" vs " a ") don't cause false mismatches.

**Sources:** [js/practice-page-enhancer.js L1311-L1319](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1311-L1319)

## Suite Mode Integration

The enhancer supports suite practice mode, where multiple exams are taken in sequence in the same window.

### Suite Mode Features

```

```

**Sources:** [js/practice-page-enhancer.js L452-L568](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L452-L568)

### Window Guard System

Suite mode installs guards to prevent accidental window closure:

**Intercepted Functions:**

* `window.close()`: Blocked and notifies parent
* `window.self.close()`: Blocked and notifies parent
* `window.top.close()`: Blocked and notifies parent
* `window.open(url, target)`: Blocks self-targeting opens

**Self-Target Detection:**
The guard identifies self-targeting opens by checking if the target matches:

* `_self`, `self`, `_parent`, `parent`, `_top`, `top`
* Empty string or null
* Current window name

**Sources:** [js/practice-page-enhancer.js L462-L517](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L462-L517)

### Suite Navigation Handling

When the parent sends a `SUITE_NAVIGATE` message, the enhancer:

1. Stores the next exam ID if provided
2. Navigates to the new URL via `window.location.href`
3. Maintains suite mode state across navigation

**Sources:** [js/practice-page-enhancer.js L554-L568](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L554-L568)

## Communication Protocol Integration

The enhancer implements a robust initialization protocol with the parent window.

### Initialization Request Loop

```

```

This polling mechanism ensures the enhancer can establish communication even if the parent window's message listener isn't immediately ready.

**Sources:** [js/practice-page-enhancer.js L420-L450](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L420-L450)

### Exam ID Derivation

If the parent doesn't provide an exam ID, the enhancer derives one from the URL and title:

**URL Pattern Matching:**

```yaml
URL: .../97. P3 - The value of literary prizes 文学奖项的价值/...
Extracted: p3-97
```

**Title Pattern Matching:**

```yaml
Title: P2 - Some topic
Extracted: p2-some-topic
```

**Fallback:**
Returns page type (P1/P2/P3/unknown)

**Sources:** [js/practice-page-enhancer.js L585-L618](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L585-L618)

## Data Delivery Structure

The complete data package sent via `PRACTICE_COMPLETE` message:

```yaml
{
  // Session identification
  sessionId: "session_12345_abc",
  examId: "p2-42",
  derivedExamId: "p2-42",
  originalExamId: "p2-42",
  suiteSessionId: "suite_xyz123" | null,
  
  // Timing information
  startTime: 1699876543210,
  endTime: 1699876783450,
  duration: 240, // seconds
  
  // Answer data
  answers: {
    "q1": "B",
    "q2": "TRUE",
    "q3": "habitat"
  },
  correctAnswers: {
    "q1": "A",
    "q2": "TRUE",
    "q3": "habitat"
  },
  answerComparison: {
    "q1": {
      "userAnswer": "B",
      "correctAnswer": "A",
      "isCorrect": false
    },
    "q2": {
      "userAnswer": "TRUE",
      "correctAnswer": "TRUE",
      "isCorrect": true
    }
  },
  
  // Score information
  scoreInfo: {
    correct: 11,
    total: 13,
    accuracy: 0.846,
    percentage: 85,
    source: "final_score_extraction"
  },
  
  // Interaction log
  interactions: [
    {type: "answer", questionId: "q1", value: "B", timestamp: 1699876555000},
    {type: "click", target: "BUTTON.primary", timestamp: 1699876780000}
  ],
  
  // Page metadata
  pageType: "P2",
  url: "https://example.com/exam/p2.html",
  title: "P2 - Sample Exam"
}
```

**Sources:** [js/practice-page-enhancer.js L1253-L1270](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1253-L1270)

## Debugging and Diagnostic Tools

The enhancer provides global debugging functions:

### Available Debug Functions

| Function | Purpose | Returns |
| --- | --- | --- |
| `window.collectAnswersNow()` | Manually trigger answer collection | User answers object |
| `window.getCorrectAnswers()` | Extract correct answers | Correct answers object |
| `window.debugPracticeEnhancer()` | Print comprehensive debug info | Console output |
| `window.practicePageEnhancer.getStatus()` | Get current enhancer status | Status object |

### Status Object Structure

```yaml
{
  isInitialized: true,
  sessionId: "session_123",
  hasParentWindow: true,
  answersCount: 13,
  correctAnswersCount: 13,
  interactionsCount: 47,
  pageType: "P2"
}
```

**Sources:** [js/practice-page-enhancer.js L1470-L1504](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L1470-L1504)

## Cleanup and Resource Management

The enhancer implements cleanup to prevent memory leaks and conflicts when multiple instances run:

### Cleanup Process

```

```

**Cleanup Actions:**

* Clears answer collection intervals
* Stops initialization request loop
* Removes event listeners (via beforeunload)

**Sources:** [js/practice-page-enhancer.js L7-L14](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L7-L14)

 [js/practice-page-enhancer.js L363-L370](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L363-L370)

 [js/practice-page-enhancer.js L815-L820](https://github.com/sallowayma-git/IELTS-practice/blob/68771116/js/practice-page-enhancer.js#L815-L820)