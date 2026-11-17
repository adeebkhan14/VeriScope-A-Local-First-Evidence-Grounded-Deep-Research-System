# VeriScope — UI Design Specification

**Project:** VeriScope  
**Tagline:** Follow the evidence.  
**Document:** Design System & UI/UX Specification  
**Purpose:** Frontend implementation reference

---

## 1. Design Philosophy

VeriScope is a local-first, evidence-grounded AI research application.

The interface should combine:
- ChatGPT's clean conversational experience.
- Gemini's minimal interface.
- Perplexity's evidence and source presentation.

### Design principles

1. Minimalism over decoration.
2. Content over interface elements.
3. Evidence should be accessible but not intrusive.
4. Monochromatic colour palette.
5. Consistent spacing and typography.
6. Smooth, subtle interactions.
7. Light and dark theme support.

**Avoid:**
- Gradients.
- Excessive accent colours.
- Large dashboard cards.
- Unnecessary navigation.
- Decorative animations.
- Unnecessary graphical visualisations.
- Excessive icons.

The interface must feel like a professional research workspace rather than an administrative dashboard.

---

## 2. Application Layout

The application consists of two primary sections:

1. Left conversation sidebar.
2. Main conversation workspace.

### Desktop layout

- Sidebar: approximately 260px wide.
- Main workspace: remaining available width.
- Conversation content: maximum width approximately 850px.
- Composer: aligned with conversation content.
- Sidebar must be collapsible.

### Mobile layout

- Sidebar becomes a slide-in overlay.
- Main workspace occupies the full screen.
- Composer remains accessible at the bottom.
- Tables and code blocks must support horizontal scrolling.
- Avoid horizontal overflow.

---

## 3. Sidebar Design

### Structure

**Top section**
- VeriScope logo and name.
- New Research button.

**Middle section**
- Search conversations.
- Conversation history.
- Date-based grouping.

Conversation groups:
- Today
- Yesterday
- Previous 7 Days
- Older

**Bottom section**
- Settings.
- Theme selector.

### Interactions

- Sidebar opens and closes smoothly.
- Clicking a conversation restores its complete history.
- New Research creates a new conversation.
- Conversation deletion requires confirmation.
- Active conversation receives subtle highlighting.
- Long conversation titles are truncated.
- Sidebar must not dominate the main workspace.

### Styling

- No prominent borders.
- Neutral background.
- Subtle hover effects.
- Minimal icons.
- Consistent spacing.

---

## 4. Main Landing Screen

When no conversation is active, display a centred landing screen.

### Content

**VeriScope**

*Follow the evidence.*

Below the tagline, display the prompt composer.

### Behaviour

- Centre the content vertically and horizontally within the available workspace.
- Hide the landing heading and tagline after the first message is submitted.
- Transition into the conversation layout.
- Do not display unnecessary onboarding cards or example dashboards.

---

## 5. Prompt Composer

The prompt composer is the primary interaction component.

### Structure

The composer contains:

1. Multiline text input.
2. Research mode selector.
3. Alpha retrieval slider.
4. Forced web search toggle.
5. Send button.

### Visual design

- Rounded container.
- Subtle border.
- Neutral background.
- Comfortable internal padding.
- Clear focus state.
- No excessive shadows.

### Research modes

| Mode | Purpose |
|---|---|
| Fast | Prioritise response speed |
| Normal | Balanced research |
| Max | Maximum research depth |

These modes must map to existing backend configurations.

### Alpha slider

Controls the existing hybrid retrieval balance.

- Left: Keyword (BM25).
- Right: Semantic (MiniLM).
- Display current alpha value.
- Use a compact popover.
- Preserve the existing default value and mathematical convention.

### Forced web search

Display a globe icon in the composer.

**OFF**
- Existing automatic local-model assessment.
- Existing automatic web-search decision.

**ON**
- Always initiate web retrieval.
- Bypass the local-answer shortcut.
- Use the existing SearXNG retrieval pipeline.
- Continue through scraping, extraction, hybrid ranking, evidence sufficiency and citation validation.

The state must be included in the research request.

