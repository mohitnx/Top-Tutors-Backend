# SAP ADMINISTRATION DAILY DASHBOARD -- Generation Template
## Self-Study Assistance Program -- TopTutors.ai
### Version 2.0 | March 2026

---

## RENDERING GUARDRAILS (ADMIN REPORT)

These rules are mandatory for every admin report. Read SAP_PRINCIPLES.md Part G1-G8 for the full specification. This section is a quick-reference subset for the admin report specifically.

### AR-G1: SYMBOL REPLACEMENTS FOR THIS REPORT

| Original | Replacement | Where Used |
|---|---|---|
| (up arrow) | [UP] | Trend, status, predictions |
| (down arrow) | [DN] | Decline indicators |
| (right arrow) | [FLAT] | Stable trend |
| (warning) | [!] | Warning predictions, alerts |
| (check mark) | MET | Target achieved |
| (em dash) | -- | Missing data |
| (ge/le symbols) | >= or <= | Threshold targets |
| ALL emoji | NONE -- text labels only | Entire report |

### AR-G2: TONE RULES

1. Strategic, data-dense, decision-focused.
2. No emotional language. No praise of individual students.
3. Every number must lead to a resource allocation or policy decision.
4. NEVER name individual students. Use counts, grades, and percentages only.
5. Exception: At-risk alerts reference grade and count, never names.
6. No honorifics. Professional, neutral tone throughout.

### AR-G3: DATA INTEGRITY

1. NEVER invent data. All numbers must come from the input.
2. If data not provided: use "--" or "Data pending."
3. The report covers the ENTIRE school for ONE day.
4. QQS values: 1 decimal place.
5. Percentages: integers with % sign.
6. Counts: integers, comma-separated for >=1000 (e.g., "1,248").

### AR-G4: TABLE LIMITS

- Grade-Wise Command Center: maximum 10 columns
- Department Board: maximum 8 columns
- Health Scorecard: exactly 6 columns, exactly 8 rows
- Priority Alerts: exactly 3 columns
- Predictions: exactly 4 columns
- All cells: maximum 80 characters, one line only

### AR-G5: ALERT ORDERING

Alerts MUST be sorted by severity in this exact order:
URGENT --> HIGH --> MEDIUM --> WATCH --> POSITIVE --> MILESTONE

Every report MUST include at least 1 POSITIVE or MILESTONE alert. Reports should never be exclusively negative.

---

## REPORT STRUCTURE (Follow This Exactly)

### SECTION 1: HEADER

```
PRINCIPAL'S DAILY DASHBOARD

Principal: [Full Name]    Total Students: [N]    Faculty: [N]    Date: [DD Month YYYY]
```

---

### SECTION 2: HEADLINE METRICS (5-Box Summary)

A single row of exactly 5 metric boxes:

| TOTAL QUESTIONS | PARTICIPATION | SCHOOL AVG QUALITY | SCHOOL LEVEL | AT-RISK |
|---|---|---|---|---|
| [N] | [X]% | [X.X] | Lv [X.X] | [N] students |

Calculation rules:
- Box 1: Sum of all questions across all grades today
- Box 2: (Active students / Total enrolled) x 100%. Integer percentage.
- Box 3: School-wide mean QQS (1 decimal)
- Box 4: School level from School Avg QQS. Show as "Lv X.X" with 1 decimal.
- Box 5: Count of students meeting ANY at-risk flag

---

### SECTION 3: SCHOOL PULSE

```
SCHOOL PULSE    [Score] / 100

Today's Headline
```

School Pulse Score: calculated per Principles Part 8.1. Integer / 100.

Narrative paragraph must include ALL of the following in natural prose:
1. Participation headline -- current rate and comparison to program start
2. Top improving grade -- which grade improved most this week, with metric
3. Biggest concern -- most urgent systemic issue
4. At-risk summary -- count, grade range affected
5. Quality leader -- which grade or cohort leads quality, with QQS

Length: 4-6 sentences.

Example:

School participation reached 81% -- up from 65% at program start. Grade 10 is the week's top improver (+12% engagement). Science Department carries 6 misconception clusters affecting 23+ students -- the highest load across all departments and requires a department meeting. 12 students across Grades 8-10 have gone silent for 3+ days. A-Level cohort continues to lead quality at 6.2 average -- the only grade band operating at Analyst level.

---

### SECTION 4: SCHOOL COMMAND CENTER -- GRADE-WISE

```
School Command Center -- Grade-Wise
```

Table columns (fixed, per Principles Part 8.2):

| GRADE | TOTAL | ACTIVE | RATE | Qs | AVG QQS | TREND | LEVEL | KEY SIGNAL |
|---|---|---|---|---|---|---|---|---|

Rules:
- One row per grade band
- Final row: TOTAL with school-wide aggregates
- RATE shown as percentage
- TREND: [UP] (improved >=0.3 from last week), [FLAT] (within +/-0.3), [DN] (declined >=0.3)
- LEVEL: full name (e.g., "Lv 2 Builder")
- KEY SIGNAL: <=8 words
- Sorting: By Grade ascending (youngest first)

---

### SECTION 5: DEPARTMENT PERFORMANCE BOARD

```
Department Performance Board

Ranked by learning impact (quality x engagement). No competition -- for resource allocation decisions.
```

Table columns (fixed, per Principles Part 8.3):

| RANK | DEPARTMENT | Qs | QQS | MISC | TREND | HEALTH | INSIGHT |
|---|---|---|---|---|---|---|---|

Rules:
- Ranked by (Avg QQS normalized x Participation Rate) descending
- MISC = active misconception clusters
- TREND = "[UP] +X%", "[FLAT] Steady", or "[DN] -X%"
- HEALTH = Thriving / Healthy / Watch / Monitor / Concern (per Principles Part 8.4)
- INSIGHT = <=8 words
- Show ALL departments

The subtitle "No competition -- for resource allocation decisions" is MANDATORY.

---

### SECTION 6: PRIORITY ALERTS

```
Priority Alerts
```

Table columns (fixed):

| LEVEL | ALERT | ACTION REQUIRED |
|---|---|---|

Rules:
- Show ALL active alerts, sorted per AR-G5 order
- ALERT = 1-2 sentences. Student-related: reference grade and count, NEVER names.
- ACTION REQUIRED = specific action + who should do it
- Always include >=1 POSITIVE or MILESTONE
- Typical range: 5-8 alerts

---

### SECTION 7: SCHOOL HEALTH SCORECARD

```
School Health Scorecard

Key metrics tracked daily. Values compound over time.
```

Table columns (fixed):

| METRIC | TODAY | LAST WEEK | CHANGE | STATUS | TERM TARGET |
|---|---|---|---|---|---|

The 8 metrics are FIXED, always in this order:

1. Daily Participation -- % -- Target: >=75%
2. Avg Question Quality -- QQS -- Target: >=5.0
3. At-Risk Students -- Count -- Target: <15
4. Misconception Clusters -- Count -- Target: <20
5. Productive Struggle % -- Bloom >=3 questions / Total -- Target: >=60%
6. Question Depth (% Bloom 4+) -- Bloom >=4 / Total -- Target: >=30%
7. Teacher Brief Usage -- X/Y teachers -- Target: Y/Y (100%)
8. Gender Parity Index -- GPI value -- Target: 0.95-1.05

Column rules:
- TODAY values in CAPS or marked bold
- CHANGE = "+X%" or "-X" or "+X.XX" depending on metric
- STATUS = [UP] (improving), [FLAT] (stable), [DN] (declining)
- Mark targets that are MET with "MET" suffix

Followed by up to 2 research citations (per Principles Part 12). Only when relevant.

---

### SECTION 8: WEEK AHEAD -- PATTERN PREDICTIONS

```
Week Ahead -- Pattern Predictions

Based on [X]-week trend analysis:
```

Table columns (fixed):

| SIGNAL | PREDICTION | CONFIDENCE | PREEMPTIVE ACTION |
|---|---|---|---|

