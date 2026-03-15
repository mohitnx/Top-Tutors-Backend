# SAP ANALYTICAL PRINCIPLES & METRICS FRAMEWORK
## Self-Study Assistance Program -- TopTutors.ai
### Version 2.0 | March 2026

---

## RENDERING GUARDRAILS (READ FIRST -- APPLIES TO ALL REPORTS)

This section is the single authority on how reports must be formatted for reliable PDF rendering. Every report generator (LLM, script, human) MUST follow these rules before any content rule.

### G1: CHARACTER SAFETY MAP

All reports MUST use only ASCII-safe replacements. The following substitutions are MANDATORY:

| BANNED Character | REPLACEMENT | Context |
|---|---|---|
| (arrow right symbol) | --> | "What to try next" suggestions |
| (black triangle) | >> | "In one line" answer prefix |
| (star symbol) | [STAR] | Star question badge, best questions ranking |
| (warning triangle) | [!] | Common traps, misconception warnings |
| (fire emoji) | [STREAK] | Streak badge |
| (seedling emoji) | [GROWTH] | Growth badge |
| (up arrow) | UP or [UP] | Trend indicators, level-up |
| (down arrow) | DN or [DN] | Trend decline |
| (right arrow) | -- or [FLAT] | Stable trend |
| (em dash) | -- | Missing data, separators |
| (vertical bar) | - | Section separators in footer |
| (check mark) | Yes | "You?" column in class tables |
| (ge/le symbols) | >= or <= | Threshold comparisons |
| (approx symbol) | ~ | Approximate values |
| ALL emoji | Text labels in [BRACKETS] | Badges, decorations |

### G2: DEVANAGARI / NEPALI TEXT RULES

1. Nepali text MUST be rendered using a Devanagari-capable font (Noto Sans Devanagari, Mukta, or Mangal). If the rendering pipeline does not have Devanagari fonts loaded, Nepali text MUST be transliterated to Roman script.
2. NEVER mix Devanagari and Latin characters in the same table cell. Place Devanagari in its own line or column.
3. When a question is in Nepali, provide it in BOTH scripts: Devanagari first, then Roman transliteration in parentheses.
4. If the PDF renderer cannot confirm Devanagari support, use ONLY Roman transliteration.
5. Test rule: If "namaste" renders but "नमस्ते" does not, the pipeline lacks Devanagari support -- switch to transliteration for all Nepali content.

### G3: TABLE FORMATTING RULES

1. NO nested bold inside table cells. If emphasis is needed, use CAPS or trailing asterisk (*).
2. NO multi-line content in a single table cell. One line per cell maximum.
3. Table headers: plain text, no bold markers. Use ALL CAPS for headers instead.
4. Maximum table width: 7 columns for student reports, 8 columns for teacher, 10 columns for admin.
5. Every table must have a header row with column names.
6. Empty cells use "--" (double hyphen), never a blank.

### G4: MARKDOWN SIMPLIFICATION

1. NO blockquotes (> prefix) for content that must render in PDF. Use indented plain text or a labeled box instead.
2. NO inline code backticks for non-code content. Use quotes or CAPS.
3. Section separators: use a blank line + "---" + blank line. Nothing else.
4. Headers use # levels only. No bold-as-header (i.e., don't use **TEXT** as a section title).
5. Bullet points use "-" (hyphen) only. No *, no numbered sub-bullets deeper than 2 levels.

### G5: MATHEMATICAL NOTATION

1. NO Unicode subscripts or superscripts (they render as black boxes in most PDF fonts).
2. Write chemical formulas in plain text: "CO2" not "CO₂", "H2O" not "H₂O".
3. Write exponents as: "x^2" or "x squared" -- not "x²".
4. Greek letters: spell out in English ("theta", "alpha") unless the rendering pipeline confirms symbol font support.
5. Fractions: use "/" notation: "1/2", "opposite/hypotenuse".

