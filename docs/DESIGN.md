# KeptPay Investor Web — DESIGN.md

## 1. Purpose

Build an Investor Web experience for presenting KeptPay to investors. The visitor should understand within a few minutes:

1. What problem KeptPay solves
2. How the payment flow works
3. How the business relates to regulatory requirements
4. What the investment is used to build
5. How the product / regulatory roadmap progresses
6. How each milestone increases company value

The website should feel like an **Interactive FinTech Pitch Deck**, not an Admin Dashboard and not a generic Corporate Website.

---

## 2. Core Message

### Primary positioning

> **KeptPay — Building Thailand's Payment Infrastructure**

Do not position the company as merely a "Payment Gateway".

Position it as:

> **Regulated Payment Infrastructure + Merchant Platform**

Growth path:

```text
Payment Gateway
      ↓
Merchant Platform
      ↓
Payout Infrastructure
      ↓
EDC + Card
      ↓
Acquiring
      ↓
Payment Infrastructure
```

---

## 3. Target Audience

Primary:
- Investors
- Strategic Investor
- Financial Institution / Banking Partner
- Corporate Partner

The audience should understand the business case without needing software architecture knowledge.

Therefore:
- Use business language first
- Show technical details only when they help explain value
- Regulatory details must be clearly separated from business assumptions

---

# 4. Design Direction

## Visual Style

**Premium FinTech / Institutional / Modern**

Reference feeling:
- Stripe
- Linear
- Vercel
- Modern investment presentation
- Financial infrastructure company

Do not copy any company's design.

### Characteristics

- Dark-first
- High contrast
- Large typography
- Minimal decoration
- Thin borders
- Large whitespace
- Subtle gradients
- Smooth transitions
- Data-driven visual hierarchy
- Avoid excessive cards

### Avoid

- Generic Bootstrap dashboard
- Excessive shadows
- Excessive rounded cards
- Colorful SaaS style
- Stock-photo hero
- Overloaded charts
- Excessive animations
- Fake financial numbers

---

# 5. Color System

Use CSS variables.

```css
--bg: #07090d;
--surface: #0d1117;
--surface-2: #121821;
--border: rgba(255,255,255,.10);

--text: #f5f7fa;
--muted: #8d98a7;

--accent: #7c9cff;
--accent-2: #5eead4;

--success: #45d483;
--warning: #f6c85f;
--danger: #ff6b7a;
```

Accent should be used for:
- Active state
- Workflow direction
- Timeline progress
- CTA
- Important numbers

Do not use accent as the background for every component.

---

# 6. Typography

Recommended:

```text
Inter
IBM Plex Sans
Noto Sans Thai
```

Thai text must render correctly.

Hierarchy:

```text
Hero        56–72px
Section     32–42px
Card title  18–22px
Body        14–17px
Meta        11–13px
```

Use large typography for investment numbers.

---

# 7. Page Structure

The page is a vertical storytelling experience.

```text
01 HERO
   ↓
02 OPPORTUNITY
   ↓
03 PAYMENT WORKFLOW
   ↓
04 REGULATORY JOURNEY
   ↓
05 CAPITAL STRATEGY
   ↓
06 PRODUCT ROADMAP
   ↓
07 MILESTONES
   ↓
08 INVESTMENT THESIS
```

Each section should feel like a "scene".

---

# 8. HERO

## Objective

Investor must immediately understand:

- What KeptPay is
- Where it is going
- How much capital is being raised

### Content

```text
KEPT PAY
THAILAND PAYMENT INFRASTRUCTURE

Building the infrastructure
behind modern payments.

QR · Credit Card · EDC · Payout

INITIAL INVESTMENT
฿30–50M+
```

### Animation

On load:

```text
KEPTPAY
   ↓
Gateway
   ↓
Payment Infrastructure
```

Use subtle fade + vertical movement.

Do NOT use aggressive animation.

---

# 9. OPPORTUNITY

## Story

Show the problem first.

```text
Merchant
   │
   ├── Bank A
   ├── Bank B
   ├── Card
   ├── QR
   ├── EDC
   └── Payout
```

Then transition into:

```text
Merchant
     │
     ▼
  KEPT PAY
     │
 ┌───┼────────┐
 ▼   ▼        ▼
 QR Card     EDC
     │
     ▼
  Payout
```

### Message

> One Integration. Multiple Payment Rails.

The visual should make the simplification obvious.

---

# 10. PAYMENT WORKFLOW

This is one of the most important sections.

## Workflow

```text
Customer
   ↓
Payment Channel
   ↓
KeptPay
   ↓
Risk / Routing
   ↓
Payment Network
   ↓
Settlement
   ↓
Merchant
```

Payment channels:

```text
QR
Credit Card
EDC
Online Payment
```

### Interaction

User can click/tap a payment channel.

Selected channel should:

1. Highlight it
2. Animate the transaction path
3. Show a short explanation
4. Update the "KeptPay role" panel

Example:

```text
CREDIT CARD

Customer
   ↓
Card / EDC
   ↓
KeptPay
   ↓
Acquirer / Network
   ↓
Merchant
```