Rules:
- Show 4-6 predictions
- SIGNAL = [UP], [DN], [FLAT], or [!]
- PREDICTION = 1-2 sentence forward-looking statement
- CONFIDENCE = High (>=80%), Medium (60-79%), or Low (<60%)
- PREEMPTIVE ACTION = specific action to take NOW
- Include >=1 positive and >=1 concern prediction
- If <3 weeks data: show with "Low" confidence and note it

---

### SECTION 9: CLOSING LINE

```
Every question asked is a student choosing to learn. Today, [N] students made that choice.
```

Replace [N] with total active students. This structure is FIXED -- only the number changes.

---

### SECTION 10: FOOTER

```
SAP - Self-Study Assistance Program - TopTutors Private Limited
```

---

## DEMO: COMPLETE ADMINISTRATION REPORT (v2.0 format)

---

PRINCIPAL'S DAILY DASHBOARD

Principal: Hom Nath Acharya    Total Students: 1,136    Faculty: 75    Date: 16 March 2026

---

| TOTAL QUESTIONS | PARTICIPATION | SCHOOL AVG QUALITY | SCHOOL LEVEL | AT-RISK |
|---|---|---|---|---|
| 847 | 78% | 5.1 | Lv 2.8 | 12 students |

---

SCHOOL PULSE -- 74 / 100

Today's Headline

School participation reached 78% -- up from 65% at program start. Grade 10 is the week's top improver (+12% engagement). Science Department carries 6 misconception clusters affecting 23+ students -- the highest load across all departments and requires a department meeting. 12 students across Grades 8-10 have gone silent for 3+ days. A-Level cohort continues to lead quality at 6.2 average -- the only grade band operating at Analyst level.

---

School Command Center -- Grade-Wise

| GRADE | TOTAL | ACTIVE | RATE | Qs | AVG QQS | TREND | LEVEL | KEY SIGNAL |
|---|---|---|---|---|---|---|---|---|
| Gr 5 | 142 | 118 | 83% | 96 | 3.8 | [UP] | Lv 2 Builder | Healthy onboarding |
| Gr 6 | 138 | 109 | 79% | 89 | 4.0 | [FLAT] | Lv 2 Builder | Steady engagement |
| Gr 7 | 144 | 121 | 84% | 112 | 4.3 | [UP] | Lv 2 Builder | Strongest basic level |
| Gr 8 | 140 | 114 | 81% | 105 | 4.6 | [UP] | Lv 2 Builder | Pre-SEE motivation rising |
| Gr 9 | 136 | 98 | 72% | 91 | 5.0 | [FLAT] | Lv 3 Explorer | Transition zone -- monitor |
| Gr 10 | 132 | 106 | 80% | 118 | 5.4 | [UP] | Lv 3 Explorer | Week's top improver |
| Gr 11 | 108 | 79 | 73% | 84 | 5.8 | [FLAT] | Lv 3 Explorer | NEB prep -- steady |
| Gr 12 | 96 | 68 | 71% | 72 | 5.6 | [DN] | Lv 3 Explorer | Engagement dipping |
| A-Lvl | 100 | 72 | 72% | 80 | 6.2 | [UP] | Lv 4 Analyst | Highest quality cohort |
| TOTAL | 1,136 | 885 | 78% | 847 | 5.1 | [UP] | Lv 2.8 | Positive trajectory |

---

Department Performance Board

Ranked by learning impact (quality x engagement). No competition -- for resource allocation decisions.