### G6: FONT AND ENCODING

1. All output MUST be UTF-8 encoded.
2. If generating PDF directly: embed fonts. Never rely on system fonts.
3. Minimum font stack: one Latin font (Helvetica, Noto Sans) + one Devanagari font (Noto Sans Devanagari).
4. Body text: 10-11pt. Table text: 9-10pt. Headers: 12-14pt.
5. Line height: 1.4x minimum for readability.

### G7: REPORT OUTPUT MODES

The report generator MUST know which output mode it is targeting:

| Mode | Symbols | Devanagari | Tables | Use Case |
|---|---|---|---|---|
| MARKDOWN-SAFE | ASCII replacements from G1 | Roman transliteration only | Simple pipes | Chat, preview, quick view |
| PDF-LATIN | ASCII replacements from G1 | Roman transliteration only | Rendered tables | PDF without Devanagari fonts |
| PDF-FULL | ASCII replacements from G1 | Native Devanagari (font embedded) | Rendered tables | PDF with full font stack |
| HTML | Original Unicode OK | Native Devanagari (web font loaded) | HTML tables | Web dashboard display |

Default mode if not specified: MARKDOWN-SAFE.

### G8: VALIDATION CHECKLIST (RUN BEFORE EVERY REPORT)

Before delivering any report, verify:

- [ ] No emoji characters anywhere in the output
- [ ] No Unicode arrows, triangles, stars, or warning symbols
- [ ] All Nepali text either in Devanagari with confirmed font OR in Roman transliteration
- [ ] No table cell contains more than 80 characters
- [ ] No table has more than 10 columns
- [ ] All numbers formatted per Part 11 rules
- [ ] Footer line present and matches exact format
- [ ] Date format is DD Month YYYY
- [ ] Student report uses first name only (after header)
- [ ] Teacher report uses "ji" honorific
- [ ] Admin report has zero individual student names

---

## PART 1: CORE PHILOSOPHY

### 1.1 What SAP Measures

SAP does NOT measure how much a student knows. SAP measures how a student thinks -- specifically, the cognitive depth of questions they ask. The foundational premise:

Students who ask better questions develop deeper understanding.
This is not opinion -- it is supported by Hattie's meta-analysis (d=0.46 for questioning, d=0.82 for classroom discussion) and Bloom's cognitive hierarchy research spanning 60+ years.

### 1.2 The Three Report Audiences

| Audience | Core Need | Update Frequency | Tone |
|---|---|---|---|
| Student | "Am I improving? What should I do next?" | Daily | Warm, encouraging, personal (uses first name) |
| Teacher | "Which students need me? What do I teach tomorrow?" | Daily per class | Professional, action-oriented, efficient |
| Admin | "Is the school healthy? Where do I allocate resources?" | Daily school-wide | Strategic, data-dense, decision-focused |

### 1.3 Design Principles (Non-Negotiable)

1. No student is ever shamed. Reports frame low scores as "developing" or "building," never as failure.
2. Every data point leads to an action. No metric appears without a "so what."
3. Simplicity over sophistication. A school administrator with no statistics background must understand every number.
4. Consistency is sacred. The same student input must always produce the same report structure.
5. Nepal context first. All syllabus references are to Nepal's national curriculum (CDC/NEB). SEE = Secondary Education Examination. All examples use Nepali names and context.

---

## PART 2: THE QUESTION QUALITY SCORE (QQS)

### 2.1 QQS Formula

```
QQS = round( 10 x [ 0.40 x (B/6) + 0.20 x (S/3) + 0.20 x (O/3) + 0.20 x (M/3) ] , 1)
```

Result is rounded to 1 decimal place. Range: 1.0 to 10.0.

### 2.2 QQS Components (Fixed Definitions)

#### B -- Bloom's Cognitive Level (1-6)

