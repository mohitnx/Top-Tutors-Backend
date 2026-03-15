# SAP STUDENT DAILY REPORT -- Generation Template
## Self-Study Assistance Program -- TopTutors.ai
### Version 2.0 | March 2026

---

## RENDERING GUARDRAILS (STUDENT REPORT)

These rules are mandatory for every student report. Read SAP_PRINCIPLES.md Part G1-G8 for the full specification. This section is a quick-reference subset for the student report specifically.

### SR-G1: SYMBOL REPLACEMENTS FOR THIS REPORT

| Original | Replacement | Where Used |
|---|---|---|
| (triangle) IN ONE LINE | >> IN ONE LINE | Answer prefix |
| (arrow) Try asking... | --> Try asking... | "What to try next" |
| (warning) Trap text | [!] Trap text | Common traps |
| (star) 1, 2, 3 | #1, #2, #3 | Best questions ranking |
| (check) Yes | Yes | "You?" column |
| (up arrow) | [UP] | Growth path, level change |
| (fire) streak | [STREAK] X-day streak | Streak display |
| (em dash) | -- | Missing data |

### SR-G2: TONE RULES

1. Address by FIRST NAME only (after the header which shows full name).
2. Never shame. "Developing" not "weak." "Building foundations" not "behind."
3. Every weakness framed as a growth opportunity with a specific next step.
4. Written AS IF speaking directly to the student: "you asked," "your strongest inquiry."
5. No jargon. "Level 3 thinking" is OK. "Bloom's taxonomy level 3" is NOT OK for students.

### SR-G3: ANSWER BLOCK COMPLETENESS

Every single question MUST have all 8 parts. No shortcuts. No missing sections. If data is insufficient for any part, write a brief placeholder -- never skip the section header.

The 8 parts in order:
1. Question number and text
2. QQS Label and Score + coaching tip
3. >> IN ONE LINE
4. FULL EXPLANATION
5. SEE IT IN ACTION
6. YOUR SYLLABUS CONNECTION
7. WATCH OUT -- COMMON TRAPS
8. WHAT TO TRY NEXT

### SR-G4: NEPALI SUBJECT QUESTIONS

When a student asks a question in Nepali:
- Display the question in Devanagari IF the output mode is PDF-FULL or HTML
- Display in Roman transliteration IF the output mode is MARKDOWN-SAFE or PDF-LATIN
- Always include a parenthetical English translation after the question
- The answer and explanation should be in the same language the report is primarily written in (English for English-medium reports)

### SR-G5: LENGTH CONTROL

- Learning Story: 4-6 sentences. Never more than 8.
- Full Explanation per question: 3-6 sentences.
- SEE IT IN ACTION: 2-4 sentences.
- WATCH OUT traps: 1-2 sentences each, maximum 3 traps.
- WHAT TO TRY NEXT: 1-2 sentences.
- Total report: 2-4 pages depending on question count.

---

## REPORT STRUCTURE (Follow This Exactly)

### SECTION 1: HEADER

```
STUDENT ASSESSMENT REPORT

YOUR DAILY LEARNING REPORT

Student: [Full Name]    ID: [Student ID]    Class: [Class-Section]    Date: [DD Month YYYY]
```

---

### SECTION 2: YOUR LEARNING STORY TODAY

A personalized narrative summary of the student's day. Must include ALL of the following in natural, flowing prose (not bullet points):

1. First name address (e.g., "Aarav, you asked...")
2. Total questions asked today and number of subjects covered
3. Strongest inquiry -- highest-QQS question, why it was strong (reference level in student-friendly language)
4. Streak count (e.g., "Your 12-day streak continues")
5. Quality trend -- how average changed this week (e.g., "+0.8 this week")
6. Cognitive shift observation -- change in question TYPES
7. Encouraging insight connecting behavior to deep learning

Length: 4-6 sentences.

Example:

Aarav, you asked 15 questions across 3 subjects today. Your strongest inquiry was in Science, where you asked why salt dissolves but sand doesn't -- a question that shows you're thinking about molecular-level causes, not just memorising facts. That's Level 3 thinking. Your 12-day streak continues, and your average quality has risen +0.8 this week. You're asking fewer 'what' questions and more 'why' and 'how' questions -- that's exactly the shift that separates surface learners from deep thinkers.

---

### SECTION 3: SUBJECT BLOCKS (Repeat for Each Subject)

For EACH subject the student asked questions in today:

#### 3A: Subject Header

```
[SUBJECT NAME] -- [X] Questions -- [X.X] Avg Quality
```

#### 3B: Question-Answer Blocks (Repeat for Each Question)

For EACH question, generate the 8-part answer block:

```
Q[N] [Full question text]

[QQS_LABEL QQS_ROUNDED/10] -- [Coaching tip from Principles Part 9.2]

>> IN ONE LINE
[1-2 sentence answer. Concise. Proper terminology.]

FULL EXPLANATION
[3-6 sentences. Grade-appropriate. Accurate.]

SEE IT IN ACTION
[One real-world example or home experiment. 2-4 sentences.]

YOUR SYLLABUS CONNECTION (verified)
[Chapter, topic, exam relevance. Nepal curriculum. 1-2 sentences.]

WATCH OUT -- COMMON TRAPS
[!] [Trap 1 -- specific misconception. 1-2 sentences.]
[!] [Trap 2 -- if applicable. Maximum 3 traps.]

WHAT TO TRY NEXT
--> [One follow-up question. Explains WHY this deepens understanding.]
```

Rules for Answer Blocks:
- Every question gets all 8 parts. No exceptions.
- SEE IT IN ACTION: must be PRACTICAL -- something the student can visualize, try at home, or observe.
- YOUR SYLLABUS CONNECTION: reference Nepal curriculum chapters/topics. If exact chapter unknown, state general topic and omit "(verified)."
- WATCH OUT: actual common misconceptions, not generic warnings.
- WHAT TO TRY NEXT: suggest a question ONE Bloom level above the current question.
- Sort questions within a subject by QQS descending (highest first).

---

### SECTION 4: MOST ASKED IN YOUR CLASS TODAY

```
Most Asked in Your Class Today

Questions many classmates also asked -- you're not alone.
```

Table columns:

| SUBJECT | QUESTION | ASKED BY | YOU? |
|---|---|---|---|

- Show 3-5 questions (most frequently asked across class today)
- ASKED BY = number of students who asked this or similar
- YOU? = "Yes" if this student asked it, "--" if not
- Sort by ASKED BY descending

---

### SECTION 5: BEST QUESTIONS FROM CLASS TODAY

```
Best Questions from [Class Name] Today

Recognised for depth, curiosity, and original thinking.
```

Table columns:

| RANK | SUBJECT | QUESTION | SCORE |
|---|---|---|---|

- Show exactly 3 questions -- top 3 QQS from entire class today
- Rank as #1, #2, #3
- If current student's question appears, mark with asterisk (*)
- Score shown as "X/10"

---

### SECTION 6: YOUR GROWTH PATH

```
Your Growth Path

Today's Performance: Avg [X.X] -- [Description] -- Level [N] [LevelName]
```

Weekly progression table:

| WEEK | AVG | LEVEL | PATTERN |
|---|---|---|---|

- Show all available weeks (min 1, max 8)
- Current week row in CAPS or marked with asterisk
- Pattern column: describes Bloom level distribution in plain language
- End with prediction sentence:

"At this pace, you're on track to reach Level [N] [LevelName] by [month]. [Specific advice.]"

If <3 weeks data: "Keep going -- we'll have a growth prediction for you after 3 weeks."

Subject-wise summary table (optional, include if >=3 subjects):

| SUBJECT | QUESTIONS | AVG QUALITY | STRONGEST QUESTION | GROWTH TIP |
|---|---|---|---|---|

---

### SECTION 7: CLOSING LINE

```
Every question you write is a step forward. The students who ask are the students who understand.
```

This line is FIXED. Every Student Report. Never change it.

---

### SECTION 8: FOOTER

```
SAP - Self-Study Assistance Program - TopTutors Private Limited
```

---

## DEMO: COMPLETE STUDENT REPORT (v2.0 format)

---

STUDENT ASSESSMENT REPORT

YOUR DAILY LEARNING REPORT

Student: Aarav Sharma    ID: BNK10SCI042    Class: 10-B    Date: 16 March 2026

---

Your Learning Story Today

Aarav, you asked 15 questions across 3 subjects today. Your strongest inquiry was in Science, where you asked why salt dissolves but sand doesn't -- a question that shows you're thinking about molecular-level causes, not just memorising facts. That's Level 3 thinking. Your 12-day streak continues, and your average quality has risen +0.8 this week. You're asking fewer 'what' questions and more 'why' and 'how' questions -- that's exactly the shift that separates surface learners from deep thinkers.

---

SCIENCE -- 5 Questions -- 5.0 Avg Quality

---

Q1 Why does salt dissolve in water but sand does not?

EXCELLENT 7/10 -- This is a deep, analytical question. Keep pushing at this level.

>> IN ONE LINE
Salt is ionic -- it splits into charged particles that water molecules attract. Sand has strong covalent bonds that water cannot break.

