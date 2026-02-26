## 2026-02-23 - [Actionable Empty States]
**Learning:** The "Practice History" empty state was a dead end, providing information but no clear next step for new users. Adding a direct CTA ("Go to Practice") bridges the gap between intent and action.
**Action:** Always audit empty states for "dead ends" and provide a primary action button to guide the user to the core value of the feature.

## 2025-05-23 - [Card Button Accessibility]
**Learning:** Complex buttons containing headings and descriptions are often read as a single text blob by screen readers. Using `aria-labelledby` and `aria-describedby` allows for a structured and semantic announcement, while `aria-hidden="true"` on decorative icons reduces noise.
**Action:** Apply this pattern to all "card-like" interactive elements to ensure clear separation of label and description.