| B | Level | Student Is Asking... | Trigger Words |
|---|---|---|---|
| 1 | Remember | "What is X?" "Define X." | what, define, list, name, state, recall |
| 2 | Understand | "Explain how X works." | explain, describe, summarize, classify |
| 3 | Apply | "How do I use X to solve Y?" | how to, solve, use, demonstrate, calculate |
| 4 | Analyze | "Why does X differ from Y?" | compare, contrast, why (causal), examine |
| 5 | Evaluate | "Is X better than Y? Why?" | judge, justify, critique, defend |
| 6 | Create | "What if we combined X and Y?" | what if, design, invent, propose, imagine |

Classification Rule: When a question spans two levels, assign the HIGHER level. Context matters more than keywords.

#### S -- Specificity (1-3)

| S | Label | Definition |
|---|---|---|
| 1 | Vague | Too broad or generic |
| 2 | Focused | Targets a specific topic but not precise mechanism |
| 3 | Precise | Identifies a specific mechanism, condition, or comparison |

#### O -- Originality (1-3)

| O | Label | Definition |
|---|---|---|
| 1 | Textbook Echo | Directly from the textbook or standard FAQ |
| 2 | Rephrased | Standard concept in student's own words or new context |
| 3 | Novel | Connects concepts, challenges assumptions, proposes new scenario |

#### M -- Misconception-Revelation Potential (1-3)

| M | Label | Definition |
|---|---|---|
| 1 | Low | Unlikely to reveal any misunderstanding |
| 2 | Medium | Answer could clarify a common confusion |
| 3 | High | Directly addresses a known misconception or reveals a specific gap |

### 2.3 QQS Labels (Fixed Thresholds)

| QQS Range | Label | Meaning |
|---|---|---|
| 1.0-3.9 | DEVELOPING | Mostly recall; student is building foundations |
| 4.0-5.4 | GOOD | Descriptive thinking emerging |
| 5.5-6.9 | STRONG | Explanatory thinking; connects concepts |
| 7.0-8.4 | EXCELLENT | Analytical thinking; questions assumptions |
| 8.5-10.0 | EXCEPTIONAL | Evaluative/creative thinking; proposes and designs |

Display Rule: The label shown to the student is ALWAYS the word + the score. Format: "GOOD 6/10" or "STRONG 7/10". Never show the decimal to students. Round to nearest integer for display. Internal records keep the decimal.

### 2.4 QQS Worked Examples

Example 1: "What is photosynthesis?"
- B=1, S=1, O=1, M=1
- QQS = 10 x [0.40(1/6) + 0.20(1/3) + 0.20(1/3) + 0.20(1/3)] = 2.7 --> DEVELOPING 3/10

Example 2: "Why does salt dissolve in water but sand does not?"
- B=4, S=3, O=2, M=3
- QQS = 10 x [0.40(4/6) + 0.20(3/3) + 0.20(2/3) + 0.20(3/3)] = 7.0 --> EXCELLENT 7/10

Example 3: "If resistance increases with temperature, why do superconductors lose ALL resistance at low temperatures?"
- B=5, S=3, O=3, M=3
- QQS = 10 x [0.40(5/6) + 0.20(3/3) + 0.20(3/3) + 0.20(3/3)] = 9.3 --> EXCEPTIONAL 9/10

---

## PART 3: STUDENT LEVELS (Fixed Progression System)

### 3.1 Level Definitions

| Level | Name | Avg QQS Range | Thinking Style | What This Student Does |
|---|---|---|---|---|
| Lv 1 | Starter | 1.0-3.9 | Recall-dominant | Asks "what is" and "define" questions |
| Lv 2 | Builder | 4.0-5.4 | Descriptive | Asks "how" and "explain" questions |
| Lv 3 | Explorer | 5.5-6.9 | Explanatory | Asks "why" and "what causes" questions |
| Lv 4 | Analyst | 7.0-8.4 | Analytical | Asks "what if" and "compare" questions |
| Lv 5 | Innovator | 8.5-10.0 | Evaluative/Creative | Proposes new approaches, designs experiments |

