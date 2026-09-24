# Ideas

Unfiltered. No idea is too small or too silly to write down. Move one into
`sketches/` the moment it gets interesting; strike it through when explored
and link to what came of it.

## Measuring

This section exists because of `hollow` (2026-09-12), which walked into a trap
`bow` had already written down: *"a lesson filed under the sketch it happened to
is not where you look."* Measurement lessons go here from now on, whatever
sketch they happened to. The older ones are still in their family sections — the
big three being **a peak has to be accumulated, not sampled** (under rhythm,
from `irrational`), **autocorrelation alone never establishes which period is
fundamental** (under synthesis, from `bow`), and **check that a summary statistic
can vary before believing it** (under rhythm, from `escalator`).

- **A threshold that has to split the data cannot report "nothing is missing".**
  `hocket`'s per-step detector cut at the widest ratio gap in the sorted step
  energies — self-calibrating, and right on every configuration that contained
  silence. On the interlocked pair, where the right answer is *every step is a
  note*, there was no note/silence boundary to find, so it split the two
  **voices** instead (they differ by 1.57 in level) and reported one voice's
  density as the notes-per-step. Prefer an absolute cut when "none" is a legal
  answer, and make the detector able to say *nothing rejected*.
- **The capture worklet posts channel 0.** Anything panned is attenuated at the
  tap, and two voices panned apart arrive at different levels for no musical
  reason. Sum to mono first: one gain node with `channelCount = 1` and
  `channelCountMode = 'explicit'`. Latent in every harness here that has ever
  compared panned voices by level.
- **A search bounded by a number you picked will eventually be too small.**
  Sliding a recording against a predicted pattern needs an offset equal to the
  transport's step count when the capture began — which grows through a run. A
  span of 300 was fine for the first capture and short for the second, and the
  near-miss read 62% where chance was 53%, which is exactly the range that does
  not look like a bug. Bound the search by something the run knows.
- **Do not edit anything under `src/` or `sketches/` while a harness is live.**
  Vite hot-reloads the page and the in-page handles vanish mid-capture. Same
  hazard as the `?t=` second-copy trap in CLAUDE.md, from the other end.
- **A ring buffer is a low-pass filter on your own experiment.** `nest`'s
  control looked broken — 0.0000 empty steps against a predicted 0.3286 — because
  I read the sketch's 4096-long dispatch ring 400 ms after flipping the toggle,
  about three steps' worth, so almost everything in it predated the change.
  Waiting six seconds gave 0.3250. Before doubting the sketch, check how much of
  what you are reading is older than the thing you changed.
- **A model module the harness imports cannot use the `@core` alias**, because
  node cannot resolve a Vite alias. Promoting a helper to core on its second use
  is right, and the module that runs outside the app then has to reach it by
  relative path with the `.ts` extension — which both Vite and node accept.
- **A smoke suite that plays every sketch at its defaults cannot see a param
  that stacks voices.** `nest` clipped at 1.203 pre-limiter with a long decay
  while the suite passed throughout. Third time in this file (`arc`,
  `foreshadow`): a sketch whose level depends on how much the player piles on
  needs a computed worst case, not a sampled one.
- **A rectangular window's leakage can *be* the floor you report.** `contrary`
  read its supposedly-absent melodies at −70 to −81 dB where the model puts them
  at −273, and I went looking for a nonlinearity in the signal path. Two tones at
  −10.8 dB leak into every other frequency as sinc sidelobes falling only as
  1/Δf; a Hann window moved a control frequency from −66.5 dB to **−136.4** and
  the melodies to −164 to −211. Pair it with the opposite lesson from `sitting`:
  do *not* window an impulse response, which keeps its energy at t = 0. A steady
  tone is not an impulse response.
- **The tell for an analysis floor is a control that reads the same as the
  subject.** The number that diagnosed the above was already printed in the
  validation line — a frequency 40 Hz off a carrier, at −66.5 dB, the same order
  as the "melodies". Put a control frequency in every spectral readout.
- **Check which node the harness is tapping before believing a null.**
  `contrary`'s reveal control read −81.9 dB at 0 and −82.9 at full, which I
  nearly wrote up as "the reveal is too weak". The handle returned the bus
  *before* the shaper. Tapping the wrong side of an effect gives a perfectly
  steady, perfectly wrong null.
- **A capture has to be comfortably shorter than the thing it is catching, and
  "comfortably" counts the overheads.** `contrary` held a note for 3.0 s and its
  2 s capture took 3.05 s of wall clock, so the check that the note had not
  changed almost never passed and one condition reported failure eight times
  running.
- **Write the claim after measuring it, including in the doc comment.**
  `contrary`'s module asserted that the audible carriers were "doing something
  that is neither melody" before anything had been measured. They correlate with
  one of the melodies at 0.962. The constraint turned out to have a solution and
  the sketch is better for it, but the prose was in the file first.
- **A gate that passes on the broken case is not a gate.** `tuplet`'s onsets
  came back 300–600 ms from the model while its bar-to-bar repeat check read
  1.1 ms — because the capture starts mid-bar, so onset 0 is not note 0, and a
  *rotated* fold repeats exactly as cleanly as an aligned one. The check could
  not see the error it was there to catch. Fixed the way `hocket` did it: search
  every rotation and report the runner-up as the control (1.1 ms against 299).
- **Choose a known-answer case that has an answer.** `tuplet`'s first validation
  asked where five notes land on a grid of quarters. There are four slots, so
  the honest reply is a refusal — and calling the refusal "wrong" is testing the
  wrong thing. It still earned its keep: the sketch had been silently answering
  with a denominator outside the budget it was given, and that was a real bug.
  But the check had to be split in two before it meant anything.
- **`pkill -f <name>` matches its own shell.** `pkill -f tuplet-verify` killed
  the compound command it was part of, before the edit later in that command ran.
  Exit code 144, file unchanged, `npm run check` passing on the old code. Match
  on something the killing command does not itself contain, or use
  `ps -eo pid,args | grep -F ... | grep -v grep`.
- **Give a model a check that can only pass if it is internally consistent, and
  run it first.** `lattice`'s transfer matrices have a free gift: for a lossless
  reciprocal cell, half the trace must be a *real number*. Nothing about tone
  holes is being asserted — it only fails if the sign conventions in two
  different functions disagree. It read 6.55e−3 on the first run, small enough
  to have been shrugged at, and it was a real fault. After the fix, 0.00e+0.
- **A cliff-finding rule needs the cliff to be bigger than the slope, and that is
  a property of the signal.** `lattice` burned two detectors on this. Walking
  every harmonic found the cutoff at exactly 2·f0 for all eight fingerings,
  because a cylindrical pipe suppresses even harmonics by 20 dB. Walking the odd
  harmonics found exactly 3·f0, because the natural rolloff from the first to
  the third is 15–21 dB. Both wrong answers were suspiciously *clean*, which is
  the tell: a detector locking onto the same simple multiple every time is
  reporting its own structure, not the signal's.
- **Validate a knee-finder on a knee you chose.** A two-segment fit recovered
  synthetic knees to 0.3–3.3% and then returned 324–1512 Hz on the instrument —
  which is how you know the scatter is the signal rather than the tool, and the
  answer is "there is no knee". Without the synthetic channel that is just a
  third broken detector.
- **An exponent picked by ear can blunt the very feature you are measuring.**
  `lattice` rendered harmonic amplitudes as |Z|^0.55, which compressed the
  model's own 20 dB collapse at the cutoff into 10. Exponent 1 — the harmonic
  follows the impedance — is both more faithful and less arbitrary. It did not
  change the conclusion, which is how I know the bluntness was physics and not
  taste; but until it was tested, it was my thumb on the scale.
- **A prediction checked only where two hypotheses coincide has been checked
  against one hypothesis.** Cost `drag` two whole findings in one day. Its drag
  rate was predicted from a player's *own* mean delay and verified exactly on a
  symmetric ring — where a player's own mean and the ensemble's are the same
  number. The asymmetric layouts, sitting at a dead-constant 0.7778 and 1.1334,
  were what said it belongs to the ensemble. Then the ensemble average was a
  plain one, verified at ratio 1.00000 on 24 cells — every one with uniform
  earshot, where the plain and attention-weighted averages agree to 0.0000%.
  Ask what the symmetric case cannot distinguish, and go and measure *that*.
- **Validate a detector in the regime you are about to use it in, not the one
  where it is easy.** `drag` burned two. A fixed refractory that merged attacks
  within a beat passed on a tight ensemble and read 287 bpm for a room playing
  110 the moment narrowing the earshot pulled the players apart — the exact
  setting under test. Its replacement passed nothing: plain autocorrelation of
  the onset flux returned 60.003 where the answer was 120.000 by construction.
- **Do not autocorrelate a signal that still has sustained tones in it.**
  `drag`'s players beat against each other at ~31 Hz, and a half-second beat
  holds 15.5 cycles of that — a half-integer, so the fine structure inverts
  every beat and repeats every two, and the true period correlates *worse* than
  its double (0.698 against 0.9922). The first-near-best-peak rule does not save
  you, because the true peak is genuinely the smaller one. Smooth the onset
  envelope past the beating first.
- **A double is not the rational it prints as, and sometimes that is the
  finding.** `hocket`'s 1/q collapse is a fact about the ratio: in integer
  arithmetic all 79 fractions with q ≤ 16 collapse, but as doubles 6 of them
  tile perfectly and 10 collapse at less than the predicted rate. Snapping to
  2/3 sounds like nothing happened. When a law is about exact rationals, test it
  in integers and treat the float version as a separate question.
- **A worst departure taken over cells where the prediction is near zero is
  arithmetic on noise.** `afteryou`'s deaf-mode law read 39.81% worst, which was
  a cell predicting 0.0024% and delivering 11 clean turns out of 163,572. Over
  the cells with 500+ events behind them it is 4.08%. Report the count beside
  every ratio and say which cells the headline excludes, or the honest number is
  buried by the meaningless one.
- **A selection that requires two events to be close has already selected for
  the collision you are predicting.** `afteryou`'s 2τ/W backoff law was ~10%
  high, so I re-sampled on both players retrying within one window of the same
  clash — and it got three times *worse*, because that condition is most of the
  collision criterion. Split on one side at a time. Doing so explained the
  residual exactly: prompt retries run 1.26–1.94× over the law (you only retry
  promptly if you got in first, and the player who is first can be talked over
  from one side only) while deferred ones sit at background, and the two cancel.
  **The pooled agreement was luck.**
- **Independence in the closed form means independence in the generator.** One
  shared `rng` across simulated agents makes how many draws A takes depend on
  what B is doing, and `afteryou`'s renewal law came out 1.4–3.1% off in exactly
  the cells with the most data. One stream per agent — and a separate one for
  anything musical — took those cells to 1.0002 / 1.0006 / 1.0009. The second
  half matters on its own: sharing a stream between timing and notes means
  changing a tune moves every event in the piece.
- **Read a sketch's own log as it goes if the sketch trims it.** `afteryou`
  keeps 26 s of turns, so a harness reading the list once after a 34 s capture
  lost the first third and scored real sound as model-silence, collapsing a
  known-answer contrast to 1.0x. Poll and merge by id. Same family as `nest`'s
  ring buffer: **the sketch's memory is part of your instrument.**
- **Ship an envelope out of the page, not a waveform.** Serialising 34 s of
  samples as a JS array through `page.evaluate` is ~1.6M numbers and it failed
  midway through a sweep for no reproducible reason. Accumulating RMS frames in
  the page is 100× less to move, and the envelope is what the analysis wanted.
- **A column that does not move when its input does is the finding.**
  `dichotic`'s first generator produced 2.9 crossings per 64 steps whatever
  crossing rate it was asked for — a flat column across a ten-fold sweep, read
  past twice. A crossing is a sign change of the *gap* between two lines, so the
  gap is what has to be written; as a centre plus a cosine the rate comes out
  right by construction and can be checked against `cross·n` (measured 0.948 to
  0.986 of it).
- **A comparison of two things as a set always matches when both sides hold
  both.** Asking whether a stream passed through a crossing by comparing the two
  notes at that step against the two composed notes read 100.0% for both rules
  at every rate — a clean confirming table measuring nothing, because both
  streams always contain both notes. The question was about identity *over
  time*: which line each stream was following before and after.
- **A sign test that skips zeros skips the crossings that matter.** Two lines
  that *meet* on a degree and turn — which is exactly what Deutsch's scales do —
  counted as never crossing, so pieces were reported crossing-free while failing
  a test crossing-free pieces cannot fail.
- **The capture worklet posts `r` as well as `l`.** Every harness here has
  mono-summed because channel 0 is the documented trap; a genuinely stereo
  sketch wants both, with `channelCount: 2` and `channelCountMode: 'explicit'`
  on the node, and then per-channel attribution is available.
- **If the thing you are measuring the value of also appears in how you made
  the data, you have measured your generator.** `shorthand`'s first transform
  ablation asked how much allowing inversion helps — on tunes its own generator
  had built using inversion 25% of the time. The fix is a control row where the
  transform is absent: 14.5% becomes 0.9%. Same shape as `afteryou`'s circular
  backoff sample two days earlier, and the pattern is worth a name.
- **Check that the question is answerable before reading its answer as a
  failure.** `shorthand`'s recovery of planted structure was 33%, which looks
  bad — but it finds a *cheaper* description than the planted one 199 times in
  200, so a parse cannot be both optimal and in agreement. The cost comparison
  was the test that meant something, and it was already passing.