FULL EXPLANATION
Table salt (NaCl) is held together by electrostatic attraction between Na+ and Cl- ions. Water is a polar molecule -- the oxygen end carries a partial negative charge, the hydrogen end a partial positive charge. When salt meets water, the polar molecules surround and pull apart the ions (hydration). The ions distribute evenly, forming a solution. Sand (SiO2) is a covalent network solid with extremely strong Si-O bonds in a 3D lattice. Water's polarity cannot break these bonds, so sand remains undissolved.

SEE IT IN ACTION
Drop a spoon of salt and a spoon of sand into two glasses of water. Stir both for 30 seconds. The salt glass becomes clear -- ions are invisible in solution. The sand settles to the bottom unchanged. Evaporate the salt-water and white crystals reappear, proving the salt was there all along, just dispersed at molecular level.

YOUR SYLLABUS CONNECTION (verified)
Connects to Chapter 7: Chemical Reactions and Solutions (Science Grade 10). Ionic dissociation is tested in the SEE under 'Solutions.'

WATCH OUT -- COMMON TRAPS
[!] Salt does NOT "melt" in water. Melting requires heat to change state. Dissolving is a physical process where particles separate and mix with solvent.
[!] Dissolving is NOT a chemical reaction -- no new substance forms. Salt can be recovered by evaporation.

WHAT TO TRY NEXT
--> Try asking: 'What happens at the molecular level when sugar dissolves? Is it the same process as salt?' This will deepen your understanding of polar vs ionic dissolving.

---

Q2 What happens to resistance when temperature increases in a metal?

GOOD 6/10 -- Good question. Try adding 'why' or 'what if' to push it further.

>> IN ONE LINE
Resistance increases. Higher temperature causes more atomic vibrations, obstructing electron flow.

FULL EXPLANATION
In metals, free electrons move through a lattice of positive ions. At low temperatures, the lattice is still and electrons pass with few collisions. As temperature rises, ions vibrate more, creating more collisions that slow electron drift velocity. More collisions = higher resistance. This relationship is approximately linear: R = R0(1 + alpha x delta-T), where alpha is the temperature coefficient of resistance.

SEE IT IN ACTION
A tungsten light bulb filament has ~20 ohm resistance when cold. At 2,500 degrees C operating temperature, resistance jumps to ~200 ohm -- tenfold. This is why bulbs draw a surge of current when first switched on (low resistance when cold).

YOUR SYLLABUS CONNECTION (verified)
Directly from Chapter 9: Electricity and Magnetism, Grade 10 Science. Temperature-resistance relationship is a frequent SEE question.

WATCH OUT -- COMMON TRAPS
[!] This applies to METALS only. In semiconductors, resistance DECREASES with temperature because heat frees more charge carriers.
[!] Don't confuse resistance with resistivity. Resistance depends on dimensions; resistivity is a material property.

WHAT TO TRY NEXT
--> Ask: 'If resistance increases with temperature in metals, why do superconductors lose ALL resistance at very low temperatures?' This challenges the rule and reaches Level 5 thinking.

---

(Continue for all remaining questions in Science, then repeat Subject Block for MATH, ENGLISH, etc.)

---

Most Asked in Your Class Today

Questions many classmates also asked -- you're not alone.

| SUBJECT | QUESTION | ASKED BY | YOU? |
|---|---|---|---|
| Science | Why does salt dissolve in water but not sand? | 23 | Yes |
| Math | How to find triangle area with two sides and an angle? | 19 | Yes |
| English | Active vs passive voice? | 21 | Yes |
| Social | Main causes of urbanisation in Nepal? | 17 | -- |

---

Best Questions from Class 10 Today

Recognised for depth, curiosity, and original thinking.

| RANK | SUBJECT | QUESTION | SCORE |
|---|---|---|---|
| #1 | Science | If resistance increases with temperature, why do superconductors lose ALL resistance at low temperatures? | 9/10 |
| #2 | Math | Can the sine rule and cosine rule give different answers for the same triangle? | 8/10 |
| #3 | Social | If urbanisation brings growth, why is Kathmandu struggling with infrastructure? | 8/10 |

---

Your Growth Path

| WEEK | AVG | LEVEL | PATTERN |
|---|---|---|---|
| Week 1 | 3.8 | Lv 1 Starter | Mostly recall questions |
| Week 2 | 4.4 | Lv 2 Builder | Descriptive questions emerging |
| THIS WEEK* | 5.1 | Lv 3 Explorer [UP] | Explanatory 'why' questions appearing |

At this pace, you're on track to reach Level 4 Analyst by mid-April. Keep asking questions that start with 'why' and 'what if.'

---

Every question you write is a step forward. The students who ask are the students who understand.

SAP - Self-Study Assistance Program - TopTutors Private Limited

---

## END OF TEMPLATE