### 3.2 Level Calculation

A student's level is based on their rolling 7-day average QQS. Not today's average -- the weekly average.

```
Level = classify( mean(QQS_scores from last 7 days) )
```

### 3.3 Level-Up and Level-Down Rules

- Level Up: Weekly average crosses INTO a higher band AND stays there for >=2 consecutive days.
- Level Down: Weekly average drops below current band for >=5 consecutive days. Slower decline prevents discouragement.
- Display Rule: When a student levels up, the report shows [UP] arrow and the new level is highlighted. Level-downs are shown as [FLAT] until confirmed, never as [DN] to the student directly.

---

## PART 4: ENGAGEMENT XP SYSTEM

### 4.1 XP Formula

```
XP_daily = round( BaseXP x QualityMultiplier x StreakBonus x TimeComponent )
```

Where:
- BaseXP = QuestionsAsked x 10
- QualityMultiplier = 0.5 + 0.5 x (AvgQQS / 10) --> Range: 0.50 to 1.00
- StreakBonus = 1.0 + 0.10 x min(StreakDays, 30) --> Range: 1.0 to 4.0
- TimeComponent = min( log2(1 + TimeMinutes/15) , 2.0) --> Caps at 2.0

XP_daily is an integer. Maximum theoretical daily XP ~ 800.

### 4.2 XP Thresholds (for Teacher/Admin Reports)

| XP Range (Daily) | Engagement Label |
|---|---|
| 0 | Inactive |
| 1-20 | Minimal |
| 21-50 | Moderate |
| 51-80 | Active |
| 81+ | Highly Active |

### 4.3 Streak Rules

- A streak is consecutive CALENDAR DAYS with >=1 question submitted.
- Missing a day resets the streak to 0. No exceptions, no "streak freezes."
- Streaks are shown to students as: "[STREAK] 12-day streak"
- Streak milestones: 7, 14, 30, 60, 100 days. Milestones trigger a badge.

---

## PART 5: MISCONCEPTION DETECTION & SEVERITY

### 5.1 How Misconceptions Are Identified

A misconception is flagged when a student's question or analysis reveals a specific, identifiable false belief -- not just a gap in knowledge.

| Misconception | What It Is | Is It A Misconception? |
|---|---|---|
| "Salt melts in water" | False belief (dissolving != melting) | YES |
| "I don't know what dissolving means" | Knowledge gap | NO |
| "Current gets used up by a resistor" | False model of electricity | YES |
| "I forgot the formula for resistance" | Recall failure | NO |

### 5.2 Severity Classification

| Severity | Criteria | Teacher Action |
|---|---|---|
| CRITICAL | >=20% of class holds this AND it blocks upcoming topics | Address tomorrow |
| HIGH | 10-19% of class OR blocks one topic | Address within 2 days |
| MODERATE | 5-9% of class, isolated topic | Address within the week |
| LOW | <5% of class, non-blocking | Monitor; may self-correct |

### 5.3 Misconception Clustering Rule

When >=3 students in the same class exhibit the same misconception within a 7-day window, it becomes a Misconception Cluster and is surfaced in both Teacher and Admin reports.

---

## PART 6: AT-RISK DETECTION (Early Warning System)

### 6.1 At-Risk Flag Thresholds

| Flag | Condition | Risk Level |
|---|---|---|
| Silent | 0 questions for >=3 consecutive days | URGENT |
| Declining | Weekly avg QQS dropped >=1.5 from previous week | HIGH |
| Disengaging | Participation dropped >=50% over 2 weeks | HIGH |
| Struggling | Avg QQS < 3.0 for >=5 consecutive days | MODERATE |
| Streak-Broken | Streak of >=14 days broken | WATCH |

### 6.2 At-Risk Escalation Path

