# SAP TEACHER DAILY BRIEF -- Generation Template
## Self-Study Assistance Program -- TopTutors.ai
### Version 2.0 | March 2026

---

## RENDERING GUARDRAILS (TEACHER REPORT)

These rules are mandatory for every teacher report. Read SAP_PRINCIPLES.md Part G1-G8 for the full specification. This section is a quick-reference subset for the teacher report specifically.

### TR-G1: SYMBOL REPLACEMENTS FOR THIS REPORT

| Original | Replacement | Where Used |
|---|---|---|
| (up arrow) | [UP] | Trend column, trajectory |
| (down arrow) | [DN] | Trend decline |
| (right arrow) | [FLAT] | Stable trend |
| (star emoji) | [STAR] | Star question badge |
| (fire emoji) | [STREAK] | Streak badge |
| (seedling emoji) | [GROWTH] | Growth badge |
| (lightning emoji) | [CONSISTENT] | Consistency badge |
| (muscle emoji) | [COMEBACK] | Comeback badge |
| (warning) | [!] | Misconception severity |
| (em dash) | -- | Missing data, inactive students |
| (ge/le symbols) | >= or <= | Thresholds |

### TR-G2: TONE RULES

1. Address teacher with "ji" suffix ALWAYS (e.g., "Sushila ji"). Non-negotiable Nepali cultural respect.
2. Professional, action-oriented, efficient.
3. Every insight MUST lead to a concrete action with a time estimate.
4. Never blame the teacher for low class performance. Frame as "here's what the data shows and what might help."
5. Student names are FULL NAMES in this report.

### TR-G3: DATA INTEGRITY

1. NEVER invent student names, scores, or trends.
2. If data is not provided, use "--" or note "Data pending."
3. The report is for ONE teacher, ONE subject, ONE class section, ONE day.
4. All QQS values shown to 1 decimal place (not rounded integers like in student reports).

### TR-G4: TABLE CELL LIMITS

- Student Progress Map: maximum 7 columns, maximum 80 characters per cell
- Misconception Radar: maximum 5 columns, "Fix" column maximum 100 characters
- All tables: one line per cell, no line breaks within cells

### TR-G5: MISCONCEPTION FIX FORMAT

Every misconception fix MUST follow this pattern:
"[Activity type]: [What to do]. [Time estimate]."

Examples:
- "Demo: dissolve salt in cold water. Compare with ice melting. 5 min."
- "Board work: calculate sin30 + sin30 vs sin60. Ask class to compare. 3 min."
- "Pair discussion: is dissolving reversible? Students predict, then test. 8 min."

---

## REPORT STRUCTURE (Follow This Exactly)

### SECTION 1: HEADER

```
TEACHER DAILY BRIEF

Teacher: [Full Name]    Subject: [Subject]    Class: [Section (X students)]    Date: [DD Month YYYY]
```

---

### SECTION 2: HEADLINE METRICS (4-Box Summary)

A single row of exactly 4 metric boxes:

| SUBMITTED | CLASS AVG QUALITY | CLASS LEVEL | MISCONCEPTIONS |
|---|---|---|---|
| [X]/[Y] ([Z]%) | [X.X] | Lv [N] [LevelName] | [X] alerts |

Calculation rules:
- Box 1: Students who submitted / Total enrolled. Percentage in parentheses.
- Box 2: Class average QQS (1 decimal). Per Principles Part 7.1.
- Box 3: Class level from Class Avg QQS. Per Principles Part 3.1.
- Box 4: Count of misconception clusters identified today.

---

### SECTION 3: TODAY'S STORY

A personalized narrative for the teacher. Must include ALL of the following in natural prose:

1. Address by name with ji (e.g., "Sushila ji,")
2. Submission count (e.g., "28 of 34 students submitted today")
3. Dominant theme -- most prevalent topic or misconception
4. Most urgent teaching target -- with specific student count
5. Star performer -- name, question description, suggested action
6. Growth highlight -- name the student with steepest improvement
7. Concern flag -- 1-2 students showing decline/at-risk, suggest "a private conversation"

Length: 4-7 sentences.

Example:

Sushila ji, 28 of 34 students submitted today. The dominant theme was dissolving vs physical change -- 23 students confused dissolving with melting, making it your most urgent teaching target tomorrow. On the positive side, Priya Thapa asked a question about superconductors that scored 9/10 -- read it aloud to spark class discussion. Rohan's 3-week growth trajectory is the steepest in the class -- acknowledge it. Two students (Pema, Rajan) are showing decline patterns that need a private conversation.

---

### SECTION 4: STUDENT PROGRESS MAP

Level legend (always displayed above the table):

```
Levels: Lv 1 Starter (1-3.9)  Lv 2 Builder (4-5.4)  Lv 3 Explorer (5.5-6.9)  Lv 4 Analyst (7-8.4)  Lv 5 Innovator (8.5+)
```

Table columns (fixed):

| STUDENT | AVG Q | TREND | LEVEL | XP | Qs | TEACHER ACTION |
|---|---|---|---|---|---|---|

Column definitions:
- STUDENT: Full name
- AVG Q: Average QQS today (1 decimal)
- TREND: [UP] = improved >=0.3 from last week. [FLAT] = within +/-0.3. [DN] = declined >=0.3.
- LEVEL: Current level with name (e.g., "Lv 3 Explorer")
- XP: Engagement XP (integer, 0-100 normalized)
- Qs: Questions submitted today
- TEACHER ACTION: 3-6 word actionable note

Sorting: By Avg QQS descending.

Display rules:
- Class <=15: Show ALL students
- Class >15: Show TOP 5 + BOTTOM 5 + summary line
- Students with 0 submissions: list at bottom, Avg Q = "--", Level = "Inactive", XP = "0"

Summary line format:
"Showing X of Y students (sorted by quality). Z additional students in Good range -- full list in portal."

---

### SECTION 5: MISCONCEPTION RADAR

```
Misconception Radar
```

Table columns (fixed):

| NUM | MISCONCEPTION | AFFECTED | SEVERITY | FIX: TOMORROW'S CLASS |
|---|---|---|---|---|

Column definitions:
- NUM: Sequential (1, 2, 3...)
- MISCONCEPTION: The specific false belief, stated clearly
- AFFECTED: "X/Y" -- students with this / total submitted
- SEVERITY: CRITICAL, HIGH, MODERATE, or LOW (per Principles Part 5.2)
- FIX: Specific, timed classroom activity (per TR-G5 format)

Rules:
- Show ALL identified misconceptions (min 1, max 6)
- Sort by Severity descending (CRITICAL first)
- If none: "No misconception clusters detected today. Class understanding appears solid."
- Each fix must be doable in <=15 minutes

---

### SECTION 6: TODAY'S ACHIEVEMENTS

```
Today's Achievements
```

Table columns (fixed):

| BADGE | STUDENT | ACHIEVEMENT | IMPACT |
|---|---|---|---|

Column definitions:
- BADGE: Text tag from Principles Part 10.1 (e.g., "[STAR]", "[UP]", "[STREAK]", "[GROWTH]")
- STUDENT: Full name
- ACHIEVEMENT: 1-sentence description
- IMPACT: Suggested action -- one of: Read Aloud, Recognise, Celebrate, Encourage, Acknowledge

Rules:
- Maximum 4 achievements
- Minimum 1 (even if just the highest QQS as Star Q)
- Order: [STAR] first, then [UP], then [STREAK], then [GROWTH]

---

### SECTION 7: CLASS COGNITIVE PROFILE

```
Class Cognitive Profile

Distribution of question quality levels across your class today:
```

Table (fixed):

| LEVEL | COUNT | PERCENT | TARGET |
|---|---|---|---|
| Recall (1-3) | [N] | [X]% | <30% |
| Descriptive (4-5) | [N] | [X]% | 25-35% |
| Explanatory (6-7) | [N] | [X]% | 25-35% |
| Analytical (8+) | [N] | [X]% | >10% |

Calculation:
- Count = number of QUESTIONS (not students) in each QQS band
- Percent = Count / Total Questions x 100%

Followed by insight line:
"Insight: [One sentence describing biggest gap between actual and target, with recommendation and Hattie effect size.]"