- **An onset is a rise, not a level.** Notes that ring for five steps make the
  level inside a step window mostly the previous note's tail, and thresholding
  it gave `shorthand` 93.2% agreement at an 8.5x contrast — plausible, and an
  artefact. On the rise at the step boundary the same audio reads 100.0% and
  exactly 0.00000. Fifth sketch here to hand-roll an onset detector and get it
  wrong first time; `ideas.md` has wanted a shared spectral-flux one since
  `groove`.
- **Ask whether the quantity is reproducible before hunting the discrepancy.**
  `chatter` runs the same integrator in node and in a worklet, and their bounce
  counts differed by up to 40% after every real difference had been fixed.
  Perturbing the drop speed by one part in 10¹⁵ — the last bit of a double —
  moved it 2.3%, and by 10¹² moved it 23.6%. A ball bouncing on a vibrating
  surface is chaotic, so two V8 builds disagreeing in the last ulp of
  `Math.pow` is a complete explanation, and the bounce count is not an
  observable. The two agree *exactly* (19 and 19, 77 and 77) on the settings
  where the dynamics are not chaotic, which is the same fact stated usefully.
- **NaN in a filter state is silence, and silence looks like a clean zero.**
  A `Float64Array` zero-fills, so a worklet's first `process()` — which runs
  before its configuration message arrives — divided 0/0 and poisoned the modal
  state forever. Every number in the verification run came back `0.000` rather
  than as an error. Initialise anything a divisor might be, and have the
  worklet *rescue* NaN state and count it so it can never be invisible.
- **Two copies of a model must be checked for the boring differences first.**
  `chatter`'s node model started the stick at rest where the worklet started it
  at the drop speed, and clamped the bar's decay at 20 ms where the worklet
  clamped at 0.4 ms — so the "dead bar" rows were not the same bar. A
  cross-check between two implementations is worthless until the initial
  conditions and the clamps match, and both of those look like results while
  they are wrong.
- **What a strike puts into a resonator is momentum, not force.** The impulse
  of a Hertzian contact is (1+e)·m·v — peak force and contact time both depend
  on stiffness and hardness and the two cancel. So stiffness and hardness are
  timbre knobs and mass and speed are level knobs, which is what a level
  normaliser should be built on.
- **When a level measurement is not reproducible, the level is not the
  problem.** `afteryou`'s worst setting read 1.199, 1.700 and 1.178 on three
  runs of the *same* config, which is not a gain to tune — it is an unbounded
  voice count, and the peak was whichever way a dozen oscillators happened to
  line up. The cause was each player's notes decaying 0.55 s over a 0.24 s
  spacing, so one "player" rang four notes at once. **A player is one
  instrument**: ending each note at the next bounded simultaneity by the player
  count and the spread collapsed. Reproducibility first, calibration second.
- **The same reading twice from two different gains is a ceiling, not a
  measurement.** 0.993 twice, while every other row moved, was the limiter.
- **A gain computed per note at schedule time cannot answer a surge**, because
  the notes are already booked — so a density normaliser belongs on a gain node,
  not in the note. And with a lookahead scheduler it can be *predictive*: the
  model runs ahead of the sound, so the window that sets the gain is mostly
  still in the future and it starts moving before the surge is audible.
- **The peak of a sparse random texture has a ±50% spread between 15-second
  windows.** Two readings cannot tune a level to a tight band; set the ceiling
  with margin and stop. The gate that matters is "nothing clips", not "the
  defaults hit 0.6".
- **Do not edit a watched file while a Playwright harness is running.** Vite's
  HMR reloads the page, the sketch's window handle vanishes mid-capture, and the
  run is wasted. It failed loudly only because the harness checked its capture
  for nothing — without that guard it would have been a table of zeros.
- **A rare-event demonstration has to be given a rare event.** `afteryou`'s
  deadlock is permanent once it starts, but it needs a collision to start it,
  and at the defaults collisions are ~3% of turns — so 26 s of audio often
  contained none and all three backoff settings returned *byte-identical*
  numbers. Identical output across settings that should differ is the signature:
  the branch was never taken. Configure the seeding event to be near-certain,
  then let the phenomenon establish before recording.
- **A comparison that fails in precisely the way your hypothesis predicts is not
  evidence for it.** `vuza`'s first audio run scored the aperiodic canon 35/140
  and the periodic controls 129/140, which reads as "the aperiodic one is harder
  to recover" and is an artefact: the sequences were compared *by position in
  the onset list*, so one missed onset shifts everything after it — which a
  repeating sequence absorbs and an aperiodic one cannot. Align to the grid by
  *time* and all four go to 149/149. Before believing a gap between conditions,
  ask whether the *instrument* is differently sensitive to them.
- **Typechecking a param default proves nothing about the param.** A select's
  default is a plain string, so `majorPentatonic` for `pentatonicMajor` is
  well-typed, throws inside `degree()` on every mount, and leaves the sketch
  completely silent while every table computed in node stays immaculate — they
  never touch the sketch. Worth tightening the type so the default has to be one
  of the declared options.
- **The first lag of an autocorrelation search is always a local maximum**,
  because nothing is computed below it. For a low note that edge reads as a
  pitch several octaves up. Start the peak scan one lag in — and check the pitch
  histogram against the number of voices, which is what caught it: thirteen
  classes where there were twelve voices.
- **Filter on the property you are testing before the expensive step.** `vuza`'s
  first survey enumerated every entry set of every subject including the
  periodic ones, which cannot qualify — 79 million of them at n = 48, 88 s where
  4.6 s would do.
- **A peak-per-hop envelope needs a hop longer than one cycle of the tone.**
  `elbows`' detector used 32 samples against a 131 Hz note whose period is 337,
  so every cycle of the waveform read as a fresh rise: **34 onsets a bar where
  there were 8**. An RMS window spanning several periods, peak-picked rather
  than edge-found, fixes it — the envelope peaks a fixed lag after each attack
  and a constant lag cancels out of every interval. **Four sketches have now
  hand-rolled an onset detector and all four were wrong first time**; the
  spectral-flux one this file keeps asking for is overdue.
- **Two onsets closer together than the notes are long cannot be separated, and
  the count tells you so.** `elbows` read a steady 11 onsets a bar for 23 of 30
  bars because gaps of 48 ms held notes of 80 ms, and the overlap beat. A
  histogram of events-per-bar is a one-line diagnostic whenever the true answer
  is a known integer, and it named this immediately where the trace only looked
  noisy.
- **Validate a window by a quantity that must hold, not by its position in a
  list.** Indexing windows by onset index put spikes in `elbows`' trace exactly
  as it had in `vuza`'s the day before. Here n players firing once each span
  exactly a bar, so checking the span *is* checking that the window holds one of
  each — a bad window is dropped instead of shifting every window after it.
- **When a measurement of a moving thing is worse than of a still one, suspect
  the window, not the thing.** `elbows` agreed with its model to 0.006 and 0.002
  in log rms for the two arrangements that stand still and only 0.041 for the
  one converging — because a one-bar window straddles a bar line and mixes the
  arrangement before the update with the one after. The static cases have
  nothing to mix, which is what makes the comparison diagnostic.
- **Normalise the level by what is actually changing.** `elbows` swung 2× in
  pre-limiter peak — 0.31 settled against 0.62 bunched — for the same notes,
  because a bunched ensemble is a chord and a spread one is a pulse train. The
  sketch already computed how bunched it was, so dividing by `1 + order` flattened
  it. A level that drifts with the state needs the state in its formula.

## Sequencing & rhythm