Avoid claiming KeptPay is an Acquirer unless the actual regulatory/business model supports it.

---

# 11. REGULATORY JOURNEY

## Purpose

Investor must understand that regulatory execution is a milestone, not an afterthought.

### Timeline

```text
01
Self-Assessment
     ↓
02
BOT Discussion
     ↓
03
Pre-Approve
     ↓
04
Final Submission
     ↓
05
License
     ↓
Readiness
     ↓
GO LIVE
```

### Interaction

Timeline should animate as the user scrolls.

Each milestone can be clicked.

Show:

- Objective
- Required preparation
- Expected output
- Dependency

### Important

Do not promise a license date.

BOT process information must be presented as regulatory reference, not as a guaranteed project schedule.

The BOT reference states the process from Self-Assessment through discussion, pre-approval/document submission and readiness, with consideration time stated as up to 60 business days when requirements/documents are complete.

---

# 12. CAPITAL STRATEGY

Separate two concepts clearly.

## Regulatory Capital

Current planning reference:

```text
Payment Facilitating / Receiving
฿10M

Acquiring
฿50M
```

These are regulatory capital references, not total project cost.

## Project Investment

Planning envelope:

```text
฿30–50M+
```

Possible allocation:

```text
Regulatory Capital
Technology & Infrastructure
Security / Compliance
Team & Operations
Merchant Acquisition
```

### Visualization

Use a capital flow:

```text
               INVESTMENT
                   │
       ┌───────────┼───────────┐
       ↓           ↓           ↓
   Regulatory     Tech       Operations
     Capital       │             │
                   ↓             ↓
                Platform      Merchants
                   └─────┬───────┘
                         ↓
                       GMV
                         ↓
                      Revenue
```

The allocation numbers must remain labeled as **business planning assumptions**, not BOT requirements.

---

# 13. PRODUCT ROADMAP

Three phases.

## Phase 1 — Foundation

```text
Core Gateway
Merchant API
QR Payment
Settlement
Dashboard
```

Goal:

> Launch a production-ready payment platform.

---

## Phase 2 — Scale

```text
Third-Party Payout
EDC
Credit Card
Risk Engine
Reconciliation
```

Goal:

> Increase merchant value and transaction volume.

---

## Phase 3 — Acquiring

```text
Direct Acquiring
Deeper Payment Infrastructure
Higher Control
Potential Margin Expansion
Regional Expansion
```

Goal:

> Reduce dependency on upstream providers when scale justifies additional capital and regulatory scope.

---

# 14. MILESTONE SYSTEM

Do not show milestones as a simple checklist.

Show:

```text
CAPITAL
   ↓
REGULATORY
   ↓
PRODUCT
   ↓
FIRST MERCHANT
   ↓
TRANSACTION VOLUME
   ↓
SCALE
   ↓
ACQUIRING
```

Recommended milestone categories:

### Regulatory

- Business model defined
- BOT discussion
- Application
- License
- Readiness

### Product

- MVP
- Production Gateway
- QR
- Payout
- EDC
- Card

### Commercial

- First merchant
- First transaction
- Transaction revenue
- Merchant growth
- GMV growth

### Infrastructure

- Reconciliation
- Risk engine
- Settlement
- Monitoring
- Security

---

# 15. INVESTOR VALUE LOOP

This should be visually prominent.

```text
Investment
    ↓
Technology
    ↓
Regulatory Capability
    ↓
Merchant Acquisition
    ↓
Transaction Volume
    ↓
Revenue
    ↓
Scale
    ↓
More Payment Capability
    ↓
Higher Strategic Value
```

Core thesis:

> More merchants → More transactions → More revenue → More infrastructure leverage.

---

# 16. FINAL INVESTMENT THESIS

Final screen should be simple.

```text
KEPT PAY

Not just a gateway.

A payment infrastructure platform
built for Thailand.

฿30–50M+
INITIAL INVESTMENT
```

Then three pillars:

```text
REGULATED
TECHNOLOGY
SCALE
```

CTA:

```text
DISCUSS THE INVESTMENT
```

---

# 17. Transition System

Use a consistent transition language.

## Section enter

```text
opacity: 0 → 1
transform: translateY(24px) → translateY(0)
```

Duration:

```text
500–800ms
```

Easing:

```text
cubic-bezier(.22,1,.36,1)
```

## Workflow

Use sequential highlighting:

```text
Node 1 → Node 2 → Node 3 → Node 4
```

Duration per node:

```text
400–700ms
```

## Timeline

When entering viewport:

```text
line grows vertically
milestones appear sequentially
```

Respect:

```css
prefers-reduced-motion
```

---

# 18. Scroll Behavior

Use scroll-driven storytelling.

Preferred behavior:

```text
Section enters viewport
       ↓
Headline appears
       ↓
Visual activates
       ↓
Supporting information appears
```

Do not lock the entire page into full-screen sections.

Normal scrolling must remain usable.

---

# 19. Navigation

Desktop:

```text
KeptPay
Overview
Workflow
Regulatory
Capital
Roadmap
Milestones
Invest
```

Mobile:

- Compact header
- Menu button
- Section navigation

Navigation should indicate current section.

---

# 20. Data Integrity Rules

This is critical.

Never mix:

### BOT facts

with:

### KeptPay assumptions

or:

### Investor projections

Use labels:

```text
BOT REQUIREMENT
BUSINESS ASSUMPTION
INVESTOR TARGET
```

Examples:

```text
฿10M
BOT / Regulatory Capital Reference

฿30–50M+
KeptPay Fundraising Planning Envelope
```

Never present an internal estimate as an official BOT requirement.

---

# 21. Content Rules

Use short statements.

Prefer:

> One Integration. Multiple Payment Rails.

Instead of:

> KeptPay is a comprehensive payment gateway solution...

Prefer:

> Build → Scale → Acquire

Instead of long explanations.

Detailed explanations should appear only when user expands a section.

---

# 22. Responsive Design

Desktop:

```text
1200px+
```

Tablet:

```text
768–1199px
```

Mobile:

```text
320–767px
```

Requirements:

- No horizontal page scrolling
- Workflow stacks vertically on mobile
- Timeline remains readable
- Large numbers remain visible
- Navigation collapses
- Touch targets ≥ 44px

---

# 23. Accessibility

Must support:

- Keyboard navigation
- Focus states
- Semantic buttons
- ARIA where needed
- Reduced motion
- Sufficient contrast
- Screen-reader meaningful labels

Never make information available only through hover.

---

# 24. Technical Architecture

Recommended:

```text
/
├── index.html
├── assets/
│   ├── logo/
│   ├── icons/
│   └── images/
├── css/
│   ├── tokens.css
│   ├── base.css
│   ├── components.css
│   └── investor.css
├── js/
│   ├── app.js
│   ├── navigation.js
│   ├── workflow.js
│   ├── timeline.js
│   └── animations.js
└── DESIGN.md
```

Keep sections modular.

Do not put the entire site into one giant JavaScript file.

---

# 25. Component Model

Recommended components:

```text
Header
Hero
SectionIntro
PaymentWorkflow
PaymentRailSelector
RegulatoryTimeline
CapitalStrategy
Roadmap
MilestoneGrid
InvestmentThesis
Footer
```

Each component should have:

- HTML
- CSS class namespace
- JS only when interaction is required

---

# 26. Animation Architecture

Prefer native browser APIs.

Use:

```text
IntersectionObserver
CSS transitions
CSS keyframes
requestAnimationFrame
```

Do not add a large animation library unless there is a clear requirement.

Animation should communicate:

- Direction
- Progress
- Relationship
- Hierarchy

Never animate only for decoration.

---

# 27. Investor UX Principle

The user should be able to answer these questions in order:

```text
WHAT?
   ↓
WHY?
   ↓
HOW?
   ↓
CAN WE?
   ↓
HOW MUCH?
   ↓
WHEN?
   ↓
WHAT DO I GET?
```

Map to:

```text
WHAT   → KeptPay
WHY    → Opportunity
HOW    → Payment Workflow
CAN WE  → Regulatory
HOW MUCH → Capital
WHEN   → Roadmap / Timeline
WHAT DO I GET → Investment Thesis
```

---

# 28. Source of Truth

Current investor planning source:

`KeptPay Investor View.txt`

The existing document contains the current planning assumptions and presentation direction, including:

- ฿10M regulatory-capital reference
- ฿50M acquiring reference
- ฿30–50M+ investment planning envelope
- Regulatory journey
- Product roadmap
- Investor thesis

Use the document as the content baseline.

For regulatory claims, verify against the current Bank of Thailand source before production release.

---

# 29. Out of Scope for V1

Do not implement yet:

- Real payment processing
- Real API calls
- Login
- Merchant dashboard
- Real-time transaction data
- Investor authentication
- Financial forecasting engine
- Real regulatory application submission
- Real payment credentials

This website is an **Investor Presentation Experience**, not the production payment platform.

---

# 30. Definition of Done

V1 is complete when:

- [ ] Investor understands KeptPay within 30 seconds
- [ ] Payment workflow is visually understandable
- [ ] QR / Card / EDC / Payout are clearly differentiated
- [ ] Regulatory process is understandable
- [ ] BOT requirements and company assumptions are separated
- [ ] Capital strategy is understandable
- [ ] Product roadmap is understandable
- [ ] Milestones connect capital to business growth
- [ ] Transitions are smooth but restrained
- [ ] Mobile experience works
- [ ] Keyboard navigation works
- [ ] Reduced-motion mode works
- [ ] No fake financial projections are presented as facts
- [ ] No regulatory claim is presented without a source
- [ ] Page feels like an investor presentation, not an admin dashboard

---

## Final Design Principle

**Make the investor feel the business progressing.**

The page should visually communicate:

```text
IDEA
 ↓
REGULATORY
 ↓
PRODUCT
 ↓
MERCHANTS
 ↓
TRANSACTIONS
 ↓
REVENUE
 ↓
SCALE
 ↓
ACQUIRING
 ↓
PAYMENT INFRASTRUCTURE
```

That progression is the story of KeptPay.
