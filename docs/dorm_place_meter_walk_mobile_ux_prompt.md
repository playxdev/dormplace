# dorm.place — เดินจดมิเตอร์ Mobile UX Prompt

## Role

Act as a Senior Mobile UX Designer and Senior Frontend Engineer.

Design and implement the **"เดินจดมิเตอร์" (Meter Walk)** feature for `dorm.place`, a rental-property operating system for Thai SME landlords.

This is NOT a normal meter-management table.

It is a dedicated **mobile field-work workflow** for staff who physically walk through a building while holding one smartphone and recording water and electricity meter readings.

Optimize for:

> **Speed + One-Hand Use + Minimal Taps + Large Inputs + Clear Progress**

---

## 1. Product Decision

`dorm.place` must have two separate meter experiences.

### Field Mode

**เดินจดมิเตอร์**

For mobile field workers.

### Office Mode

**จัดการมิเตอร์**

For desktop users who review, correct, analyze, audit, and manage meter data.

**Do NOT simply make the desktop meter table responsive.**

These are two different workflows.

---

## 2. Field Workflow

The normal workflow should be:

```text
Open
 ↓
Select Property
 ↓
Select Building / Floor
 ↓
Start
 ↓
Room 101
 ↓
Enter Water
 ↓
Enter Electricity
 ↓
Save
 ↓
Room 102
 ↓
Enter Water
 ↓
Enter Electricity
 ↓
Save
 ↓
...
 ↓
Finish
```

Core principle:

> **One room = one simple screen**

The user should not have to manually search for the next room.

---

## 3. Entry Point

Make **เดินจดมิเตอร์** a prominent action on the owner dashboard.

Example:

```text
┌──────────────────────────────┐
│                              │
│       เดินจดมิเตอร์           │
│                              │
│   น้ำ + ไฟ                   │
│   42 ห้องรอจด                 │
│                              │
│      [ เริ่มเดินจด ]          │
│                              │
└──────────────────────────────┘
```

---

## 4. Start Screen

Show:

```text
เดินจดมิเตอร์

บ้านสวนอพาร์ทเมนท์
อาคาร A

สิงหาคม 2569

16 ห้อง
12 จดแล้ว
3 รอจด
1 ข้าม
```

Progress:

```text
████████████░░░░ 75%

12 / 16 ห้อง
```

Primary action:

> **เริ่มเดินจดมิเตอร์**

Secondary:

> ดูประวัติการจดครั้งล่าสุด

---

## 5. Room Ordering

Automatically sort:

> Building → Floor → Room Number

Example:

```text
101
102
103
104
105
106
```

Normal operation should automatically move to the next room.

---

## 6. Room Screen

This is the most important screen.

Header:

```text
‹     ห้อง 102
```

Tenant:

```text
อรทัย ศรีสุข
เข้าพัก 01/01/2566
```

Progress:

```text
ห้อง 12 จาก 16
████████████░░░░
```

---

## 7. Water Meter

Create a large input card:

```text
💧 มิเตอร์น้ำ

ครั้งก่อน
377 หน่วย

ครั้งนี้

┌─────────────────────────┐
│                         │
│          383            │
│                    หน่วย │
└─────────────────────────┘

ใช้ไป
6 หน่วย
```

Current reading input must be:

- Large
- Easy to tap
- Numeric keyboard
- Large font
- High contrast
- Easy to edit

When focused, clearly highlight the active field.

---

## 8. Electricity Meter

Use the same interaction:

```text
⚡ มิเตอร์ไฟ

ครั้งก่อน
4,191 หน่วย

ครั้งนี้

┌─────────────────────────┐
│                         │
│         4,402           │
│                    หน่วย │
└─────────────────────────┘

ใช้ไป
211 หน่วย
```

Usage must be calculated automatically:

```text
Current - Previous
```

The user must never calculate it manually.

---

## 9. One-Handed Use

This is a critical requirement.

Design for a thumb-operated smartphone.

Requirements:

- Large tap targets
- Comfortable spacing
- Sticky bottom action
- No horizontal scrolling
- No multi-column layouts
- No tiny controls
- Numeric keyboard for meter fields
- Primary action accessible near the bottom

Assume the user may be walking while using the application.

---

## 10. Primary Action

Use a sticky bottom action:

> **บันทึกและไปห้องถัดไป →**

After saving:

```text
Room 102
✓ Saved

Automatically open:

Room 103
```

The user should not need to navigate back to a room list.

---

## 11. Skip Room

Provide:

> **ข้ามห้องนี้**

Make it secondary.

Require a reason:

```text
ข้ามห้องนี้

○ ไม่มีผู้เช่า
○ เข้าห้องไม่ได้
○ มิเตอร์เสีย
○ อื่น ๆ

[ ยืนยันการข้าม ]
```

---

## 12. Validation

Validate immediately.

If previous reading is:

```text
4,402
```

and user enters:

```text
4,100
```

show:

```text
⚠ ค่ามิเตอร์ต่ำกว่าครั้งก่อน

ครั้งก่อน 4,402
ครั้งนี้  4,100
```

Never silently accept suspicious values.

Allow:

```text
[ แก้ไข ]
[ ยืนยันว่าอ่านถูกต้อง ]
```

---

## 13. Abnormal Usage

If usage is significantly different from historical usage:

```text
⚠ การใช้ไฟสูงผิดปกติ

ใช้ไป
520 หน่วย

สูงกว่าค่าเฉลี่ยประมาณ 70%
```

Do not automatically reject the value.

Allow the staff member to confirm it.

---

## 14. Photo

Add optional:

