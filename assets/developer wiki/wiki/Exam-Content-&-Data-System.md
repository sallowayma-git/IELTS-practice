# Exam Content & Data System

> **Relevant source files**
> * [.gitignore](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/.gitignore)
> * [assets/data/path-map.json](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/data/path-map.json)
> * [assets/scripts/complete-exam-data.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js)
> * [assets/scripts/listening-exam-data.js](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js)
> * [developer/tests/e2e/fixtures/index.html](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/e2e/fixtures/index.html)
> * [developer/tests/e2e/path_compatibility_playwright.py](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/developer/tests/e2e/path_compatibility_playwright.py)

This document covers the exam content data structures, question bank organization, and content management systems that form the foundation of the IELTS practice application. It details how exam questions are structured, stored, and accessed by the application.

For information about how this data is loaded and managed at runtime, see [Storage Manager & Persistence](/sallowayma-git/IELTS-practice/4.1-repository-architecture-and-data-layer). For details on how practice sessions consume this exam data, see [Practice Session System](/sallowayma-git/IELTS-practice/5-practice-session-system).

## Data Structure Overview

The system maintains two primary exam data collections that provide different types of practice content:

### Listening Exam Index

The `listeningExamIndex` provides audio-based listening practice materials organized by difficulty parts (P3, P4). This collection is defined in [assets/scripts/listening-exam-data.js L4](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L4-L4)

 and contains 142 listening exercises.

### Complete Exam Index

The `completeExamIndex` provides comprehensive reading practice materials organized by passage difficulty (P1, P2, P3) and frequency classification. This collection is defined in [assets/scripts/complete-exam-data.js L5](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js#L5-L5)

 and contains 83 reading passages.

## Exam Data Schema

Each exam entry follows a consistent data structure optimized for application integration and content delivery:

```

```

**Sources:** [assets/scripts/listening-exam-data.js L4-L1711](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L4-L1711)

 [assets/scripts/complete-exam-data.js L5-L941](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js#L5-L941)

## Content Organization by Type

### Listening Practice Structure

Listening exams are organized by IELTS part difficulty with specific audio integration requirements:

| Category | Count | Audio Required | Typical Topics |
| --- | --- | --- | --- |
| P3 | 60 exercises | Yes (`audio.mp3`) | Academic discussions, student conversations |
| P4 | 82 exercises | Yes (`audio.mp3`) | Academic lectures, monologues |

Each listening exercise includes:

* HTML practice interface ([assets/scripts/listening-exam-data.js L13](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L13-L13) )
* PDF reference materials ([assets/scripts/listening-exam-data.js L15](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L15-L15) )
* MP3 audio files ([assets/scripts/listening-exam-data.js L16](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L16-L16) )

### Reading Practice Structure

Reading passages are organized by difficulty and practice frequency:

| Category | High Frequency | Medium Frequency | Content Focus |
| --- | --- | --- | --- |
| P1 | 12 passages | 8 passages | Factual texts, advertisements |
| P2 | 22 passages | 6 passages | Work-related texts, general interest |
| P3 | 20 passages | 15 passages | Academic texts, complex arguments |

**Sources:** [assets/scripts/complete-exam-data.js L6-L941](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js#L6-L941)

## File System Organization

The exam content follows a hierarchical file structure that mirrors the data organization:

```

```

**Sources:** [assets/scripts/listening-exam-data.js L11-L16](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L11-L16)

 [assets/scripts/complete-exam-data.js L12-L16](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js#L12-L16)

## Application Integration

The exam data integrates with core application components through standardized loading and access patterns:

```

```

### Data Access Patterns

The application accesses exam data through global window objects that are loaded during initialization:

* **Listening Data**: `window.listeningExamIndex` ([assets/scripts/listening-exam-data.js L4](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L4-L4) )
* **Complete Data**: `window.completeExamIndex` ([assets/scripts/complete-exam-data.js L5](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js#L5-L5) )

### Content Delivery Flow

1. **Index Loading**: Application loads exam indices during startup
2. **Content Selection**: User selects exam from available options
3. **Path Resolution**: System constructs file paths using exam metadata
4. **Content Delivery**: Practice window loads HTML/PDF content
5. **Audio Integration**: MP3 files stream for listening exercises

**Sources:** [assets/scripts/listening-exam-data.js L4](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L4-L4)

 [assets/scripts/complete-exam-data.js L5](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js#L5-L5)

## Data Validation and Quality Control

### Metadata Consistency

Each exam entry maintains consistent metadata fields that enable application functionality:

* **Unique Identifiers**: Sequential IDs within categories ([assets/scripts/listening-exam-data.js L7](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L7-L7)  [assets/scripts/complete-exam-data.js L8](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js#L8-L8) )
* **Resource Flags**: Boolean indicators for content availability ([assets/scripts/listening-exam-data.js L13-L14](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L13-L14) )
* **Path Validation**: Structured paths enable automated content loading ([assets/scripts/listening-exam-data.js L11](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L11-L11) )

### Version Control

Both data files include version metadata for tracking content updates:

* **Listening Data**: Version 1.5, updated 2025-09-18 ([assets/scripts/listening-exam-data.js L2-L3](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L2-L3) )
* **Complete Data**: Version 3.0, updated 2025-09-04 ([assets/scripts/complete-exam-data.js L2-L4](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js#L2-L4) )

### Content Integrity

The system supports multiple content formats to ensure robust content delivery:

| Content Type | Primary Format | Backup Format | Validation |
| --- | --- | --- | --- |
| Practice Interface | HTML | PDF | `hasHtml`, `hasPdf` flags |
| Audio Content | MP3 | N/A | File path validation |
| Reference Materials | PDF | HTML | Format availability checking |

**Sources:** [assets/scripts/listening-exam-data.js L13-L16](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/listening-exam-data.js#L13-L16)

 [assets/scripts/complete-exam-data.js L14-L16](https://github.com/sallowayma-git/IELTS-practice/blob/df0c9b8f/assets/scripts/complete-exam-data.js#L14-L16)