- Sequencer where each step holds a *probability* and a *condition* ("only on
  every 3rd pass") rather than on/off — Elektron-style trig conditions.
- ~~Polymetric tracks: 5 against 7 against 16, all on one transport.~~
  → `sketches/convergence`: a tempo canon, same phrase at 3:4:5, converging
  every 5.19s (measured 5.05s from the audio envelope). See
  `research/log/2026-08-04-convergence.md`.
- Countdown to the next convergence point — the arrival lands harder if you
  can watch it approach.
- ~~Accelerating canon (Nancarrow's other trick): a voice whose tempo changes
  continuously, so convergences are non-periodic.~~ → `sketches/crossing`:
  exponential tempo sweeps placed from the closed form t_n = ln(1+nk/r0)/k.
  85 of 96 notes land within 10 ms of it, the voices trade places at 11.80 s
  against a predicted 12.00, and coincidences arrive at 0.95 ± 0.66 s — a
  spread that is exactly zero for any fixed-ratio canon. See
  `research/log/2026-08-21-crossing.md`.
- Non-symmetric sweeps in `crossing`: with k_a ≠ −k_b the product r_a·r_b stops
  being invariant, so the coincidence rate should sweep too. One parameter away
  and a sharper test of the same algebra.
- Sweep tempo along a *drawn* curve rather than an exponential, so the
  crossings can be composed. Needs a numerically inverted phase function.
- Two crossings in one piece — sweep down then up, so the voices meet twice and
  the second meeting is at a different tempo.
- A 3 ms attack on a pure sine is still a broadband click. Band separation has
  to account for the transient, not just the steady tone.
- Per-voice transposition in a canon, so convergence is a chord not a unison.
- ~~A rhythmic canon whose voices interlock to fill every pulse exactly once.~~
  → `sketches/tiling`: draw a rhythm, and a complete backtracking search finds
  the entry points that tile the cycle. Composite even to 0.07 of a pulse while
  each voice wanders by 4.1. See `research/log/2026-08-10-tiling.md`.
- ~~Vuza canons — the rhythms that tile but whose entry set is *not* periodic.
  The search in `tiling` almost finds them; it needs to reject entry sets that
  are a union of cosets.~~ → `sketches/vuza`: they exist, and not until 72
  pulses. A complete enumeration of **every** cyclic length from 2 to 60 — every
  split whose smaller half fits, which for all but 49 and 56 is every split —
  tried 11,913,350 subjects, found 56,722 that are aperiodic and tile, and
  **0 with both halves aperiodic**. At 72 there are 1,296. Read off a recording:
  149 onsets on 149 consecutive pulses, none doubled, 149/149 voices correct,
  and no shift of the heard sequence comes back onto itself under any renaming
  of the voices. See `research/log/2026-09-23-vuza.md`.
- **The property is not generic even where it first exists.** Of 47,821 subjects
  of six notes that are aperiodic and tile 72 pulses, exactly **3** have an
  aperiodic partner — 432 entry sets each, 6 up to translation. Eighteen objects
  in total, and no notation for any of them.
- **A repeat inside a rhythm is not the same as the rhythm being a repeat.** The
  subject `{0,8,16,18,26,34}` is `{0,8,16} ⊕ {0,18}`, so 48 of 72 pulses keep
  their owner under a shift of 8 — and still no shift maps the set to itself.
  Self-similarity is cheap; periodicity is the thing that can be heard as a loop.
- Close the one gap in the sweep: the 8×9 split at 72 is C(71,7) = 1.3 × 10⁹
  subjects by brute force. Building the two sides together instead of filtering
  finished subjects should cut it enough.
- 108 and 120, the next two non-Hajós orders, to check that the sweep's zeroes
  stop exactly where the classification says they do.
- Nest a Vuza canon inside itself — `nest` recurses a two-voice split into a
  tree, and subdividing one voice of an exact finite partition is the same move
  on a different object.
- Augmentation in a tiling canon: a copy at double the pulse spacing, which is
  how real mensuration canons work and changes the problem completely.
- Fill each voice of a tiling canon with a pitch sequence rather than one note,
  so the tiling is what keeps the melody from colliding with itself.
- ~~A rhythm at an irrational ratio, so it never comes back at all.~~
  → `sketches/irrational`: the characteristic Sturmian word, which is the same
  bucket-and-wrap as `euclid()` and so *is* E(p,q) at rational α — verified
  maximally even 20 of 20 and n+1 distinct windows 8 of 8. The finding was that
  "never repeats" is a claim no window supports: the apparent period is the
  denominator of the best fraction you can resolve, agreeing 24 of 24 with a
  derivation from fractional parts. π−3 has apparent period 113 forever; the
  golden ratio has none. See `research/log/2026-08-28-irrational.md`.
- ~~Two voices at densities α and 1−α: between them they hit every step exactly
  once, which is a tiling canon with an irrational rhythm — something `tiling`
  cannot express.~~ → `sketches/hocket`: Rayleigh's theorem, and it is exact —
  0 collisions and 0 gaps over 200,000 steps for each of five irrationals, and
  the complement is the only partner (0 of 4001 others). Each voice's own gaps
  take two values and the pair's take one. Read off a recording, each voice
  matches `floor(n/d)` on **229 of 229 steps** (23.6% at any other alignment)
  and together they fill all 229. See `research/log/2026-09-13-hocket.md`.
- **The simpler the ratio between two interlocking parts, the worse they
  interlock.** At an exact p/q a complementary pair drops 1/q of the notes and
  doubles 1/q — 17 fractions, worst departure 1.2e−5. That inverts the usual
  story, where simple ratios are the good ones, and it is the only place I have
  found where a rhythm *prefers* an irrational relationship.
- Uspensky's theorem in `hocket` says no three parts can share a pulse this way,
  but that is for *homogeneous* Beatty sequences. `floor(n·r + s)`, with an
  intercept, does admit partitions into three or more — which ones is Fraenkel's
  conjecture, open for six parts and up. A three-part hocket that works.
- ~~Beatty sequences nest: the steps a voice does *not* play are themselves a
  Beatty sequence, so the split recurses. A hocket whose parameter is a tree
  rather than a list of densities, sidestepping Uspensky entirely.~~
  → `sketches/nest`: it works, and exactly. **0 steps unowned or doubled over
  200,000**, for 2, 3, 4, 5 and 8 voices in both tree shapes — ten
  configurations of ten. Leaf densities are the products down the tree (worst
  3.4e−6, summing to 1.000000000000), and from the sound, 238 of 238 steps carry
  exactly one note at every voice count. See `research/log/2026-09-18-nest.md`.
- **Uspensky is sidestepped, not violated, and the gaps say which.** The
  three-distance theorem gives a real Beatty rhythm exactly two distinct
  inter-onset gaps; nested voices measure 3, 4 at three voices and 7, 8 at eight.
  A Beatty sequence *of* a Beatty sequence is not a Beatty sequence, so the
  theorem does not reach it. The one voice in a three-leaf tree that still reads
  2 is the one split off at the root and never subdivided.
- **The same densities, flat against nested: 0.6577 and 0.0000.** Identical
  numbers, one arranged as a list and one as a tree. `nest`'s `Flatten` toggle
  is that comparison and you can hear it fall apart.
- The tree's *shape* is a compositional parameter: balanced and chain with four
  voices both tile exactly and agree on who plays only 39.7% of steps. Two points
  in a space of Catalan-many shapes, with no existing notation.
- Let a node's density drift while `nest` plays: everything below it
  re-partitions continuously, so one slider re-voices a whole texture without
  ever breaking the tiling. No mixer can do that.
- Nest in *pitch* rather than time — the same recursion over an interval gives a
  chord whose notes partition an octave the way these partition a bar.
- `tiling`, `hocket` and `nest` are the same search at three levels of
  generality (a finite cycle, an infinite one with two voices, an infinite one
  with any number) and have never been put side by side.
- Two densities drifting slowly in opposite directions, so a hocket interlocks,
  comes apart at the rate M·ε, and re-locks.
- A Sturmian word is the cutting sequence of a line through a grid. Draw the
  line, drag it, and the slope is the only parameter there is.
- Let α drift slowly, so the rhythm passes through its own convergents in
  order — locking briefly at each and slipping between. A form nobody composes.
- ~~A rhythm that resists being pushed off a ratio, the way a drummer does.~~
  → `sketches/tongues`: the sine circle map, where the winding number *is* the
  rhythm's density in events per pulse. Tongue widths open as K^q (measured
  1.00 / 1.96 / 2.93 / 4.88 against 1 / 2 / 3 / 5), they nest by the Farey
  mediant 5 of 5, and at criticality what is left between them has box
  dimension **0.875** against the literature's 0.870. At K = 0 it is
  `irrational` exactly, W = Ω to 2.1e−13. See
  `research/log/2026-09-07-tongues.md`.
- Above K = 1 the circle map is non-invertible and the winding number stops
  being unique — the same Ω gives different densities from different starting
  phases. `tongues` already plays there and it sounds like disagreement;
  measuring the spread over initial conditions would make it a result.
- Two circle maps that hear *each other* rather than a common drive: the
  locking is then between players, which is an ensemble rather than a metronome.
- The tongue you are in names a ratio p/q, so `continuum`'s trick would let the
  same plateau be heard as a chord as well as a rhythm.
- Hysteresis at a tongue's edges — the plateau you leave sweeping up is not the
  one you re-enter sweeping down. One parameter away in `tongues`.
- **A peak is a maximum, so it cannot be sampled sparsely — it has to be
  accumulated.** `irrational` read 0.335 over 24 s and 3.010 over 35 s from the
  same build, because three consonant voices coinciding sum in phase and the
  coincidence is rare. `npm run smoke` had the same shape of bug, metering a
  46 ms window every 100 ms so it never saw more than half the timeline.
  (Corrected 2026-08-29: I first wrote that this under-reported sparse sketches
  by ~50%, from a single-run before/after on generative sketches. Metered
  properly — the same signal both ways at once — the gap costs 12.2% on
  `watershed`, 3.9% on `groove`, 0.0% elsewhere. Real, worth closing, not
  fifty percent.)
- ~~The smoke meter watches only 2.4 s per sketch, and `irrational` needed 35 s
  to reveal its worst case.~~ → the window is 10 s now, and widening it
  immediately caught `arc` clipping at 1.478 pre-limiter, 48% over, which the
  suite had passed since 2026-08-05: its tension curve shapes a 20.9 s form so
  the loud part is late, and the gate was only ever hearing the opening bars.
  Fixed at the source (gain 3.4 → 1.95).
- **`foreshadow` is the next `arc`.** Measured pre-limiter across four runs:
  0.65, 0.93, 0.96, 1.19 — the last a real gate failure, and it predates the
  2026-09-01 core change. Gain 6.0 → 4.5 puts the observed maximum at 0.89, but
  that is scaled against what was seen rather than what is possible. A sketch
  whose level depends on how much the player piles onto one bar needs a computed
  worst case, not a sampled one.
- A fixed reverb impulse response removes *one* source of run-to-run variance,
  not all of it. After seeding `noiseBuffer` I assumed a repeat would reproduce
  the suite exactly and it did not, because generative sketches carry their own
  randomness. Cheap test, and it stopped me attributing two failures to my own
  change.
- ~~**The smoke gate produces spurious `silent` failures on about a third of
  runs**~~ — four sketches on 2026-08-30, `arc` on 09-01, `arc` and `attractor`
  on 09-02, every one cleared by a re-run. Fixed 2026-09-03: a sketch now has to
  read silent *twice* to fail, and the retries are printed, so the flake rate is
  a measured quantity rather than something remembered badly. If a sketch starts
  needing the retry every run, that is a regression showing itself instead of
  hiding inside my re-run.
- **Ten seconds is still shorter than several forms here.** `arc`'s pass is
  20.9 s; `staircase`'s cycle is 24. A sketch whose loudest moment falls
  outside the window is still invisible to the gate. Either sample a full
  form per sketch, or compute the worst case instead of waiting for it.
- Guessing at a mechanism is not measuring it. I attributed a flaky smoke run
  to Chromium throttling the in-page meter; measured directly it ticks 49.9/s
  without the anti-throttling flags and 50.0 with. The sampling gap it
  replaced was real but cost 1.6% on average, not the ~50% I first published
  from comparing single runs of generative sketches.
- ~~A Risset rhythm: the Shepard tone done to tempo.~~ → `sketches/escalator`:
  octave-spaced pulse rates under a fixed bell in log-tempo, every layer
  doubling each cycle. Onsets come from the closed form u_k = T·log2(1 + k/A_i)
  and land within **2.9 ms** of it; the inter-onset interval falls by 1.711
  against 1.707 predicted. Density moves 1.36x with the bell against 1.75x
  without (control matches its 1.75x exactly). See
  `research/log/2026-09-02-escalator.md`.
- **A capture tap records nothing while its input is disconnected.**
  `capture.worklet.js` posts a block only when its input has channels, and
  Chrome gives a worklet an empty input when nothing upstream is connected. A
  sketch whose voices connect and disconnect per event therefore gets its
  *silences deleted*: 24 s of `escalator` came back as 6.0 s with the clicks
  butted together, which turns an accelerating pulse into a steady one — the
  exact result the experiment existed to test. Connect a ConstantSourceNode at
  offset 0 into the tap. Latent since the first harness, because every previous
  one tapped something continuously driven.
- **Check that a summary statistic can vary before believing it.** Two of
  `escalator`'s did not: "density at the start of the cycle versus the end" is
  ≈1 for *any* periodic curve sampled over one period, since those are the same
  phase, and it dutifully reported 0.96 for the case that doubles.
- **A low correlation against a flat prediction is not disagreement**, it is the
  absence of anything to agree about. `escalator`'s bell case correlates at
  0.407 and its control at 0.971; only the control's number means anything,
  because only the control has a shape.
- Lighter-tailed windows for `escalator`: the Gaussian bell's edges are the
  entire cost of the residual ripple, and a raised cosine over a fixed span
  should flatten the density at fewer layers. Predictable before building.
- Non-octave ladders — space the layers by 3 and make the cycle a tripling. The
  arithmetic is identical and it would sound nothing like it.
- A sequencer you edit by singing at it (pitch detection → steps).
- Rhythm as a cellular automaton — Rule 110 as a drum pattern generator.
- ~~Cowell's continuum: rhythm and pitch as one generator at different
  speeds.~~ → `sketches/continuum`: pulse trains at whole-number ratios, one
  slider spanning six octaves. Same 4:5:6 measured as pulse rates (1 : 1.2496 :
  1.4994) and as partials (219.4 / 274.5 / 329.7 Hz). Tightening the tuning
  from 20¢ to 4¢ costs 3.5 octaves of periodicity and stretches the bar from 4
  pulses to 46 — one number, both ends. See
  `research/log/2026-08-16-continuum.md`.
- What sets `continuum`'s 78 Hz measurement boundary? Ping length, analysis
  bandwidth and voice count were all tested and none of them move it.
- Two chords on the continuum at once at different octaves — one heard as
  harmony, one as rhythm, sharing a tuning.
- Automate `Octaves down` from the transport so the rhythm/pitch crossing is a
  musical gesture rather than a mouse drag.
- Bounded confidence on *onsets* instead of pitches: a crowd of players who
  drift toward the downbeat of whoever they can still hear. `sketches/earshot`
  does this to pitch; the rhythmic version is a sequencer, and probably the
  more interesting of the two.

## Synthesis

- ~~Karplus-Strong string model in an AudioWorklet~~ → `sketches/aeolian-harp`:
  strummable string bank + wind mode + partial-sharing sympathy. The bow is
  still open. See `research/log/2026-07-28-aeolian-harp.md`.
- ~~Bowed excitation — sustained stick-slip instead of bursts.~~
  → `sketches/bow`: a waveguide bowed string. Schelleng's force wedge is *not*
  in it (memoryless friction has no minimum bow force), but the bow-position
  comb is: bowing at 1/n notches partial n by 14-31 dB, six for six. See
  `research/log/2026-08-13-bow.md`.
- ~~Put the effort into the *excitation* rather than the resonator: a real
  Hertzian contact instead of a canned impulse.~~ → `sketches/mallet`: a
  Chaigne–Askenfelt mallet against a free-free beam. Contact time fits
  v^((1-p)/(1+p)) to three figures (0.000 / -0.204 / -0.338 / -0.500 against
  0.000 / -0.200 / -0.333 / -0.500), and in the audio the linear control at
  p = 1 is flat to 1% over a 16× velocity range while p = 3 climbs at 2.641.
  See `research/log/2026-08-25-mallet.md`.
- Two-point contact: a mallet with a soft outer layer over a hard core has two
  regimes, and real players choose a mallet for exactly that knee. One extra
  spring in series and the force curve gets an elbow.
- Contact *hysteresis* — Stulov's relaxation term, where the head does not
  return the energy it stored. It is what makes a felt hammer sound felt, and
  it is one convolution away in the same worklet.
- ~~Strike the bar twice within one contact time and see what the interference
  does; a roll at 300 Hz is not thirty strikes, it is one continuous contact.~~
  → `sketches/chatter`: do not drive it — *hold* it. A stick kept against a bar
  bounces, gaps shrinking geometrically by the restitution, infinitely many of
  them, over in finite time. Inelastic collapse, which out loud is a buzz roll.
  The contact time is exact rather than a scaling (Beta functions; at p = 1 it
  must be π√(m/k) and is, to nine figures in 9 of 9 cells). See
  `research/log/2026-09-20-chatter.md`.
- **A bar is not a table, and that is the whole difference.** A table does not
  push back; a bar is still ringing when the stick comes down, and a surface
  moving up at the moment of impact hands energy back. The textbook geometric
  law holds on a *dead* bar (gap ratio ÷ restitution = 1.028, identical for
  every decay under 40 ms) and breaks on a live one (1.254, collapse 28.55×
  the ballistic sum). **A buzz lasts 5.3–20× longer on something that rings**,
  which is one slider and is why a buzz on a practice pad dies.
- **Restitution is velocity-independent only for a linear spring**: p = 1 gives
  0.8401 / 0.8400 / 0.8401 / 0.8403 over a 30× speed range and p = 3 falls
  0.9047 → 0.6875. The same nonlinearity `mallet` found in the contact time,
  seen from the other side, with p = 1 as the control.
- The bounce sequence on a ringing bar is chaotic and nobody has asked what
  *kind*. A return map of gap n+1 against gap n would say whether there is
  structure in it or only noise, and it is ten lines.
- Two sticks on one bar, which is a real roll: they share a resonator, so each
  one's bounces are thrown by the other's, and whether they lock or scatter is
  the drummer's whole problem.
- `rosin` has a stick-slip state machine and `chatter` has a bouncing contact.
  A brush is both at once and neither sketch can make one.
- The same rig with a *string* rather than a beam: the piano hammer problem,
  where the strike point kills the 8th partial and everyone can hear it.
- ~~A gong rather than a bell: the shimmer that arrives *after* the strike,
  which no linear model can produce.~~ → `sketches/bloom`: modal plate plus
  resonant-triad coupling. Measured a 2.76× brightness rise peaking 0.47 s
  after the strike against 1.05× at 0.08 s for the linear control, and modes
  within 3.46% of the (m/a)²+(n/b)² eigenvalues. See
  `research/log/2026-08-19-bloom.md`.
- Find what clamps `bloom` above coupling 0.75 — the rise is non-monotonic,
  which means a safety limit is setting the level rather than the knob.
- Real von Kármán coupling coefficients for `bloom`, instead of the
  detuning-weighted surrogate. The difference between *a* plate blooming and
  *this* plate blooming.
- Strike position should change `bloom`'s bloom, not just its attack: hitting a
  node of the modes feeding the strongest triads should delay it. Sharp,
  untested prediction.
- Two plates coupled through a shared edge — which is what a gong rack is.
- ~~A hysteretic friction model — a real stick/slip state machine with distinct
  static and dynamic coefficients. That is what would put Schelleng's wedge
  into `bow` rather than merely onto it.~~
  → `sketches/rosin`: two thresholds instead of a curve, so breaking away costs
  μs·F and recapture only μd·F. It buys the *shape* — a band of exactly one
  release per period at every β ≥ 0.04, and **0 of 224 cells** with the loop
  closed, where the string is never once captured. It does not buy the
  arithmetic. See `research/log/2026-09-10-rosin.md`.
- **A clean law with the wrong exponent is a sharper negative than scatter.**
  `rosin`'s minimum bow force fits β^(−0.373) at R² 0.919 against Schelleng's
  −2. A boundary that scattered would be a measurement problem; this is the
  model saying something definite and wrong, and finding what sets −0.373 is a
  better question than forcing it toward −2.
- `rosin`'s duty cycle runs ~0.2 below the 1 − β that ideal Helmholtz motion
  requires, and climbs with bow force where it should sit still. The slip phase
  is too long because capture waits for |Δv| ≤ μd·F; a velocity-dependent
  dynamic coefficient would shorten it and is one line.
- The thermal rosin model — grip depending on a temperature that integrates the
  power dissipated in the slip. That is the physically honest hysteresis and
  what the literature uses to get Schelleng out.
- Point `rosin`'s state machine at `wolf`. A real wolf note is a bowing
  phenomenon and `wolf`'s negative-resistance bow can only sustain, never
  stutter. Same missing piece, now built once.
- Fractional-delay interpolation on `bow`'s split point, so the node sits
  exactly on the bow and the notch stops shallowing as n rises.
- A "which partial carries the energy" helper in `@core` — hand-written in
  three sketches now.
- A bridge model: strings coupled through a shared resonator with per-partial
  transfer (the mean-coupling shortcut is damping, not sympathy — measured).
- ~~The cello wolf note, as physics rather than as a defect.~~ → `sketches/wolf`:
  a string mode coupled to a body resonance, which is an avoided crossing you
  can play. 19 of 20 predicted normal modes found in the audio within 1.5 Hz
  (mean 0.066), closest approach 6.67 Hz predicted / 6.44 measured — never zero.
  The modes trade character across the crossing (100%/2% → 51%/100%), and
  sustain collapses 2.32 s → 0.53 s because there the mode is half body. With
  coupling 0 the peak sits on the string to 0.010 Hz and every note rings for
  exactly 3.20 s. See `research/log/2026-08-30-wolf.md`.
- **Audibility arrives well before resolvability.** At a realistic body Q of 26
  the wolf's splitting is about as wide as the body's own linewidth and the two
  modes merge into one peak — 8 of 20 separable instead of 19 — while the
  sustain collapse is untouched, 4.46x against 4.36x. The phenomenon is exactly
  as strong; only the ability to point at it changes. Worth remembering before
  concluding that something which cannot be resolved is not happening.
- Sweep Q in `wolf` and find where the two peaks actually merge, then check it
  against the linewidth arithmetic instead of asserting they are "about equal".
- The wolf eliminator: a mass on the tailpiece is a *third* oscillator that
  splits the body mode again. Three coupled modes, one more eigenvalue, and a
  sharp prediction about where the mass should go.
- A stick-slip bow for `wolf`. A real wolf is a bowing phenomenon — the stutter
  is the bow losing and regaining grip as energy sloshes into the body — and
  the current negative-resistance bow can only sustain, not stutter. This is the
  same missing piece as `bow`'s hysteretic friction model; building it once
  would serve both.
- Plucking into a ringing string is not addition. A finger landing for the next
  note stops most of what is there, so a re-pluck should keep a fraction of the
  existing displacement rather than adding to it — otherwise long ring times and
  fast scales stack without bound. Halving it converges on 2a and took `wolf`'s
  quiet-to-loud spread from 1.50x to 1.19x.
- Palm damping as a gesture: choosing what *not* to ring.
- ~~A reed and a bore, so the register break falls out of the model.~~
  → `sketches/overblow`: quarter-wave bore (even harmonics −46 dB), and a vent
  that is a *hole at a position* — 1/3 gives a twelfth, 1/5 gives two octaves
  and a third, measured ×2.98 and ×4.98. See
  `research/log/2026-08-08-overblow.md`.
- ~~Real tone holes for `overblow`: a row of them with open/closed state, so the
  fingering system *is* the instrument.~~ → `sketches/lattice`: a transfer-matrix
  bore with a row of holes, which is a *periodic structure* and so has a stopband.
  Two independent routes to the cutoff — the infinite lattice's Bloch dispersion
  relation, and where the fingered bore's resonances stop being odd harmonics —
  agree to **2.8%** across five fingerings whose fundamental moves by a factor of
  1.80, and to 9.0% across nine geometries. See
  `research/log/2026-09-15-lattice.md`.
- **A woodwind's spectral ceiling belongs to its holes, not to its note.** That
  is why a clarinet is recognisable across its whole range: every fingering
  shares one cutoff, set by hole width, spacing and wall thickness, scaling as
  (b/a)/√(s·t_e) to within 1.1–6.7%.
- **An irregular lattice takes its ceiling from its *worst* cell.** Over six
  settings `lattice`'s ceiling correlates with the lowest cell's own cutoff at
  r = 0.875 and with the mean at 0.250. One sloppy hole leaks and the instrument
  loses its top — which is what makers have always said.
- **A cutoff can be sharp in one observable and blunt in another.** `lattice`'s
  is crisp in *where the resonance series stops being harmonic* (±2.8%) and has
  no locatable knee at all in the radiated envelope (324–1512 Hz across
  fingerings), because above it the bore's impedance bounces rather than staying
  low. The bore stops **organising** the spectrum without **removing** it, and
  those are different things.
- A real reed for `lattice` — a nonlinear valve driven by the computed
  impedance, instead of harmonic amplitudes assigned from it. That is the step
  that would put the cutoff into the radiated sound, and it is the same shape of
  object as `rosin`'s stick-slip state machine.
- Cross-fingerings, which want per-hole state rather than counting open holes
  from the bell. They work *because* a closed hole downstream is not nothing;
  `lattice` already carries the compliance term and it currently does nothing
  visible.
- A conical lattice, which is a saxophone. `cone` has the modal bore and
  `lattice` has the holes; the two have not met.
- What sets the 1.1–6.7% spread between `lattice` and the long-wavelength closed
  form? The "k·s grows" story is dead (correlation 0.312). The end corrections
  (0.75b inner, 0.85b outer) are the next suspect and one sweep from being ruled
  in or out.
- ~~A true conical waveguide (the spherical spreading term at the apex). The
  cheap version — flipping the far-end reflection — does not oscillate at all,
  measured; a cone is not a sign flip.~~
  → `sketches/cone`: not a waveguide in the end but a *modal* bore, with the
  modes solved from kL + arctan(k·r₀) = nπ, so the truncation is a knob. The
  register break tracks the geometry from 1.999 (complete cone, octave) to
  2.986 (cylinder, twelfth), worst error 0.060 — and that 2.986 lands on
  `overblow`'s independently-measured 2.98. See
  `research/log/2026-09-05-cone.md`.
- The cone's modes are stretched rather than harmonic at any real truncation,
  which is why saxophone fingerings work in both registers only approximately.
  Measure the mistuning in cents against equal temperament as truncation grows.
- Give `cone`'s reed a mass. A second oscillator can pull the pitch off the
  bore's mode, which is what embouchure is, and it would let the sketch bend.
- The oscillation threshold against damping should be a straight line in the
  right coordinates: impedance has to beat losses, so threshold × damping
  ought to be constant. `cone` has both as params and never plotted them.
- Multiphonics: place a vent where two modes both have a node and see whether
  both speak.
- Map breath against embouchure to get the reed's playable region — the wind
  player's version of Schelleng's bow-force diagram, drawn from measurement.
- Granular sampler driven by pointer position over a waveform.
- A synth whose only control is a drawn curve — everything else derived from it.
- ~~Feedback FM: two operators modulating each other, kept just short of
  chaos.~~ → `sketches/attractor`: the route to chaos as the timbre knob,
  with the real phase portrait as the visual. The knee is at coupling ~1.9
  and is a cliff, not a slope. See `research/log/2026-08-02-attractor.md`.
- Per-note coupling for Attractor: velocity moves you through the
  bifurcation, so dynamics and timbre are the same gesture.
- A third FM operator — quasi-periodic (torus) territory, not just more chaos.
- A harmonic-deviation measure for the core, so inharmonicity claims can be
  tested; spectral flatness can only see noisiness.

## Improvisation & interaction

- ~~Accompanist that listens to MIDI input and fills the gaps you leave.~~
  → `sketches/call-response`. Works; inversion is the transformation that
  sounds like a musician. See `research/log/2026-07-28-call-response.md`.
- Answer the *contour* of a phrase rather than its notes — reply with the
  opposite shape (rose → falls). Probably closer to what a human does.
- A partner that sometimes declines to answer. Always replying reads as needy;
  letting a phrase stand would feel considered.
- Harmonise *under* a sustained note instead of answering after it —
  accompanist rather than interlocutor. Different dynamic, own sketch.
- ~~An instrument you conduct rather than play.~~ → `sketches/conduct`: an
  ensemble with individual reaction times that also correct toward what they
  hear. Measured lag = base/(1−follow), four for four. See
  `research/log/2026-08-15-conduct.md`.
- Give `conduct`'s players separate spectral homes so the within-beat spread is
  measurable from audio rather than only drawn.
- Conduct with a gesture: the beat should come from the *turnaround* of a drag,
  which is what a stick gives, and would let the ensemble anticipate.
- ~~A section leader — a player who watches another player rather than the mean.
  That is how real orchestras keep the drag bounded.~~ → `sketches/entrain`
  took the leader away entirely: an ensemble agreeing on a tempo by ear, where
  the only variable is the listening graph. Near agreement it is linear
  consensus, so the rate is set by the graph's algebraic connectivity λ₂ — and
  measured rate/β came out 0.602 / 1.033 / 8.353 against λ₂ of 0.586 / 1.000 /
  8.000. See `research/log/2026-08-26-entrain.md`.
- The *directed* version, which is the original idea and a different
  prediction: one player listens to nobody. The Laplacian stops being
  symmetric, the sum is no longer conserved, and the ensemble should land on
  the leader's tempo instead of the mean.
- ~~Consensus **with delay**. Real players hear each other late, and past some
  coupling strength a delayed consensus system oscillates rather than
  converging — which is the flutter a large ensemble gets in a live room.~~
  → `sketches/drag`: it does not oscillate, it **slows down**, and that is the
  better result. At perfect synchrony everyone still hears everyone else late,
  so everyone waits: the period grows by β·τ per beat (24 of 24 cells at ratio
  1.00000) and the room settles at T + (α + β/γ)·τ, exact to 0.00000% on 30 of
  36 settings and measured off the recording at 0.002–0.050% across six room
  sizes. Six players in a ring lose 0.49 bpm at half a metre and 29.83 at forty.
  See `research/log/2026-09-14-drag.md`.
- **The delay does not cause the instability — this idea's premise was wrong.**
  `drag` does go unstable above α ≈ 1.5, but the threshold is 2/(1 − μ) for the
  smallest eigenvalue of the listening matrix (predicting 1.333 / 1.500 / 1.667
  for 3 / 4 / 6 players, all measured at ratio 0.987), and **a 20× change in
  delay moves it by 0.049%**. It is plain over-correction and would happen in a
  room of no size at all. The delay causes the drag; the flutter is a separate
  mechanism that was sitting in the same sentence.
- **A conductor works by being *seen*.** An ear is a delayed *relative*
  reference; an eye is an undelayed *absolute* one, and any weight at all on it
  pins the tempo at exactly the nominal — the weight only sets how long it
  takes. Switching one on mid-drag makes the room *sprint* to recover the lag it
  built: 95.82 bpm, then 160.43, 119.63, 119.93, 119.99.
- **The tempo belongs to the players everybody listens to.** `drag`'s rate is an
  average of the players' delays weighted by how much each is *attended to* —
  the stationary distribution of the listening matrix. The one nobody can hear
  does not drag the room, which is why narrowing your own ears recovers ten of
  the thirteen bpm a bad room costs.
- Anticipation, which is the actual fix and is one line in `drag`: correct
  toward `heard + τ̂` rather than toward `heard`. Real players predict where you
  will be rather than following where you were, and that term cancels the travel
  time exactly. Whether an ensemble can estimate its own τ̂ is the real question.
- Put a wall in `drag`'s room so the listening graph disconnects. λ₂ from
  `entrain` sets how fast they agree and τ from `drag` sets what they agree on;
  a partition makes those two fight.
- Latency is the same arithmetic for a network as for a room, at 200,000 km/s
  instead of 343 m/s. `drag` is already a calculator for how far apart two
  musicians can play online, and it would be worth checking against what people
  report.
- Let the listening graph change while it plays: musicians look up and look
  away, so λ₂ becomes a function of time and the rate should track it.
- Edge weights as a mix decision — how loud each player is *is* how much they
  are heard, which makes λ₂ something you perform rather than configure.
- ~~**Repulsive coupling gives two camps, not an even spread.** Predicted a
  splay, measured clustering at half a beat: "avoid whoever you can hear" is
  satisfied by anti-phase, and an even ring requires knowing how many players
  there are, which no player does. Worth a rule that does know.~~
  → `sketches/elbows`, and the rule does **not** need to know. Listen only to
  whoever played immediately before and immediately after you, move to the
  middle of that gap, and the ensemble lands on a perfect round-robin —
  Degesys and Nagpal's DESYNC. The error is the discrete heat equation on a
  ring, eigenvalues `(1−α) + α·cos(2πk/n)`; measured decay matched **20 of 21**
  runs at ratio 1.0000, with the mean phase held to 4e−15 and **0 swaps**. See
  `research/log/2026-09-24-elbows.md`.
- **The order parameter cannot tell an even ring from a lopsided one.** Twelve
  seeds at eight players: `midpoint` ends 1.8e−16 uneven and `repel all` ends
  **0.468** uneven, and the Kuramoto order parameter reads **0.000000 for
  both**. `repel all` settles with one gap twice the fair share and another
  half of it. The natural statistic for "spread out" measures bunching, which
  is a different question, and it is confidently wrong about this one.
  (At eight players `entrain`'s "two camps" is really a ring with a hole in it.)
- **At exactly α = 1 the parity of the ensemble decides.** The
  shortest-wavelength mode has eigenvalue `1 − 2α`, so at 1 it flips sign each
  bar and never shrinks — and it only exists when n is even. Nine sizes of
  nine: every even ensemble sticks at ≈0.64 forever, every odd one converges.
  Not chaos, two arrangements alternating.
- **A rule can be free of n while its best gain is not.** The fastest
  correction is `α* = 2/(2 − cos(2π/n) − cos(2π⌊n/2⌋/n))`, ratios 0.9963 →
  1.0020 over ten sizes. So an ensemble can share a bar out without counting
  itself and cannot tune how fast it does so without counting itself. At three
  players α* = 2/3 zeroes every mode and they land in a single bar.
- Delay in `elbows`: the players already re-place themselves from a bar ago, and
  more of it should move the stability edge off exactly 1. `drag`'s arithmetic
  says where.
- A player who joins or leaves `elbows` mid-piece. The rule never knew how many
  there were, so it should absorb a newcomer with nothing being told — and how
  many bars that costs is a number no other sketch here can report.
- Weight `elbows`' midpoint toward one neighbour and the ensemble should settle
  on a *ratio* rather than an even split, which is the difference between a
  metronome and a groove. The eigenvalues stop being circulant.
- `elbows` finds an exact partition of a bar **by ear**; `vuza` and `nest`
  construct them. A found partition beside a constructed one is a comparison
  nothing here has made.
- When a residual has a tidy explanation, the explanation needs the experiment
  that would kill it in the same breath. `entrain`'s decay error ordered
  perfectly by graph diameter and the story was still wrong — it was the
  discrete-time correction, and shrinking β proved it in one run.
- ~~An instrument where a key is an *aim* rather than an assignment.~~
  → `sketches/inertia`: pitch is a particle with mass moving in a landscape of
  wells, U(x) = A(1 − cos(2πx/s)), and the instrument's pitches are the minima
  of that landscape rather than the keys. Escape velocity measured at 12–12.5
  st/s against 2√A = 12.00, with the excess rising monotonically 2.1% → 29.2%
  as damping rises and never falling below the floor. Control (no landscape):
  step-response overshoot within 0.4 points of exp(−πζ/√(1−ζ²)) across five
  values of ζ. See `research/log/2026-08-31-inertia.md`.
- **A residual with structure is a result nobody has recognised yet.**
  `inertia`'s wobble law was 6.7% out at the deepest wells and 1% elsewhere,
  which was not noise: the test kick was a 53° swing and the √A/s law is a
  small-angle limit. The wells are cosine wells, so each is a pendulum, and the
  wobble slows 28.1% from the softest landing to the hardest against 30.7% from
  the exact elliptic-integral period. The discarded error was the best thing in
  the sketch.
- Velocity should set `inertia`'s kick rather than its spring, so hitting
  harder overshoots into a different well — a real playing skill, currently
  unavailable.
- Wells at the degrees of a real scale rather than evenly spaced, with well
  *depth* encoding how strongly a tuning wants each note. Costs the exact
  arithmetic, buys jam compatibility (`root` + `scale`) and much better tunes.
- Two particles in one landscape, pushing each other about — `entrain`'s
  anti-phase result but in pitch instead of time.
- Tilt `inertia`'s landscape with a constant force so ascending and descending
  cost differently, which is what tessitura feels like.
- ~~**`noiseBuffer()` in `@core` should take a seed.**~~ Done 2026-09-01: it
  used unseeded `Math.random()`, so every reverb in this repo was a different
  room on every page load. Invisible until something measures through one: it
  moved `inertia`'s fundamental-to-octave ratio between 1.9 and 8.2 across runs
  whose worklet state was bit-identical. Worth noting it did *not* explain
  `pivot`'s unstable key finder, which I assumed it would — seeding it left
  those numbers bit-identical.
- **Physics measurements do not belong on the master bus.** Level checks do —
  that is where the ear is — but anything measuring what a sketch *is* doing
  should tap the sketch's own node, before the room.
- ~~An instrument that will not let you play a wrong note, with the cost of
  that made countable.~~ → `sketches/guardrail`: a continuous pitch surface with
  a variable snap. From no help to full help the vocabulary falls **61 → 8
  distinguishable notes per octave** (5.93 → 3.00 bits) while the fraction in
  tune with the scale goes **13% → 100%**, prediction and measurement never
  disagreeing by more than one note out of 61. See
  `research/log/2026-09-04-guardrail.md`.
- **The safety/expression trade is a threshold, not a slope.** `guardrail`'s
  vocabulary is untouched until the rail is half on and then falls off a cliff
  between 0.5 and 0.75 — a little help is free, a lot takes almost everything.
  The knee should sit where the snap brings neighbouring inputs closer together
  than the ear can separate, which is a prediction a finer sweep would move.
- A rail that is strong on the first note of a phrase and weak afterwards —
  places you in the key, then leaves you alone. Should buy the same in-scale
  fraction for far fewer bits.
- Per-degree rail strength: pull hard to the tonic and barely at all to the
  seventh, which is closer to how tonality behaves than a uniform snap and makes
  the staircase uneven in a way you could compose with.
- A rail with a *time constant* rather than an instantaneous one: vibrato
  survives auto-tune only if the correction is slow, so the measurement becomes
  one of modulation depth rather than static pitch.
- **Scheduling more notes than there are voices plays only the last few.**
  `PolySynth` allocates when `note()` is called, not when the note is due, so a
  61-note sweep handed over at once came back as 10 notes — and paired against
  the first 10 inputs it read as a 1021-cent tuning error rather than as missing
  notes. Keep fewer notes pending than there are voices.
- ~~An ensemble that couples through *loudness* rather than pitch or time —
  everyone wanting to be heard over everyone else.~~
  → `sketches/lombard`: to first order it is a max-plus linear system, so it
  grows at the **maximum cycle mean** of the "what I need over you" graph.
  Measured exact, 7 of 7 configurations at 0.0000 dB/round, once the graph is
  corrected for the soft maximum. See `research/log/2026-09-09-lombard.md`.
- **A room can run away with nobody in it being unreasonable.** The plain
  max-plus value is a strict lower bound, because hearing three rivals at once
  is ~5 dB louder than hearing the loudest. In `lombard` the pairwise threshold
  sits two spacing steps early: at spacings where no *pair* of players is in an
  escalating relationship, the room still climbs. Crowding causes the arms
  race, not assertiveness — and crowding is what nobody in a loud room can
  change.
- Per-band *listening* in `lombard`, separate from the band a player occupies.
  Wider ears than voice makes the graph asymmetric, and asymmetric graphs have
  different cycles.
- A player who drops out entirely when it cannot be heard — removing a node can
  flip the cycle mean, and ensembles really do this.
- Real masking instead of a Gaussian overlap in `lombard`, using `veil`'s
  machinery. Masking is asymmetric, low over high, so the graph is too.
- `lombard`'s settled levels are automatic mixing by simulated players. The
  converging case is a balance nobody wrote and it is currently unlistened to.
- Two-player instrument where each player controls half the parameters.
- ~~An instrument with deliberate latency — you commit a gesture a bar
  ahead.~~ → `sketches/foreshadow`: commits land ahead of the playhead on a
  decaying ring. Measured 2.40s gap against a 2.50s bar. See
  `research/log/2026-08-03-foreshadow.md`.
- Variable lead per note: a modifier key commits further out, so one
  performance spans several time horizons at once.
- Lead as a jam-wide parameter — the whole rack writing a bar ahead.
- Constraint-based improv: it refuses notes that break a rule you set.
- ~~An accompanist that learns your habits and plays your part before you do.~~
  → `sketches/understudy`: a variable-order Markov model over intervals, firing
  at the top of the step it expects you on. Predictability summons it (−55 dB
  of understudy on a loop vs −61 on a random walk) and `nerve` is a free
  escape. See `research/log/2026-08-09-understudy.md`.
- ~~An accompanist that copies your *timing* rather than your notes.~~
  → `sketches/groove`: a groove template — one running mean deviation per
  position in the bar — driving a line it invents. Learned the injected groove
  at r 0.997, and the partner's onsets measured from audio track it at r 0.986,
  with feel 0 flat and `Against you` at r −0.969. See
  `research/log/2026-08-20-groove.md`.
- Learn note *lengths* as well as onsets in `groove` — staccato and legato are
  as much of a signature as swing, and cost one more array.
- Save and load a groove template, so you can play with someone else's feel.
- Feed `groove`'s template into `conduct`, so an ensemble inherits one player's
  groove instead of the click's.
- **Every measurement should carry a known-answer channel.** `tartini`'s reveal
  control and `groove`'s own key presses both turned "I measured nothing" into
  "the detector is broken" — twice now.
- A spectral-flux onset detector for the harness toolkit. Three sketches have
  hand-rolled an envelope threshold and all three got it wrong first time.
- Score an accompanist's *timing* prediction separately from its pitch
  prediction — they fail in different ways and one hit rate hides both.
- A leash for `understudy`: cap how many notes in a row it may take, so the
  duet cannot become a solo without you agreeing to it.
- An understudy that listens to the whole *jam* rather than one keyboard, and
  doubles whichever channel is currently the most predictable.
- Draw the model: the graph of contexts growing as you play is the most
  interesting object in `understudy` and is currently invisible.
- A zealot that decays rather than vanishing on release, so a held pitch
  leaves a memory the crowd drifts back toward (`sketches/earshot`).
- ~~Turn-taking, not tempo: who plays, decided by ear, with no pulse.~~
  → `sketches/afteryou`. Improvisers waiting for a gap are doing **carrier sense
  multiple access**, and they inherit its bug: two who start within one travel
  time cannot have heard each other. Set every τ to zero and collisions are
  exactly 0 over 72,927 turns; the room is the only mechanism there is. See
  `research/log/2026-09-19-afteryou.md`.
- **What matters is starts per second of *silence*, not starts per second.** A
  player can only enter when the floor sounds clear, so that is the density
  inside the vulnerable window. With the correction, P(clean) = exp(−2·r·Στ)
  lands within **0.40%** over an 80× range of room size; without it the same
  prediction is 17% out at forty metres. One division separates a law from an
  excuse, and the naive version looks fine in every small room you would test in.
- **A clash preserves the gap between the two starts, exactly.** Both break off,
  both wait, both go — and the difference in their retry times is the difference
  in their original start times, for any response they *both* make, whatever
  their separate reaction times. So if it was inside the window it still is.
  `afteryou` on `polite` gives two players 10,474 consecutive collided turns with
  the offset frozen at −0.027425399 s. Being polite in the same way is not
  politeness; only disagreeing about how long to wait resolves anything.
- **A third player does what politeness cannot.** Two on `polite` clash 99.95%
  of the time, three 19.98%, six 19.61%. The crowd supplies the randomness the
  rule refuses to. A duo is the worst case — the opposite of `lombard`, where
  crowding is what causes the arms race.
- **Waiting for the gap is what makes you collide.** Sitting out a busy floor
  and entering the moment it clears runs 1.33–3.12× over the Poisson law and
  collides 9.4× more than re-drawing your own wait, in the identical room,
  because everybody's entry is now timed off the same event.
- Anticipation belongs here as much as in `drag`: enter toward where you predict
  the floor will be rather than where you hear it. It *cannot* close this window
  — the information has not arrived — so what it trades for what is the question,
  and `afteryou` is the sketch that can answer it.
- p-persistent entry — take a gap with probability p rather than always or never.
  The two extremes are measured; the sweep between them should have a minimum,
  and where it sits is a claim about how big an ensemble can be.
- A player who does not yield when talked over. Collision detection is currently
  perfect and universal, which is not how any ensemble actually works, and it is
  one branch in `begin`.
- Exponential backoff doubles the window per failure, which is the Ethernet rule
  and almost certainly not the musical one. Growing it with *how long you have
  been waiting* instead is a different and more human policy.

## Composition tools

- ~~Piano roll that can only express relationships (this note is a 4th above
  that one), so transposition is structural rather than a shift.~~
  → `sketches/cats-cradle`: intervals are the stored data, so transpose,
  invert, stretch and retrograde are one parameter each. Verified the
  algebra element-by-element. See `research/log/2026-07-31-cats-cradle.md`.
- ~~Harmony as a lattice you walk through, by minimal voice motion.~~
  → `sketches/tonnetz`: neo-Riemannian P/L/R moves over the Tonnetz. Measured
  1.40 semitones of voice motion per chord against 3.79 for random triads, and
  exactly two common tones in 47 of 47 transitions. See
  `research/log/2026-08-11-tonnetz.md`.
- ~~Developing variation as a search: how do I get from *this* idea to *that*
  one?~~ → `sketches/develop`: shortest path over invert/retrograde/rotate/
  widen/narrow plus single-note edits. Verified against an outside solver (24
  paths, 0 illegal, 0 sub-optimal). The classical operations make paths ~2×
  shorter and put a quarter of goals in reach at all — but rotate (+0.63) and
  narrow (+0.60) carry it, while the famous invert (+0.25) and retrograde
  (+0.23) matter least, because involutions open almost no new space. See
  `research/log/2026-08-22-develop.md`.
- Rhythm in `develop` — augmentation and diminution are half of what developing
  variation means and are entirely absent. Doubles the state space.
- Weighted moves in `develop`: a shortest path treats "nudge note 3" and
  "invert the whole thing" as equally expensive, which is musically absurd.
- Show `develop`'s runners-up — the moves that were one step longer. That is
  what a composer would actually browse.
- A path forced through a given motif in the middle: two searches joined, the
  compositional equivalent of a waypoint.
- A detector that cannot represent a repeat cannot measure music containing
  one. Four consecutive onset/pitch detectors have each failed *plausibly*;
  only the known-answer channel caught them.
- ~~A tool for composing a modulation, where the question is when the *ear*
  changes key rather than where the score does.~~ → `sketches/pivot`: a pivot
  chord belongs to both keys, so it carries no evidence and the turn must wait
  for the first chord the old key cannot explain. Prolonging the pivot moves the
  notated junction while leaving the evidence put, which turns a comparison into
  a pair of slopes: measured 0.99 behind the junction (predicted 1.00) and
  −0.01 behind the first foreign chord (predicted 0.00), pooled over two seeds,
  with ±0.30 of between-seed spread. Directional, not precise. See
  `research/log/2026-09-01-pivot.md`.
- **Validate the quantity the experiment reads, not the one the method is famous
  for.** `pivot`'s key finder named the right key in 44% of frames and I nearly
  abandoned it — but nothing in the experiment reads a 24-way argmax; it reads a
  two-way discriminant, and lengthening the window made the argmax worse (17%)
  while making the discriminant better. Two different questions.
- **And validate the *rule*, not the frames.** Frame-wise accuracy still was not
  it: the experiment reads one number per run, so the false-positive rate of the
  crossing rule on music with no modulation is the test that matters. It
  disqualified three of `pivot`'s four modulation distances.
- Chroma correlation cannot separate a key from its dominant over these
  timescales — six seconds of a ii-V-I really does contain more of the dominant
  than of the tonic — so `pivot` could only be measured at ±2 flatward. A
  likelihood ratio on the two candidate keys, or just tracking the leading tone,
  would see what the twelve-way profile throws away.
- Chromatic pivots for `pivot`: the German sixth and the diminished seventh
  belong to several keys at once, which is how nineteenth-century music
  modulates anywhere it likes.
- The sharpward/flatward asymmetry `pivot` already draws but has not measured:
  going up, the new V is foreign and gives the game away immediately; coming
  down, the new V *is* the old tonic and says nothing.
- Path-find across the Tonnetz: click a distant triangle and let it find the
  shortest route in P/L/R moves. That is the actual compositional tool — you
  would be composing a modulation rather than watching a walk.
- The seventh-chord Tonnetz: a four-dimensional lattice where voice leading
  stays parsimonious. Richer, and only slightly harder to draw.
- ~~Counterpoint as a constraint: a second chain whose intervals are defined
  against the first, not independently.~~ → `sketches/species`: every legal
  first-species counterpoint at once, counted exactly and drawn uniformly, so
  you compose by elimination. Verified against a brute-force enumerator (21 of
  21 counts, marginals to 0.00e+0) and the draw is uniform (chi-square 21.9 on
  29 df). The singable-line rule is worth more than the other four together —
  144 counterpoints with it, 10,885 without. See
  `research/log/2026-08-17-species.md`.
- Second species for `species` — two notes against one, which needs passing
  tones and a (note, beat) state. The dynamic program handles it; the rules
  triple.
- Draw the cantus firmus by hand instead of taking what the seed gives.
  Everything downstream in `species` already re-derives.
- Weight `species`'s draw by something other than uniform — prefer contrary
  motion, or a target contour. One multiplication inside the DP.
- Say *why* a square is dead in `species`: name the rule that kills it, and the
  tool starts teaching rather than just enforcing.
- ~~`species` for a canon, where the second voice is the first one delayed.~~
  → `sketches/canon`: the state has to widen to the last d+1 notes, because a
  note is sung once as melody and again as harmony d notes later. Exact against
  brute force (8 configurations, marginals 0.0e+0; chi-square 220.0 on 234 df).
  Self-imitation costs ×2,003 to ×15,790, and at the fifth every simultaneity
  costs 2.012 — one bit, which is exactly the six of twelve semitone classes
  that are consonant. See `research/log/2026-09-06-canon.md`.
- **A clean law is a claim about the conditions it was measured under.**
  `canon`'s one-bit-per-simultaneity fit holds to 10.6% over 24 configurations
  and two axes — and then misses by 74.7% at a different interval of imitation,
  because there the harmonic and melodic constraints stop being independent.
  The 24 configurations felt like enough generality. They were 24 samples of one
  imitation.
- The interval of imitation, counted: the third below leaves the most room
  (247M at length 14), the octave and unison next, the textbook's fifth only
  fourth at 120M. Whatever recommends the fifth, it is not permissiveness — and
  no first-order harmonic statistic predicts the ordering (best r = 0.84, with
  70% errors), because consecutive simultaneities share notes.
- Free two-part counterpoint under `canon`'s exact rules, so the ×9,090 splits
  into what a second voice costs and what *self*-imitation costs. The current
  comparison is against no second voice at all.
- Canon by inversion for `canon` — one line in the spec. Augmentation does not
  fit the same machine: the follower would be at i/2, not a fixed lag.
- Colour `canon`'s cells by how much fixing one would collapse the space, so the
  tool shows which decisions are expensive before you make them.
- ~~Let a node reference a non-predecessor — the chain becomes a graph and
  motifs recur by reference rather than by copy.~~ → `sketches/rhyme`: a score
  with no copies at all. Every repeat is a rhyme — "this span is that span,
  transposed / inverted / backwards" — which in scale degrees is affine with
  two ±1 coefficients, so the score is a signed graph and the notes you
  actually chose are its unpinned components. Signed union-find agrees with row
  reduction over the rationals 50 of 50, 980 of 980 constraint rows hold in the
  realised score, 66 refusals all independently confirmed justified, and every
  rhyme holds in the recording. See `research/log/2026-08-27-rhyme.md`.
- ~~Rhymes over *rhythm*: durations as ratios are affine in log time, so
  augmentation and diminution drop straight into `rhyme`'s solver — and that is
  also the rhythm half `develop` is missing.~~
  → `sketches/elastic`: it is not the same problem, because a rhythm has a
  constraint pitch has no analogue of — the durations must *add up*. Ratios fix
  each component up to a scale; the bars are then a V × C linear system in
  those scales. Exact to 4.4e−16 over 300 problems, and 0.49% read back off the
  audio. See `research/log/2026-09-11-elastic.md`.
- **You may state how two voices relate, or state both their bars — not both.**
  Linking two voices drops the component count while the number of bar
  constraints stays put, so the system is over-determined and exactly one ratio
  has a solution: accepted 200/200 at that value, refused 200/200 at 0.01%
  away. It is why a polyrhythm is *named* by its ratio rather than assembled
  from two independent parts, and it has no counterpart in `rhyme` because
  pitch has no bar.
- Solve for a *bar* instead of a scale in `elastic`. If you want to state the
  voices' ratio, one of the bars has to give; it is the same system read the
  other way and probably the more musical direction.
- Cross-voice ratios between notes other than the firsts — the forced value
  depends which pair you pick, so choosing the pair is choosing which
  relationship to make explicit. Draw all of them at once.
- ~~Notation cost for `elastic`: realised durations are reals and notation wants
  small denominators. How complex a tuplet does a ratio set need, and which
  sets cannot be written at all?~~ → `sketches/tuplet`: notation is a
  number-theoretic constraint. Everything writable is 2^(−k)·Π(m/n), so **a
  duration is writable exactly when its denominator is N-smooth** for the
  largest tuplet N you allow — checked against the definition of smoothness for
  N = 3, 5, 7, 11, the same set every time. The nesting depth is the shortest
  factorisation of the odd part. See `research/log/2026-09-16-tuplet.md`.
- **One tuplet level is worth more than three halvings of the note value.**
  Halving the shortest note halves the error; one more tuplet divides it by
  seven. At a two-second bar, five notes written with no tuplets at eighth-notes
  land **108.7 ms** from what was meant — a different rhythm, not a nuance —
  against 16.1 ms with one tuplet and 2.3 ms with two.
- **Notating is not rounding, because the bar has to close.** Round each note to
  the nearest writable value on its own and the bar came out wrong in 161 of 400
  random rhythms. That is `elastic`'s add-up constraint arriving from the other
  side, and it is why somebody always absorbs the remainder.
- **What separates rhythms is exactness, not accuracy.** Durations from simple
  ratios are written exactly 105 times in 400; from uniform reals or powers of
  φ, 0 of 400. But the inexact ones are all *equally* inexact (0.043% / 0.056% /
  0.052%). I expected φ to be the most expensive to write, being the hardest
  number to approximate, and it is not: a tuplet budget gives you a sparse
  scatter of large smooth numbers rather than all denominators up to a bound, so
  the continued-fraction structure of the target stops mattering.
- Point `tuplet` at `elastic` directly: one produces real durations from stated
  ratios, the other says what they cost to write. Together they answer "can I
  notate what I just composed", and neither half knows about the other yet.
- Notate a whole piece rather than one bar. A denominator chosen per bar is
  cheaper than one chosen for the movement, but changing it every bar is
  unreadable — that trade is the real problem a copyist solves.
- Which note absorbs the rounding remainder is currently "whoever was rounded
  furthest". A copyist puts it where it is least audible: on the longest note,
  or off the downbeat. Worth measuring rather than asserting.
- Nested tuplets are not equally readable — 5-in-4 inside 7-in-4 is legal and
  nobody can play it. A readability cost that is not just depth would change
  every number in `tuplet`, and the honest version needs players.
- Where does `tuplet`'s smoothness penalty go asymptotically? It grows 1.17× at
  denominator 12 to 3.87× at 192, and smooth numbers have a known density
  (Dickman's function), so this is predictable rather than merely measurable.
- Say *which* ratio to relax when `elastic` refuses. One more linear solve, and
  it turns a refusal into a suggestion the way `species` does.
- Draw the rhyme by hand in `rhyme`: select two spans, pick a transform, watch
  the free-note count fall. Everything downstream already re-derives.
- A rhyme with a *tolerance* — "roughly that span, up a third" — turning the
  exact solve into least squares, which is much closer to how music rhymes.
- `species`'s rules as extra rows in `rhyme`'s system: counterpoint and form
  solved together is the next altitude up from either.
- ~~Export only the free notes as the score. Hand someone eighteen notes and a
  rhyme list and they have the whole piece — the compression claim made real.~~
  → `sketches/shorthand`, which also does the *finding*: given the notes, look
  for the shortest description. That is Lempel–Ziv with a composer's vocabulary
  (a back-reference may be transposed, inverted or reversed), and because the
  parse runs left to right each token's position is implicit — so the optimum is
  a shortest path over note positions, a **dynamic program rather than a
  search**. Exact against an exhaustive search 95 of 95, gap 0.0e+0 bits, and
  lossless 180 of 180. At the defaults 13 notes of 64 are written out and the
  other 51 follow; `Play: skeleton` sounds at exactly those 13 and at **exactly
  0.00000** elsewhere. See `research/log/2026-09-21-shorthand.md`.
- **A transform is worth exactly what the tune contains.** Allowing inversion
  and retrograde saves 14.5% on tunes built with them, 0.9% on tunes built with
  transposition alone, and **0.2% on uniform noise** — and the discrimination is
  specific, since on tunes containing inversions allowing *inversion* gives
  3.183 bits/note where allowing retrograde instead gives 3.450. A detector that
  found structure everywhere would not be one.
- **A transform's value for reaching a target is not its value for describing
  one.** `develop` found invert (+0.25) and retrograde (+0.23) mattered least of
  its operations, because involutions open almost no new space; I predicted the
  same here and they are worth 9.3%+. Both are right: a transform that opens no
  new territory can still be the cheapest way to say where you already are.
- **A short rhyme is not a fact about a tune.** `shorthand` recovers planted
  rhymes of 3 and 4 notes **0%** of the time and ones of 10+ at 43–69%, because
  it finds a *cheaper* description than the planted one in 199 of 200 tunes.
  Recovery pooled to 33% and looked like a failure; split by length it is the
  finding.
- **A tolerance is not a bound on the error, because approximations chain.** At
  tolerance 1 `shorthand` cuts the description 33% for a mean error of 0.61
  degrees — but the worst is **4**, and 454 notes in 4,800 end up outside the
  tolerance, because a loosely fitted span becomes the source for the next one
  and the chains run 5 deep. That is the hazard waiting for the least-squares
  `rhyme` below.
- Bound the *realised* error in `shorthand` rather than the per-step one: a
  token's tolerance should shrink with its source's depth. One line in `fit`,
  and it turns that hazard into a guarantee.
- Entropy-code `shorthand`'s tokens. Every cost there is a flat log2, an upper
  bound; a real code would price a short back-reference far below a long one and
  might change which parse wins.
- Let `shorthand` reference *forward* as well as back. Music does — a theme is
  often stated after the material that explains it — and it turns the shortest
  path into a genuinely harder problem.
- Point `shorthand` at real tunes. Everything measured there is against
  structure I planted, which is the right way to test a tool and the wrong way
  to learn anything about music.
- **When two independent methods give the same wrong answer, the bug is
  upstream of both.** Two unrelated pitch detectors scored 80.0/85.0/65.0 to
  one decimal in `rhyme`; the fault was the candidate list, not either
  detector. Three of the last four days went on improving a detector that was
  not the problem.
- Rhythm stored as duration *ratios* the same way pitch is stored as
  intervals: swing and augmentation become single knobs.
- A DAW arrangement view where clips have gravity and snap into phrases.
- ~~Score that renders as a diagram of tension rather than notation.~~
  → `sketches/arc`: draw a tension curve, hear it realised; output tracks
  the curve at r = 0.75-0.85 measured from audio. See
  `research/log/2026-08-05-arc.md`.
- Interpolate between chord-ladder rungs so a drawn curve is realised
  continuously rather than in eight discrete jumps.
- A second curve for volatility — how tense, and how fast it changes.
- Export realised notes as MIDI, so a sketch hands off to a real score.

## Jam / performance (sparked by building jam mode)

- Per-channel input routing: focus a strip to own the QWERTY keys and MIDI.
- Stem recording: one aligned WAV per channel, not just the master.
- Global key/scale broadcast sketches can opt into — change key mid-jam.
- Scene morph: glide numeric params to the target over a bar instead of jumping.
- Crossfader assignable to any two channels.

## Wild

- ~~Feedback as an instrument rather than an accident.~~ → `sketches/larsen`:
  a delay-and-filter loop can only sing where it returns in phase, so the pitch
  is quantised to a comb, one tooth per integer n. Put the sounding frequency
  back through f·D/sr − ∠H(f)/2π and it comes out an integer to **0.0002**
  across ten delays, mode index right 10/10, worst frequency error 0.01 Hz.
  Sweeping the delay the pitch falls ~50 Hz within a tooth then snaps back, 11
  of 11 steps matching. And it starts howling at 1/|H(f_n)| rather than 1, a
  threshold that scallops between 1.002 and 1.216. See
  `research/log/2026-09-03-larsen.md`.
- **A quantity that must be an integer is the best thing to measure**, because a
  broken detector cannot be subtly wrong about it — the residuals scatter across
  the whole interval instead of looking plausible. `larsen` was the easiest
  verification in weeks for exactly that reason.
- Fractional delay for `larsen` (allpass interpolation), so the pitch glides
  within a tooth instead of stepping; the phase condition already covers it.
- Cross-coupled loops rather than parallel ones: the modes are not the union of
  the two combs, and predicting them is an eigenvalue problem.
- A real room impulse response in `larsen`'s loop instead of one bandpass —
  Lucier's *I Am Sitting in a Room* with the loop closed, where the winning mode
  is a genuine measurement of the room.
- Play `larsen`'s threshold rather than its delay: a hair under 1/|H| gives a
  loop that rings for seconds and dies, with a decay time the arithmetic
  predicts.
- ~~A real room impulse response in `larsen`'s loop instead of one bandpass —
  Lucier's *I Am Sitting in a Room* with the loop closed.~~ Built open instead:
  → `sketches/sitting`, where each generation is the last one convolved with
  the room and truncated to the same length a tape would give. The process is
  the multiplication to **0.18-0.28 dB** from generation 4 on, it ends at
  203.9 Hz where the room's measured |H| peaks at 203.9 Hz, and what survives
  narrows as N^(-0.54) against a predicted -1/2. See
  `research/log/2026-09-08-sitting.md`.
- **A recording of length T cannot hold a line narrower than 1/T**, which is a
  limit on Lucier's process and not just on the analysis of it: with room modes
  narrower than that the narrowing saturates within a few generations and the
  rest of the piece does nothing. One good reason his recordings are long.
- Longer recordings for `sitting`: at 2.6 s the floor is 0.4 Hz; at 15 s it is
  0.07 Hz and the N^(-1/2) law has two more decades to run in.
- A real measured impulse response in `sitting`, so the surviving pitch is a
  measurement of an actual room. The machinery takes any buffer.
- Play the *difference* between consecutive generations — what the room took
  away rather than what it kept. Same data, nobody listens to it.
- The second mode in `sitting`: |H2/H1|^N says exactly when it should vanish,
  and the piece's best stretch is while two are still audible.
- ~~An instrument that is silent until you take something away.~~
  → `sketches/hollow`: N oscillators at one frequency with phases spread evenly
  sum to exactly zero, so you play it by *muting* and the note you hear is the
  one you did not play. The loudness of a silenced run of m is a Dirichlet
  kernel |sin(πm/N)/sin(π/N)| — measured off the audio to **0.0008** — so
  muting more can make it quieter, and on an even bank an opposite pair is
  silent. See `research/log/2026-09-12-hollow.md`.
- **Two kinds of nothing measure differently.** A cancelling bank reads
  −150.1 dB, which is the audio graph's own arithmetic floor; the same bank
  switched off reads exactly 0.00e+0. They sound identical and are not the same
  thing. Worth knowing before reading any "silent" result.
- Every *subset* of a `hollow` bank is a chord with a computable loudness,
  |Σ e^(2πik/N)| over the subset — 2^N of them, most not runs, and the silent
  ones form a subgroup.
- Phases that are not evenly spaced in `hollow`. Any set summing to zero works,
  and non-uniform ones make some voices worth more than others, which is a
  better instrument.
- The fragility as the instrument: a slow random walk on one voice's tuning so
  the bank never quite manages to disappear. Four cents — a twenty-fifth of a
  semitone — already makes it breathe every 2.5 s.
- What sets `hollow`'s −150 dB floor? If it is float32 in the summing bus it
  should move with voice count and amplitude, and both are testable.
- ~~Nothing here is binaural: an illusion where the two ears receive different
  things and the percept is neither.~~ → `sketches/dichotic`, Deutsch's scale
  illusion (1975). Unlike every other illusion in this file the fact is not in
  the wire — it is central — so what gets measured instead is the
  combinatorics: regrouping two notes into two streams is a two-state
  assignment with an exact optimum. Alternating which ear gets which line makes
  each ear **13.45× more jagged while leaving the music exactly where it was**,
  and the per-stream figure is identical to the composed lines' own. See
  `research/log/2026-09-22-dichotic.md`.
- **The classic demo is not "the listener reassembles the score".** Deutsch's
  two scales meet in the middle, so they *cross*, and a proximity listener gets
  the bouncing contour (8 7 6 5 4 5 6 7) rather than either scale — recovery
  0.5625. The listener assembles something nobody wrote, which is a stronger
  claim than the one usually made for it.
- **How fast two lines converge decides whether they are heard to cross or
  bounce.** By-height grouping can never hear a crossing (0.0% passed through at
  every rate). Minimum-motion grouping passes through **39.6%** of slow
  crossings and **7.7%** of fast ones, because slowly converging lines linger
  near each other and passing costs no motion, while a fast sweep would need a
  leap. A compositional handle, not a fact about the notes.
- Onset synchrony as the competing cue in `dichotic`: the notes start together
  by construction, and staggering them should re-form the streams by *time*
  rather than by pitch.
- Deutsch's octave illusion — one tone, two octaves, a different percept in each
  ear. `dichotic`'s scatter code already does everything except the octave.
- Sweep an ear imbalance in `dichotic` until the grouping breaks. Where the
  threshold sits is exactly the sort of number the sketch is built to report.
- Point `shorthand` at `dichotic`'s ear sequences: the composed lines should
  compress and the scattered ears should not, which is the same claim in bits.
- Music software with no undo — everything is a performance.
- ~~A melody hidden under a band of noise — present in the signal, absent in
  the ear.~~ → `sketches/veil`: simultaneous masking as an instrument. Measured
  the two modes as mirror images (level sd 0.4 dB vs 9.4 dB), and the
  constant-loudness amplitudes trace the masking curve. Whether you *hear* it
  is unmeasured and is the open question. See
  `research/log/2026-08-12-veil.md`.
- ~~A melody that is not in the signal at all — carried by distortion products
  the ear itself manufactures.~~ → `sketches/tartini`: two sine carriers whose
  difference tone traces the tune. Measured at −84 to −191 dB in the wire and
  −39 dB after a nonlinearity; splitting the primaries between the ears
  collapses it by 38 dB. The audible carrier moves opposite to the phantom,
  9 changes out of 9. See `research/log/2026-08-18-tartini.md`.
- ~~Two phantoms at once in `tartini`: the quadratic and cubic products move in
  opposite directions, so one pair of carriers could carry two melodies.~~
  → `sketches/contrary`: A = f2 − f1 and B = 2f1 − f2 invert exactly, f1 = A + B
  and f2 = 2A + B, round-tripped to **0.00e+0 Hz** over 20,000 pairs. Each tune
  comes from its own term — quadratic only gives A and leaves B at the floor,
  cubic only the reverse — in the model and again off a recording. In the wire
  the melodies sit at −164 to −211 dB; bending the recording brings them up by
  **120.4 dB**. See `research/log/2026-09-17-contrary.md`.
- **The obstacle was the instrument.** The two phantoms cannot move the same way
  (∂A/∂f2 = +1 against ∂B/∂f2 = −1), so hold A + B fixed — strict contrary
  motion — and f1 = A + B **never moves**: 0.0 Hz over 40 notes, against 114.8
  for f2, with corr(A,B) = −1.000 and corr(f1,A) = 0.000. One audible tone that
  stands completely still, and two tunes going opposite ways that nothing plays.
- **A phantom melody only hides if its partner mirrors it.** The ear needs
  f2/f1 ≈ 1.2, which forces B ≫ A, which makes f1 = A + B mostly B — two
  *independent* melodies put one of them straight into the audible signal
  (corr 0.962). Mirrored ones hide both and nothing else does.
- A third phantom: 3f1 − 2f2 is the next cubic product, so three tunes from two
  tones — with A, B and C forced to satisfy one linear relation, which is a
  compositional constraint nobody has ever had to write under.
- Let `contrary`'s mirror axis glide, so f1 drifts while the two tunes keep
  their contrary motion about a moving centre. One line, and a real form.
- Primary level changes the *balance* of the two melodies, because the cubic
  difference tone grows faster with level than the quadratic one. Not exposed in
  `contrary` and it is a whole compositional dimension.
- `tartini` and `contrary` both need a carrier pair in a narrow ratio band. For a
  given melody range, which sums are playable at all? The answer is a wedge in
  (A, B) that would serve both and has never been drawn.
- Sweep `tartini`'s carrier while holding the phantom fixed — the tune stands
  still while everything audible slides.
- **A reveal control belongs on every absence claim.** `tartini`'s turned
  "I measured nothing" into "and here is the same measurement finding
  something". `veil` should have one.
- ~~A rhythm that speeds up forever and never arrives — Risset's rhythmic
  Shepard tone.~~ → `sketches/staircase`: layers sliding up four octaves of
  tempo under an amplitude bell, so the wrap happens in silence (2.9% of peak
  energy there, against 122% with `Seam` at 1). Stacked per-band correlation
  0.960 at exactly the cycle and −0.18 at L/4. See
  `research/log/2026-08-23-staircase.md`.
- **The rhythm recurs N times as often as the sound does.** `staircase`'s mix
  envelope repeats every L/N because it cannot hear pitch; only the per-band
  stack distinguishes a true repeat. Probably a large part of why the illusion
  works, and worth testing directly.
- Shepard pitch *and* Risset rhythm at once — everything rising, nothing
  arriving. Band separation gets much harder, which is why it is worth doing.
- A descending staircase: the literature says falling Shepard tones are less
  convincing, and the same harness could test it.
- Hide `staircase`'s wrap with masking rather than an amplitude bell, and see
  whether the illusion survives at seam 1.
- An envelope-detector box must be at least one *carrier* period long. A flat
  4 ms box is fine at 370 Hz and useless at 92 Hz. Cost `continuum` and
  `staircase` a run each.
- Numbers in the notes must come from the build being committed. `staircase`
  nearly shipped a 90/90 match rate measured two gain changes earlier; the real
  figure was 45/90.
- ~~A piece that is its own reverse, so playing it backwards should change
  nothing.~~ → `sketches/crab`: a canon against its own retrograde, score
  palindromic 50 of 50. The question it answers is which cue gives time its
  direction: the note's envelope costs 0.4728 of mirror correlation and the
  room only 0.3105, against a method spread of 0.0005. Not what I expected —
  but the room does nothing until mix 0.35 and then collapses, while the
  envelope degrades from the first nudge, which is probably why backwards
  reverb is the cue everyone can name. See `research/log/2026-08-29-crab.md`.
- Contour as the third arrow of time: a rising line reversed is a falling one,
  and that may beat both envelope and room. Needs a line that is *not* its own
  retrograde, which `crab` cannot currently make.
- Split `crab`'s `Bite` into attack asymmetry and decay asymmetry — they move
  together now and there is no reason they should weigh the same.
- A table canon: line, retrograde, inversion and retrograde-inversion at once.
  That is the Bach puzzle canon and it is one more voice in `crab`.
- **Print a measurement's repeatability above the comparison it licenses.**
  `crab`'s first run said the room beat the envelope by 0.046 with ±0.05 of
  noise — a wrong answer that agreed with the folk intuition, which is the
  hardest kind to catch. Three repeats took two minutes and settled it.
- **But a bit-identical repeat is not a repeatability estimate.** `wolf`'s
  shipping configuration reproduced every digit across two runs, which proves
  there is no run-to-run noise and bounds nothing at all about bias: a
  deterministic model measured by a deterministic analysis will reproduce a
  wrong answer forever. The handle on bias is a channel with a known answer, not
  a repeat.
- **A silent sketch in the smoke suite may be the machine, not the sketch.**
  Four unrelated sketches read exactly 0 in one run; `origin/main` passed 35/35
  and the same branch passed 36/36 once six orphaned `vite` servers and a killed
  run's chromium tree were cleaned up. Under load the audio thread underruns and
  silence looks identical to a regression. The harness scripts are the cause —
  `srv.kill()` reaps the `npx` shell and leaves its `vite` child running — so
  either spawn vite directly or kill the process group.
- **Size the window from the thing being measured, not from habit.** `wolf`
  analysed 2 s of a note that is gone in 0.5 s — and the short decay *was* the
  phenomenon, so the default window measured everything except the subject.
  `arc` was the same mistake with the sign flipped: 2.4 s of a 20.9 s form, and
  it hid a 1.478 peak for three weeks.
- **Do not "fix" a detector from the inside when the evidence is ambiguous.**
  `inertia`'s octave errors looked like a YIN problem, so I made YIN prefer
  longer periods on near-equal evidence — but a signal periodic at T is also
  periodic at 2T and 3T, so the rule fired on healthy frames and read a steady
  pitch as 19.02 semitones flat, exactly a factor of three. Catching it
  downstream on continuity works, because a 12-semitone jump between adjacent
  frames is impossible when the fastest real motion is 0.33 per hop. A guard
  that can only fire on impossible evidence cannot corrupt the good case.
- **A null is not a decay.** Two modes of similar height beat, so their envelope
  hits zero every half beat period. A first-crossing t60 estimator finds the
  first null and reports it as the decay — in `wolf` that was 0.30 s where the
  answer was 0.64 s, wrong by 2x, and worst at exactly the note under study.
  Read the *last* crossing. The general shape: any estimator that takes the
  first time a signal crosses a threshold is measuring fluctuation, not trend.
- **A lesson filed under the sketch it happened to is not where you look.**
  `hollow`'s beat detector autocorrelated an envelope and took the largest peak,
  returning 0.270 Hz for a 1.621 Hz beat — six times too slow, because a
  periodic signal correlates as well at multiples of its period. That exact
  warning has been in this file since `bow`, where it happened twice in one day.
  Take the *first* peak that is nearly as good as the best, never the best.
- **One point is not enough to catch a period-multiple error.** `hollow`'s
  detune sweep was right at 4 and 8 cents and 83% wrong at 16, because the
  ambiguity only appears once the capture holds several cycles. A single
  detune would have read as a clean confirmation.
- **The obvious way to write down a relational rhythm is unplayable.** Stating
  each note against its predecessor is how anyone would naturally chain ratios,
  and four links from a pool containing 3 and 1/3 puts 81:1 between two notes of
  one bar — one note takes almost all of it, the rest are milliseconds. The
  solver realises that perfectly; it is a bug in what it was asked for. Stating
  every note against the *first* note of its voice bounds every duration by the
  pool's own range, and is what a composer would say out loud anyway.
- **A floored denominator invents a discrepancy.** `elastic`'s onset check first
  read "55 onsets, about 50 expected" — a 10% error that was entirely
  `Math.floor(26 / 2.4)`. Rewritten as notes per bar, the quantity that has to
  be an integer, it reads 5.066 against 5. Inventing a gap and then hunting for
  it in the thing being measured is an expensive way to spend an afternoon.
- **An OfflineAudioContext finishes rendering before a postMessage is
  delivered.** `rosin`'s first sweep configured each cell by posting to the
  worklet and ran all 176 of them at the constructor defaults. The symptom was a
  grid of identical numbers — the third time in four days that tell has caught
  something. Sweep by AudioParam, and get analysis data out on a spare output
  channel rather than through the port.
- **Two copies of one algorithm are not one algorithm.** A worklet cannot
  import, so a measured diagram needs a main-thread port of the same model.
  `rosin`'s two copies disagreed on 3 of 7 configurations — whole different
  attractors, not rounding — for two reasons nobody lists as part of a model:
  the port used `Float64Array` where a worklet's delay lines are `Float32Array`,
  and it ramped a parameter per sample where an AudioParam is a staircase that
  moves only at 128-sample block boundaries. Matching both made them agree to
  every printed digit. In a sensitive system the numeric type and the parameter
  update rate *are* the model.
- **Check what a simulation needs to settle before deciding what it shows.**
  `rosin`'s canvas simulated 0.7 s per cell where the string takes ~600 periods
  to settle at its shipped losses; at that length not one cell of the grid reads
  as speaking, and the diagram would have been confidently, uniformly wrong.
- **A boundary of the swept range is not a result.** `rosin` finds nothing at
  β ≤ 0.028 and it looked like a minimum force rising toward the bridge — until
  the fitted law put those cells well inside the range. At β = 0.02 the
  bridge-side delay line is five samples: the simulation has run out of string.
- **A log-sum-exp computed as a sum of powers underflows, and the symptom is a
  plausible catastrophe rather than a NaN.** `lombard`'s quiet rooms reach
  −1400 dB within a couple of hundred rounds, every 10^(L/10) term becomes
  exactly 0, and the model reported a growth rate of −2,499,996 dB per round.
  Factor out the largest term before summing — which is also the form the
  theory is written in, so the numerically right edit and the conceptually
  right one were the same.
- **State that a control is *about* has to survive the control.** Changing any
  structural parameter in `lombard` re-ran its constructor and reset every
  level, which made the one gesture worth having — let a crowded room fill,
  then pull the players apart and hear it drain — impossible, because the drain
  always restarted from silence. It surfaced as a measurement returning zero
  usable bars.
- **Offer a third explanation only after testing the first two.** `lombard`'s
  heard growth rates ran a consistent 6% short of predicted. Transient bars in
  the fit: dropping them moved the slope 0.005, dead. The recording measuring
  the sum where the prediction follows the loudest: the model's own total power
  grows at the predicted rate, dead. The shortfall is real, small and
  unexplained, and saying so beats a third story I have not run.
- **Do not window an impulse response.** A Hann window is zero at t = 0, which
  is exactly where an impulse response keeps its energy, so transforming one
  through a general-purpose spectrum function deletes every short-ringing mode
  and leaves only the diffuse tail. In `sitting` that moved the room's apparent
  best frequency from 203.9 Hz to a 14 kHz noise spike three octaves above any
  mode in the room, and every conclusion downstream followed from it. An IR
  already decays to nothing; it needs no window, only a fade at the end.
- **Two bugs can produce the same symptom, and fixing the first one not moving
  the number is the signal.** `sitting` returned byte-identical results for
  three deliberately different rooms. The first cause was real — the harness
  handle snapshots the impulse response and has to be re-fetched after a
  change — and fixing it changed nothing, which is what said to keep looking.
- **A finite recording has spectral detail at the 1/T scale everywhere**, so
  the width of a raw spectral argmax is about one bin no matter what shaped it.
  `sitting`'s first width series read 0.68, 0.63, 0.65, 0.67 Hz across four
  generations — four numbers that were all the analysis floor. What a repeated
  filter shapes is the *envelope*; smooth well above 1/T and well below the
  feature, and report the fit at more than one kernel so the reader can see the
  kernel is not doing the work.
- **Check the dynamic range before believing an exponent.** Even with the
  windows fixed, `sitting`'s first configuration had a 2.7 Hz resonance against
  a 0.58 Hz floor — a factor of four to watch a power law in, most of it eaten
  by the smoothing kernel. The measured -0.28 was not "the law is wrong", it
  was "there is nothing here to measure". A law over one octave is not a
  measurement.
- **A tolerance that does not scale with the box is not a box-counting
  estimator.** `tongues` published 0.875 for the critical circle map from a
  fixed tolerance at every box size; in an unlocked region the winding number
  changes by about the box size, so a fixed tolerance means something different
  at each scale and on a fine grid calls everything locked — its control
  collapsed to 0.572 at 32,769 points. Scaled to the box it gives 0.8794,
  identical at tol = eps/4, /8 and /16. And since the controls themselves miss
  1.0 by 1.5-4%, the gap to the literature's 0.870 is inside the method's own
  bias: the first writeup explained a residual smaller than an error bar it had
  never established.
- **Identical values across different conditions mean you are measuring the
  instrument.** `tongues` reported four different Arnold tongues at three
  different couplings as all ≈4.0e−4 wide, which is exactly twice the detection
  tolerance — the width a tongue of *zero* width measures, because off a plateau
  the winding number passes through p/q with slope 1. A table where several
  cells agree to three figures across conditions that should separate them is
  the tell; the fix is to compute the method's floor, print it above the table,
  and refuse to fit anything near it.
- **A search that must first land inside the thing it is measuring cannot find
  the small ones.** `tongues`'s first tongue-finder scanned outward in steps of
  0.004 looking for a plateau, which misses every plateau narrower than that —
  i.e. all of them in the regime the law being tested lives in. Bisection on a
  monotone quantity needs no starting point inside, and was five orders of
  magnitude more precise as a side effect, because the edge is a saddle-node
  where precision in the measured quantity buys far more in the parameter.
- **When the events are on a known grid, do not detect them — ask about the
  grid.** A free-running onset detector read `tongues` 1.55x high, because a
  decay three pulses long makes overlapping tails look like attacks. The drive
  times are known from the audio clock, so the question is one binary decision
  per pulse rather than a search, and it went from 1.55x wrong to 274/274 exact.
  Same lesson as `canon`, in a different disguise: alignment beats detection
  whenever the schedule is already known.
- **A `select` param's value is not checked against the union it is drawn from.**
  `scale: 'minorPentatonic'` for `pentatonicMinor` passed `tsc` and threw inside
  the clock handler on every step. The options list comes from `SCALE_NAMES` but
  the value is a plain string, so nothing connects them.
- **Take the harness's randomness from `@core` too.** `canon`'s uniformity check
  failed at chi-square 1697 on 234 df and the sampler was the obvious suspect —
  it is the fiddliest code in the sketch. The sampler was correct. The harness
  used a throwaway LCG, `s = (s * 1103515245 + 12345) & 0x7fffffff`, whose
  multiply exceeds 2^53 in JavaScript and silently loses exactly the low bits an
  LCG's randomness lives in. Swapping in `rng` gave 220.0 with no other change.
  A bad instrument does not read as "no result", it reads as a finding.
- **When two guesses at an explanation both fail, change the question rather
  than guessing a third time.** Neither of `canon`'s proposed predictors for
  which imitation is roomiest correlated. What worked was asking which *rule*
  produced the spread — turn each off, watch it move — which took three cheap
  solves and narrowed it to one rule immediately. Predicting an effect and
  localising it are different questions, and localising is usually cheaper.
- **Write the notes field after the table, not before it.** `canon`'s prose was
  drafted from what I expected and four of its claims were false — the roomiest
  imitation, the narrowest, the order of magnitude, and a comparison to free
  counterpoint I never ran. Drafting first is a fine way to find out what you
  think; shipping it unchecked is how a sketch acquires a confident paragraph
  nobody revisits.
- **A normalisation can cancel the effect you are trying to measure.** `cone`
  scaled every bore mode to unit peak gain, so a mode spoiled to a
  sixty-seventh of its Q came back out at exactly the same height — the
  register vent did nothing, at any truncation, and the results table read
  1.00 all the way across. That looks like a physics finding and is an
  arithmetic identity. Normalise against a *fixed* reference, and before
  believing a null result, check that the control you are varying can still
  move the number at all.
- **Match the model's phase, not just its peaks.** A sum of two-pole
  resonators has the right magnitude response and the wrong phase: each pole
  lags 90° at its own centre, so the total is real *between* modes rather than
  on them. `cone`'s reed duly closed its loop in the gap and sang at 1.3–1.8×
  the first mode at every geometry. A bore's input impedance is real at a
  resonance, so the model has to be too — that needs a (1 − z⁻²) numerator,
  not more poles. Whenever a nonlinearity picks its own operating point from a
  linear block, phase is the part it is reading.
- **Normalising a resonator away can remove the loop gain that made it sing.**
  The fix above left `cone` silent, because unit-peak scaling had quietly been
  supplying the gain. Worth the trouble: peak input impedance is a real
  physical quantity, so it became a parameter with a measured threshold
  (tail RMS 9.6e-4 at 4, 2.8e-1 at 6) instead of an accident of scaling.
- Temporal masking: hide notes in the ~20 ms shadow after a drum hit. Same
  effect, different time base, no new model needed.
- The inverse of `veil`: play a melody and have the sketch synthesise the
  narrowest band of noise that would hide it — composing the mask, not the tune.
- Equal-loudness contours in `veil`, so its absolute floor is a real hearing
  threshold rather than a flat number.
- ~~An instrument you play by persuading it rather than by triggering it.~~
  → `sketches/earshot`: voices drift toward the average of whoever they can
  hear; hold a pitch and the crowd walks to you. The consensus knee is a
  *ratio* (earshot/spread ≈ 0.19), not a number of cents. See
  `research/log/2026-08-06-earshot.md`.
- Per-voice earshot — some of the crowd open-minded, some not. One line in
  `earshot`, and known to change the outcome qualitatively.
- Two crowds with different tolerances in one room, coupled only through the
  few voices wide enough to hear across the gap.
- ~~An instrument that gets slightly worse the longer you play it.~~
  → `sketches/patina`: per-pitch wear that detunes, dulls, softens and
  rattles; rested notes recover. Measured −16.4% brightness and −47% level
  on a worn note. See `research/log/2026-08-01-patina.md`.
- Break-in curve: light early use should make a note *better* before it
  starts to degrade — real instruments improve before they decline.
- Sympathetic wear: playing C3 tires C4 a little, as a shared mechanism does.
- Export a wear map as a score of what was played; load someone else's
  used instrument and inherit their habits.
- ~~Sequencer where the grid is a map and the playhead is a wanderer.~~
  → `sketches/watershed`: walkers are water on a self-eroding heightmap;
  pitch = elevation, basins fill until the melody escapes. See
  `research/log/2026-07-30-watershed.md`.
- Watershed follow-ons: stream confluence merging voices; a "rain" button
  dropping fresh walkers on peaks; moving carving channels deeper (erosion
  asymmetry); elevation → stereo pan.