> **📷 ถ่ายรูปมิเตอร์**

Attach the photo to the meter reading.

Use cases:

- Evidence
- Dispute resolution
- Owner verification
- Future OCR

Do not make photos mandatory in MVP.

---

## 15. Future OCR

Prepare the UI architecture for:

```text
Camera
 ↓
Meter Photo
 ↓
OCR
 ↓
Detected Value
 ↓
User Confirmation
```

Example:

```text
อ่านค่ามิเตอร์ได้

4,402

[ ใช้ค่านี้ ]
[ แก้ไข ]
```

Do NOT implement OCR unless explicitly requested.

---

## 16. Progress

Progress must always be visible.

Example:

```text
12 / 16 ห้อง
████████████░░░░
```

Status:

```text
✓ จดแล้ว      12
○ รอจด         3
— ข้าม          1
```

---

## 17. Optional Room List

Provide an optional room list:

```text
101   ✓ จดแล้ว
102   ✓ จดแล้ว
103   ○ กำลังจด
104   ○ รอจด
105   — ข้าม
106   ○ รอจด
```

The user may jump to a room when necessary.

Normal operation remains sequential.

---

## 18. Completion Screen

After all rooms:

```text
✓

บันทึกเรียบร้อย

16 / 16 ห้อง

น้ำ
16 / 16

ไฟ
16 / 16
```

If there are warnings:

```text
มี 2 รายการที่ควรตรวจสอบ

⚠ ห้อง 104 ใช้ไฟสูงผิดปกติ
⚠ ห้อง 108 มีหมายเหตุ
```

Primary:

> **ดูสรุป**

Secondary:

> **กลับหน้าหลัก**

---

## 19. Offline-First Behavior

The field workflow must tolerate poor connectivity.

Target workflow:

```text
Start
 ↓
Download room list
 ↓
Record readings locally
 ↓
Continue walking
 ↓
Internet available
 ↓
Sync
```

At minimum, support resilient local draft state.

Never lose entered readings because of temporary network failure.

Show:

```text
● บันทึกในเครื่องแล้ว
```

and later:

```text
✓ Sync แล้ว
```

---

## 20. Data Model

Conceptually:

```text
property_id
building_id
room_id
tenant_id
meter_type
previous_reading
current_reading
usage
reading_date
recorded_by
photo
note
status
sync_status
created_at
updated_at
```

Do not modify the existing database schema without explicit approval.

Adapt to the project's existing architecture.

---

## 21. Dark / Light Mode

Support:

### Light

Clean, warm, high readability.

### Dark

Deep neutral background with warm yellow/amber accent.

Use the global `dorm.place` theme system.

Use this repository as a technical/interaction reference:

https://github.com/cookievirus/darkmode

Reference concepts:

- Sun/moon toggle
- Animated theme reveal
- CSS variables
- No-FOUC initialization
- Keyboard accessibility
- Reduced motion

Do not copy its UI directly.

---

## 22. Mobile Visual Style

Use:

- Large rounded cards
- Soft borders
- Minimal shadows
- Large typography
- Strong spacing
- Clear status indicators
- Large primary buttons
- Comfortable touch targets

Avoid:

- Dense tables
- Tiny inputs
- Desktop sidebars
- Horizontal scrolling
- Small dropdowns
- Excessive modal dialogs

---

## 23. Thai UX

This is designed for Thai property staff.

Use natural Thai terminology.

Prefer:

> เดินจดมิเตอร์

instead of:

> Meter Management

Use:

> มิเตอร์น้ำ

> มิเตอร์ไฟ

> ครั้งก่อน

> ครั้งนี้

> ใช้ไป

> บันทึกและไปห้องถัดไป

Keep technical terminology out of the UI unless necessary.

---

## 24. Error Handling

Network:

> ไม่สามารถเชื่อมต่อได้ ข้อมูลถูกบันทึกไว้ในเครื่อง

Invalid value:

> กรุณาตรวจสอบค่ามิเตอร์

Missing value:

> กรุณากรอกค่ามิเตอร์ไฟ

Suspicious value:

> ค่านี้ต่ำกว่าครั้งก่อน

Never lose user input.

---

## 25. Accessibility

Support:

- Large touch targets
- Screen-reader labels
- High contrast
- Focus states
- Reduced motion
- Semantic HTML

Do not rely only on color to communicate status.

---

## 26. Performance

The meter workflow must feel instant.

Avoid unnecessary:

- API calls
- Page reloads
- Heavy animations
- Network dependencies

Saving a room should feel immediate.

---

## 27. UX Success Criteria

The design is successful if a staff member can:

> Pick up one phone → start the task → record water + electricity for 20–100 rooms → finish without feeling like they are filling out a spreadsheet.

Target interaction:

```text
Open
 ↓
Start
 ↓
Water
 ↓
Electricity
 ↓
Save
 ↓
Next Room
```

Ideal interaction:

> **2 numeric inputs + 1 primary action per room**

---

## 28. Important

Do NOT turn this into a responsive version of the existing desktop meter table.

Build it as a completely separate:

> **Mobile Field Workflow**

The desktop table remains useful for:

- Review
- Correction
- Search
- Reporting
- Audit
- Bulk editing

The mobile **เดินจดมิเตอร์** experience exists specifically for:

> **Walking + Reading + Recording + Moving to the next room**

---

# FINAL UX PRINCIPLE

The entire feature should feel like:

> **"เดิน → จด → บันทึก → ไปห้องถัดไป"**

not:

> **"เปิดระบบ → กรอกแบบฟอร์ม → จัดการข้อมูลมิเตอร์"**