Use an explicit boolean parameter such as `forceWebSearch`.

Default: `false` for backward compatibility.

The frontend must clearly communicate whether forced web search is enabled.

### Keyboard interactions

- Enter: Submit.
- Shift + Enter: New line.
- Empty messages cannot be submitted.
- Prevent duplicate submissions.

---

## 6. Conversation Workspace

After the first message, the interface becomes a conversational workspace.

### User messages

- Subtle background distinction.
- Rounded container.
- Clear text hierarchy.
- No unnecessary user avatar.

### Assistant messages

- Clean text-first presentation.
- Maximum readable width.
- Markdown rendering.
- Inline citations.
- Evidence cards.
- Code blocks and tables.

### Conversation behaviour

- Maintain chronological message order.
- Preserve previous conversations.
- Restore messages from SQLite.
- Maintain research metadata and evidence references.
- Automatically scroll to the latest response when appropriate.
- Do not interrupt users reading previous messages.

The prompt composer stays at the bottom of the conversation.

---

## 7. Markdown Rendering

Use:

- `react-markdown`
- `remark-gfm`

Use custom React components to control presentation.

### Supported elements

- H1–H6 headings.
- Bold and italic text.
- Ordered lists.
- Unordered lists.
- Tables.
- Blockquotes.
- Inline code.
- Fenced code blocks.
- Links.
- Horizontal dividers.

### Formatting guidelines

Allow Qwen to choose the appropriate format.

Examples:

| Content type | Preferred presentation |
|---|---|
| Comparisons | Markdown tables |
| Technical explanations | Headings and paragraphs |
| Procedures | Numbered lists |
| Advantages/disadvantages | Lists or comparison tables |
| Statistics | Tables |
| Programming examples | Code blocks |
| Research findings | Paragraphs with citations |

Do not force tables into every response.

### Table design

- Full available content width.
- Subtle borders.
- Neutral header background.
- Consistent cell padding.
- Horizontal scrolling on smaller screens.
- No excessive colour coding.

### Code block design

- Monospace font.
- Neutral background.
- Syntax highlighting where available.
- Copy button.
- Horizontal scrolling for long lines.

### Security

- Disable raw HTML rendering.
- Do not execute model-generated HTML.
- Preserve citation references.
- Never modify citation identifiers during Markdown rendering.

---

## 8. Evidence Presentation

Evidence is a central feature of VeriScope.

Present evidence in compact, expandable cards.

### Evidence card structure

Each card should display available fields:

- Evidence number.
- Source title.
- Domain.
- Actual extracted supporting passage.
- Relevance score, if available.
- Related citation.
- External source link.

### Behaviour

- Expand/collapse.
- Subtle hover state.
- Clear source identification.
- Actual extracted passages.
- No fabricated evidence.
- No fabricated relevance scores.
- Preserve existing evidence identifiers.

### Visual hierarchy

1. Answer: Primary.
2. Inline citations: Integrated into the answer.
3. Evidence cards: Secondary.
4. Source links: Accessible within evidence cards.

Evidence cards should not overwhelm the response.

---

## 9. System Status

Display a small text-only status indicator.

Example:

`Systems operational · Local AI · Retrieval · Web search`

Requirements:

- Use existing health endpoints.
- Display actual system status.
- No large status panels.
- No unnecessary animations.
- No technology dashboard.
- No separate infrastructure cards.

The status indicator must remain visually unobtrusive.

---

## 10. Colour System

Use a monochromatic colour palette.

### Light theme

| Element | Colour |
|---|---|
| Main background | #FFFFFF |
| Sidebar background | #F7F7F7 |
| Primary text | #171717 |
| Secondary text | #737373 |
| Borders | #E5E5E5 |
| Card background | #FAFAFA |
| Hover background | #F0F0F0 |

### Dark theme

| Element | Colour |
|---|---|
| Main background | #171717 |
| Sidebar background | #202020 |
| Primary text | #F5F5F5 |
| Secondary text | #A1A1AA |
| Borders | #333333 |
| Card background | #222222 |
| Hover background | #2B2B2B |