1. WATCH --> Noted in Teacher Report only.
2. MODERATE --> Teacher Report includes specific action.
3. HIGH --> Teacher Report + Admin Report priority alert.
4. URGENT --> Admin Report top-of-page alert + house tutor notification.

---

## PART 7: TEACHER METRICS

### 7.1 Class Average QQS

```
ClassAvgQQS = mean( all QQS scores from all active students for the day )
```

Active = submitted >=1 question today. Non-submitters excluded from average.

### 7.2 Class Level

```
ClassLevel = classify( ClassAvgQQS ) using Part 3 thresholds
```

### 7.3 Participation Rate

```
ParticipationRate = (StudentsWhoSubmitted / TotalEnrolled) x 100%
```

### 7.4 Student Progress Map -- Sorting & Display Rules

Primary sort: Avg QQS descending. Within same band: alphabetical by first name.

- Show TOP 5 + BOTTOM 5 always
- Middle students summarized: "Showing X of Y students. Z additional in Good range -- full list in portal."
- Maximum explicitly shown: 15 (if class <= 15, show all)

### 7.5 Teacher Priority Actions

Every Teacher Report ends with "Your Priorities for Tomorrow" -- exactly 4 actions:
- Priority 1: ALWAYS highest-impact misconception OR star question to read aloud
- Priority 4: ALWAYS a student well-being check-in
- Each action has: Description, Estimated Time, Expected Outcome

### 7.6 Predictions in Teacher Report

Show 4 students: top performer, fastest grower, 2 most at-risk.
Prediction method: Linear extrapolation from last 3 weeks. If <3 weeks: "Insufficient data for prediction."

---

## PART 8: ADMINISTRATION METRICS

### 8.1 School Pulse Score

```
SchoolPulse = round( 100 x [ 0.25 x P + 0.25 x Q + 0.20 x (1-R) + 0.15 x (1-MC) + 0.15 x T ] )
```

Where (all normalized to 0.00-1.00):
- P = School-wide participation rate
- Q = School-wide average QQS / 10
- R = At-risk student rate
- MC = Misconception load rate (capped at 1.0)
- T = Teacher brief usage rate

| School Pulse | Label |
|---|---|
| 0-39 | Critical |
| 40-54 | Concern |
| 55-69 | Developing |
| 70-84 | Healthy |
| 85-100 | Thriving |

### 8.2 Grade-Wise Command Center -- Required Columns

| Column | Definition |
|---|---|
| Grade | Grade band (e.g., "Gr 5", "Gr 10") |
| Total | Enrolled students |
| Active | Submitted today |
| Rate | Active/Total x 100% |
| Qs | Total questions |
| Avg QQS | Mean QQS |
| Trend | [UP] (>=+0.3), [FLAT] (within +/-0.3), [DN] (>=-0.3) |
| Level | Current level name |
| Key Signal | One-line insight (<=8 words) |

Final row always: TOTAL with school-wide aggregates.

### 8.3 Department Performance Board -- Required Columns

| Column | Definition |
|---|---|
| Rank | By (Avg QQS x Participation Rate) |
| Department | Subject department |
| Qs | Total questions |
| QQS | Department average |
| Misc. | Active misconception clusters |
| Trend | Week-over-week change |
| Health | Thriving / Healthy / Watch / Monitor / Concern |
| Insight | One-line signal (<=8 words) |

### 8.4 Department Health Classification

```
DeptHealth = QQS_normalized x 0.5 + ParticipationRate x 0.3 + (1 - MisconceptionRate) x 0.2
```

| DeptHealth | Label |
|---|---|
| >=0.80 | Thriving |
| 0.65-0.79 | Healthy |
| 0.50-0.64 | Watch |
| 0.35-0.49 | Monitor |
| <0.35 | Concern |

### 8.5 Priority Alerts -- Classification

