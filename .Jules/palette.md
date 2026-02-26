## 2025-05-23 - [Card Button Accessibility]
**Learning:** Complex buttons containing headings and descriptions are often read as a single text blob by screen readers. Using `aria-labelledby` and `aria-describedby` allows for a structured and semantic announcement, while `aria-hidden="true"` on decorative icons reduces noise.
**Action:** Apply this pattern to all "card-like" interactive elements to ensure clear separation of label and description.