### Colour rules

- Avoid gradients.
- Avoid bright accent colours.
- Use neutral grey for secondary information.
- Use colour sparingly for meaningful statuses.
- Maintain sufficient text contrast.

Use CSS variables for theme management.

---

## 11. Typography

Preferred font: Inter.

Fallback:
`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

### Typography hierarchy

| Element | Suggested size |
|---|---:|
| Landing title | 30–36px |
| Main headings | 24px |
| Section headings | 19–21px |
| Body text | 15–16px |
| Secondary text | 12–13px |
| Code | 13–14px |

Guidelines:

- Comfortable line height.
- Avoid excessively bold text.
- Consistent heading hierarchy.
- Readable paragraph widths.
- Avoid unnecessarily large titles.

---

## 12. Components and Styling

### General rules

- Border radius: approximately 10–14px.
- Consistent spacing scale.
- Subtle borders.
- Minimal shadows.
- Smooth transitions.
- Lucide icons.
- Consistent button sizing.

### Animation

Only use animations where they improve usability:

- Sidebar slide transition.
- Popover appearance.
- Theme transition.
- Expandable evidence cards.
- Subtle loading indicator.

Avoid elaborate page transitions and decorative motion.

---

## 13. Light and Dark Mode

Theme switching must be available through Settings.

Requirements:

- Persist theme preference.
- Apply theme consistently across the entire application.
- Support all Markdown elements.
- Support tables, evidence cards and code blocks.
- Avoid flashing the wrong theme during initial loading.
- Use CSS variables rather than duplicating component styles.

---

## 14. Backend Integration Constraints

This document defines frontend presentation and one explicitly permitted backend behaviour change.

All existing backend functionality must remain intact.

### Systems to preserve

- Ollama and Qwen.
- Local-model query assessment.
- SearXNG.
- Web scraping and extraction.
- BM25 retrieval.
- MiniLM semantic retrieval.
- Hybrid ranking.
- Alpha weighting.
- Evidence sufficiency.
- Citation validation.
- SQLite conversation persistence.
- Research modes.
- Existing API endpoints.

### Only intended backend change

Implement forced web search through the composer toggle.

When `forceWebSearch = true`:

- Skip the local-answer shortcut.
- Initiate web retrieval.
- Continue through the existing evidence-grounded pipeline.

When `forceWebSearch = false`:

- Preserve existing automatic research behaviour.

Do not redesign the backend or replace existing services.

---

## 15. Responsive Design

### Desktop

- Persistent collapsible sidebar.
- Centred conversation content.
- Bottom composer.
- Full-width responsive tables within the content area.

### Tablet

- Collapsible sidebar.
- Reduced conversation margins.
- Responsive composer.

### Mobile

- Slide-in sidebar.
- Full-width conversation.
- Compact composer controls.
- Horizontally scrollable tables.
- Readable code blocks.
- No horizontal page overflow.

---

## 16. Final Design Checklist

- [ ] Minimal ChatGPT-inspired layout.
- [ ] Collapsible conversation sidebar.
- [ ] Conversation search and history.
- [ ] New Research functionality.
- [ ] Fast / Normal / Max selector.
- [ ] Adjustable alpha slider.
- [ ] Forced web search toggle.
- [ ] Markdown rendering.
- [ ] Responsive Markdown tables.
- [ ] Code block styling and copy button.
- [ ] Inline citations.
- [ ] Expandable evidence cards.
- [ ] Text-only system status.
- [ ] Light and dark themes.
- [ ] Bottom-positioned composer.
- [ ] Responsive mobile layout.
- [ ] Existing backend functionality preserved.
- [ ] Existing SQLite conversation functionality preserved.

---

## 17. Final Design Principle

VeriScope should not compete through visual complexity.

Its identity should come from three things:

1. A clean conversational interface.
2. Strong evidence presentation.
3. Trustworthy, locally controlled research.

Every UI element must serve one of these purposes.

If an element does not improve usability, readability or evidence transparency, do not add it.

**Final direction: Minimal. Professional. Evidence-first. Local-first.**