Example:
Insight: Recall questions are 8% above target. Introduce one "why" prompt per lesson to shift 5-10% toward explanatory questioning. Expected impact: d = 0.82 (classroom discussion effect).

---

### SECTION 8: LOOKING AHEAD -- PREDICTIONS

```
Looking Ahead -- Predictions

Based on current trajectories:
```

Table columns (fixed):

| STUDENT | NOW | PREDICTED [MONTH] | TRAJECTORY | WHAT THIS MEANS |
|---|---|---|---|---|

Rules:
- Show exactly 4 students: top performer, fastest grower, 2 most at-risk
- NOW = "Lv X (QQS)" e.g., "Lv 4 (7.1)"
- PREDICTED = projected level + QQS one month out
- TRAJECTORY = "[UP] Accelerating", "[UP] Fastest growth", "[DN] At risk", "[DN] Critical"
- WHAT THIS MEANS = 1-sentence plain language
- If <3 weeks data: "Predictions available after 3 weeks of data collection."

---

### SECTION 9: YOUR PRIORITIES FOR TOMORROW

```
Your Priorities for Tomorrow
```

Table columns (fixed):

| NUM | ACTION | TIME | EXPECTED OUTCOME |
|---|---|---|---|

Rules:
- Exactly 4 priority actions
- Priority 1: ALWAYS star question read-aloud OR highest-severity misconception fix
- Priority 2: Most impactful misconception correction
- Priority 3: Recognition/celebration action
- Priority 4: ALWAYS well-being check-in with at-risk/declining student
- TIME = estimated minutes (e.g., "3 min", "5 min", "2 min each")
- EXPECTED OUTCOME = 2-4 words

Followed by exactly 1 research citation:
"Research shows: [One sentence citing Hattie effect size relevant to top priority.]"

Example:
Research shows: teachers who act on misconception data see effect sizes of d = 0.99 for conceptual change.

---

### SECTION 10: FOOTER

```
SAP - Self-Study Assistance Program - TopTutors Private Limited
```

---

## DEMO: COMPLETE TEACHER REPORT (v2.0 format)

---

TEACHER DAILY BRIEF

Teacher: Sushila Adhikari    Subject: Science    Class: 10-B (34 students)    Date: 16 March 2026

---

| SUBMITTED | CLASS AVG QUALITY | CLASS LEVEL | MISCONCEPTIONS |
|---|---|---|---|
| 28/34 (82%) | 5.4 | Lv 3 Explorer | 3 alerts |

---

Today's Story

Sushila ji, 28 of 34 students submitted today. The dominant theme was dissolving vs physical change -- 23 students confused dissolving with melting, making it your most urgent teaching target tomorrow. On the positive side, Priya Thapa asked a question about superconductors that scored 9/10 -- read it aloud to spark class discussion. Rohan's 3-week growth trajectory is the steepest in the class -- acknowledge it. Two students (Pema, Rajan) are showing decline patterns that need a private conversation.

---

Student Progress Map

Levels: Lv 1 Starter (1-3.9)  Lv 2 Builder (4-5.4)  Lv 3 Explorer (5.5-6.9)  Lv 4 Analyst (7-8.4)  Lv 5 Innovator (8.5+)

| STUDENT | AVG Q | TREND | LEVEL | XP | Qs | TEACHER ACTION |
|---|---|---|---|---|---|---|
| Priya Thapa | 7.1 | [UP] | Lv 4 Analyst | 82 | 9 | Star performer -- olympiad prep |
| Srijana Poudel | 6.8 | [UP] | Lv 4 Analyst | 78 | 8 | Excellent analytical depth |
| Kavya Shrestha | 6.5 | [FLAT] | Lv 3 Explorer | 74 | 3 | Consistent quality performer |
| Aarav Sharma | 6.2 | [UP] | Lv 3 Explorer | 71 | 5 | Deepening inquiry -- levelling up |
| Rohan Maharjan | 5.8 | [UP] | Lv 3 Explorer | 68 | 4 | Improving in electricity concepts |
| ... | | | | | | |
| Dipesh Magar | 4.8 | [DN] | Lv 2 Builder | 51 | 2 | Quality dipping -- check in |
| Ramesh Basnet | 4.2 | [FLAT] | Lv 1 Starter | 42 | 2 | Needs conceptual support |
| Sujan Lama | 3.8 | [DN] | Lv 1 Starter | 35 | 2 | Declining -- conversation needed |
| Pema Sherpa | 3.5 | [DN] | Lv 1 Starter | 28 | 1 | Minimal participation -- at risk |
| Rajan KC | 3.2 | [DN] | Lv 1 Starter | 22 | 1 | Fragmented Qs -- possible overload |
| Sarita Ghimire | -- | [DN] | Inactive | 0 | 0 | No submission -- 3 days absent |