| Level | Criteria | Action Timeframe |
|---|---|---|
| URGENT | Silent >=3 days OR misconception >=20% | Same day / next morning |
| HIGH | Engagement decline >=15% w-o-w OR quality concern | Within 48 hours |
| MEDIUM | Dept adoption below 5% OR minor trend concerns | Within the week |
| WATCH | Small dips, early signals | No immediate action; track |
| POSITIVE | Notable improvements, milestones | Celebrate / communicate |
| MILESTONE | School-wide threshold crossed | Acknowledge publicly |

### 8.6 School Health Scorecard -- 8 Fixed Metrics

| Metric | How Calculated | Term Target |
|---|---|---|
| Daily Participation | Active / Total x 100% | >=75% |
| Avg Question Quality | School-wide mean QQS | >=5.0 |
| At-Risk Students | Count of at-risk flags | <15 |
| Misconception Clusters | Active clusters school-wide | <20 |
| Productive Struggle % | Bloom >=3 / Total x 100% | >=60% |
| Question Depth (Bloom 4+) | Bloom >=4 / Total x 100% | >=30% |
| Teacher Brief Usage | Opened / Total teachers | 100% |
| Gender Parity Index | Female Avg QQS / Male Avg QQS | 0.95-1.05 |

Each metric shows: Today, Last Week, Change, Status ([UP]/[FLAT]/[DN]), Term Target.

### 8.7 Week-Ahead Predictions

Format: Signal ([UP]/[DN]/[FLAT]/[!]) - Prediction - Confidence (High/Medium/Low) - Preemptive Action.
Show 4-6 predictions. If <3 weeks data, label all as "Low" confidence.

---

## PART 9: STUDENT REPORT QUESTION ANSWER STRUCTURE

### 9.1 Every Question-Answer Block Contains (In This Exact Order)

1. Question number and text -- "Q1 [Full question text]"
2. QQS Label and Score -- "GOOD 7/10" + one-line coaching tip
3. >> IN ONE LINE -- The answer in 1-2 sentences maximum
4. FULL EXPLANATION -- 3-6 sentences. Accurate, grade-appropriate
5. SEE IT IN ACTION -- One real-world example or experiment
6. YOUR SYLLABUS CONNECTION -- Chapter, topic, exam relevance. Nepal curriculum. State "(verified)" only if confirmed
7. WATCH OUT -- COMMON TRAPS -- 1-3 common mistakes. Each starts with [!]
8. WHAT TO TRY NEXT -- One follow-up question. Starts with "-->". Phrased as direct suggestion

### 9.2 Coaching Tips by QQS Range

| QQS (rounded) | Coaching Tip |
|---|---|
| 1-3 | "Keep asking! Try to add 'why' or 'how' to your next question." |
| 4-5 | "Good question. Try adding 'why' or 'what if' to push it further." |
| 6-7 | "This is a deep, analytical question. Keep pushing at this level." |
| 8-9 | "Outstanding question. This is the kind of thinking that builds mastery." |
| 10 | "Exceptional. You're thinking like a researcher. Share this with your class." |

---

## PART 10: ACHIEVEMENT BADGES

### 10.1 Badge Definitions (Fixed Set)

| Badge | Tag | Criteria | Shown To |
|---|---|---|---|
| Star Question | [STAR] | Highest QQS in class for the day | Student + Teacher |
| Level Up | [UP] | Moved to higher level this week | Student + Teacher |
| Streak | [STREAK] | Reached milestone (7/14/30/60/100) | Student + Teacher |
| Growth | [GROWTH] | Largest QQS improvement over 3 weeks | Teacher only |
| Consistency | [CONSISTENT] | Every day for 2+ weeks with Avg QQS >=5.0 | Teacher only |
| Comeback | [COMEBACK] | Was at-risk, returned with improving QQS | Teacher only |

### 10.2 Display Rules

- Student Report: Show student's own badges only. Maximum 3.
- Teacher Report: "Today's Achievements" shows all badges in class. Maximum 4 rows.
- Admin Report: Badges are NOT shown. Aggregate metrics only.