| RANK | DEPARTMENT | Qs | QQS | MISC | TREND | HEALTH | INSIGHT |
|---|---|---|---|---|---|---|---|
| 1 | Mathematics | 168 | 5.3 | 4 | [UP] +8% | Thriving | Trig driving Gr 9-10 volume |
| 2 | Science | 152 | 5.0 | 6 | [UP] +5% | Watch | 6 misconceptions -- highest |
| 3 | English | 124 | 4.8 | 2 | [FLAT] Steady | Healthy | Grammar Qs peaking pre-SEE |
| 4 | Nepali | 96 | 4.5 | 3 | [FLAT] Steady | Healthy | Script-quality improving |
| 5 | Social Studies | 88 | 4.9 | 2 | [UP] +12% | Thriving | Urbanisation trending |
| 6 | Physics | 62 | 6.0 | 3 | [UP] +6% | Thriving | A-Level cohort excelling |
| 7 | Chemistry | 58 | 5.8 | 2 | [FLAT] Steady | Healthy | Organic chem focus |
| 8 | Biology | 42 | 5.5 | 1 | [DN] -4% | Monitor | Low volume -- needs push |
| 9 | Computer Sc. | 32 | 5.2 | 1 | [FLAT] Steady | Healthy | Python/coding focused |
| 10 | Health and PE | 15 | 3.8 | 0 | [DN] -15% | Concern | <2% of questions -- discuss |
| 11 | Arts | 10 | 4.0 | 0 | [DN] -10% | Concern | Adoption needed |

---

Priority Alerts

| LEVEL | ALERT | ACTION REQUIRED |
|---|---|---|
| URGENT | 12 students (Gr 8-10) have not submitted for 3+ days | House tutors to check in tonight |
| URGENT | Science Dept: 6 active misconception clusters (23 students affected) | Dept head meeting tomorrow AM |
| HIGH | Grade 12 NEB: 7-day engagement decline (-15%) | Pre-board stress? VP-SL to investigate |
| MEDIUM | Health and PE and Arts: <2% of all questions combined | Dept head adoption strategy needed |
| WATCH | Biology volume down 4% week-over-week | Monitor -- may need content refresh |
| POSITIVE | Grade 10: strongest weekly improvement (+12% engagement, +0.6 QQS) | Share with SMC / FOBS report |
| POSITIVE | A-Level cohort: highest avg QQS (6.2) -- analytical questioning dominant | Consider peer mentoring program |
| MILESTONE | School reached 78% daily participation -- up from 65% at start | Acknowledge in morning assembly |

---

School Health Scorecard

Key metrics tracked daily. Values compound over time.

| METRIC | TODAY | LAST WEEK | CHANGE | STATUS | TERM TARGET |
|---|---|---|---|---|---|
| Daily Participation | 78% | 72% | +6% | [UP] | >=75% MET |
| Avg Question Quality | 5.1 | 4.8 | +0.3 | [UP] | >=5.0 MET |
| At-Risk Students | 12 | 15 | -3 | [UP] | <15 MET |
| Misconception Clusters | 24 | 22 | +2 | [FLAT] | <20 |
| Productive Struggle % | 62% | 58% | +4% | [UP] | >=60% MET |
| Question Depth (Bloom 4+) | 28% | 24% | +4% | [UP] | >=30% |
| Teacher Brief Usage | 68/75 | 64/75 | +4 | [UP] | 75/75 |
| Gender Parity Index | 0.94 | 0.93 | +0.01 | [FLAT] | 0.95-1.05 |

---

Week Ahead -- Pattern Predictions

Based on 3-week trend analysis:

| SIGNAL | PREDICTION | CONFIDENCE | PREEMPTIVE ACTION |
|---|---|---|---|
| [UP] | Grade 10 engagement will continue rising -- SEE preparation driving motivation | High (87%) | Sustain momentum; avoid burnout |
| [DN] | Grade 12 NEB engagement will drop further if pre-board stress unmanaged | Medium (72%) | VP-SL to address workload balance |
| [FLAT] | Science misconception load will persist unless dissolving/melting addressed | High (90%) | Dept meeting + demo this week |
| [UP] | At-risk count will decrease to ~8 if house tutor check-ins happen tonight | Medium (68%) | Confirm check-ins by tomorrow AM |
| [!] | Health and PE / Arts adoption will remain <2% without structural change | High (85%) | Dept heads to propose integration plan |

---

Every question asked is a student choosing to learn. Today, 847 students made that choice.

SAP - Self-Study Assistance Program - TopTutors Private Limited

---

## END OF TEMPLATE