Showing 11 of 34 students (sorted by quality). 23 additional students in Good range -- full list in portal.

---

Misconception Radar

| NUM | MISCONCEPTION | AFFECTED | SEVERITY | FIX: TOMORROW'S CLASS |
|---|---|---|---|---|
| 1 | Dissolving = melting. Students think salt "melts" in water. | 23/34 | CRITICAL | Demo: dissolve salt in cold water. Compare with ice melting. 5 min. |
| 2 | Current "uses up" through a resistor. | 11/34 | HIGH | Ammeter before and after bulb. Show current = same. 10 min. |
| 3 | Mass and weight used interchangeably. | 8/34 | MODERATE | Spring balance vs beam balance demo. Mass=kg, Weight=N. 5 min. |

---

Today's Achievements

| BADGE | STUDENT | ACHIEVEMENT | IMPACT |
|---|---|---|---|
| [STAR] | Priya Thapa | Asked about superconductors defying temperature-resistance rule (QQS 9/10) | Read Aloud |
| [UP] | Aarav Sharma | Moved from Lv 2 to Lv 3 this week -- questions now explanatory | Recognise |
| [STREAK] | Kavya Shrestha | 15-day consecutive streak -- longest in Class 10-B | Celebrate |
| [GROWTH] | Rohan Maharjan | QQS improved from 3.8 to 5.8 over 3 weeks -- steepest in class | Encourage |

---

Class Cognitive Profile

Distribution of question quality levels across your class today:

| LEVEL | COUNT | PERCENT | TARGET |
|---|---|---|---|
| Recall (1-3) | 31 | 38% | <30% |
| Descriptive (4-5) | 28 | 34% | 25-35% |
| Explanatory (6-7) | 16 | 20% | 25-35% |
| Analytical (8+) | 7 | 8% | >10% |

Insight: Recall questions are 8% above target. Introduce one "why" prompt per lesson to shift 5-10% of students toward explanatory questioning. Expected impact: d = 0.82 (classroom discussion effect).

---

Looking Ahead -- Predictions

Based on current trajectories:

| STUDENT | NOW | PREDICTED APR | TRAJECTORY | WHAT THIS MEANS |
|---|---|---|---|---|
| Priya Thapa | Lv 4 (7.1) | Lv 4+ (7.8) | [UP] Accelerating | Olympiad candidate. Needs extension material. |
| Rohan Maharjan | Lv 3 (5.8) | Lv 3+ (6.4) | [UP] Fastest growth | Will reach Analyst by May if sustained. |
| Sujan Lama | Lv 1 (3.8) | Lv 1 (3.2) | [DN] At risk | Without intervention, likely to disengage. |
| Pema Sherpa | Lv 1 (3.5) | Inactive | [DN] Critical | 3 days absent. Escalate to house tutor if no contact by Thursday. |

---

Your Priorities for Tomorrow

| NUM | ACTION | TIME | EXPECTED OUTCOME |
|---|---|---|---|
| 1 | Read Priya's superconductor question aloud -- launch class discussion on resistance and temperature | 3 min | Class engagement boost |
| 2 | Run dissolving vs melting demo (salt + cold water). Address the #1 misconception | 5 min | Resolve for 23 students |
| 3 | Recognise Rohan's growth trajectory -- acknowledge improvement publicly | 1 min | Motivation reinforcement |
| 4 | Check in privately with Pema Sherpa and Rajan KC -- both showing declining patterns | 2 min each | Early intervention |

Research shows: teachers who act on misconception data see effect sizes of d = 0.99 for conceptual change.

---

SAP - Self-Study Assistance Program - TopTutors Private Limited

---

## END OF TEMPLATE