---

## PART 11: FORMATTING RULES (Non-Negotiable)

### 11.1 Date Format
Always: DD Month YYYY (e.g., "16 March 2026"). Never numeric-only.

### 11.2 Numbers
- QQS to students: Integer (rounded). e.g., "7/10"
- QQS in teacher/admin: 1 decimal. e.g., "5.4"
- Percentages: Integer with % sign. e.g., "78%"
- XP: Integer, no decimals.

### 11.3 Student Names
- Student Report: First name only after the header
- Teacher Report: Full name
- Admin Report: No individual student names. Counts and grades only.

### 11.4 Honorifics
- Teacher Report: "ji" suffix (e.g., "Sushila ji"). Non-negotiable Nepali cultural respect.
- Student and Admin Reports: No honorifics.

### 11.5 Report Length Guidelines
- Student: 2-4 pages depending on question count (3-15 questions typical)
- Teacher: 2-3 pages per class
- Admin: 2-3 pages for entire school

### 11.6 Footer
Every report ends with exactly:
```
SAP - Self-Study Assistance Program - TopTutors Private Limited
```

---

## PART 12: EFFECT SIZE REFERENCE

| Intervention SAP Enables | Effect Size (d) | Plain-Language Meaning |
|---|---|---|
| Addressing misconceptions | 0.99 | ~1 year additional progress |
| Formative evaluation | 0.90 | ~11 months additional progress |
| Classroom discussion | 0.82 | ~10 months additional progress |
| Scaffolding | 0.82 | ~10 months additional progress |
| Feedback (specific, timely) | 0.73 | ~9 months additional progress |
| Student self-questioning | 0.46 | ~6 months additional progress |

Citation rules:
- Student Report: NEVER cite effect sizes
- Teacher Report: Maximum 1 citation per report
- Admin Report: Maximum 2 citations per report

---

## PART 13: GENDER PARITY INDEX

### 13.1 Calculation
```
GPI = Female_Avg_QQS / Male_Avg_QQS
```

If Male_Avg_QQS = 0, GPI is "N/A".

### 13.2 Interpretation

| GPI Range | Status |
|---|---|
| 0.95-1.05 | Parity achieved |
| 0.80-0.94 | Moderate disparity (favoring males) |
| 1.06-1.20 | Moderate disparity (favoring females) |
| <0.80 or >1.20 | Significant disparity -- investigate |

---

## PART 14: DATA INPUT REQUIREMENTS

### 14.1 What the Report Generator Needs

For a Student Report:
- Student full name, ID, Class (section), Date
- List of questions asked (with subject for each)
- For each question: the question text
- Student's streak count
- Student's historical weekly averages (for Growth Path)
- Class-level "Most Asked" and "Best Questions" data

For a Teacher Report:
- Teacher full name, Subject, Class (section + total students), Date
- Student-by-student data: Name, Avg QQS, Trend, Level, XP, Questions count
- Identified misconceptions with affected count
- Badge recipients
- Prediction data

For an Admin Report:
- Principal name, Total students, Total faculty, Date
- Grade-by-grade data
- Department-by-department data
- At-risk student counts by grade
- School Health Scorecard current + last week values
- Week-ahead prediction data points

### 14.2 When Data Is Missing

- Missing field: use "--" (double hyphen) in the table cell
- Missing section: include header with: "Insufficient data for this section. Will populate after [X] days of submissions."
- NEVER fabricate data. NEVER hallucinate student names, scores, or trends.

---

## CHANGELOG

| Version | Date | Change |
|---|---|---|
| 1.0 | March 2026 | Initial release |
| 2.0 | March 2026 | Added rendering guardrails (G1-G8), replaced all Unicode symbols with ASCII-safe equivalents, simplified table rules, added Devanagari handling protocol, added output mode specification |

---

This document is the single source of truth for all SAP report generation. Any conflict between this file and a report template is resolved in favor of this file.
