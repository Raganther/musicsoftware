# Ideas

Unfiltered. No idea is too small or too silly to write down. Move one into
`sketches/` the moment it gets interesting; strike it through when explored
and link to what came of it.

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
- Vuza canons — the rhythms that tile but whose entry set is *not* periodic.
  The search in `tiling` almost finds them; it needs to reject entry sets that
  are a union of cosets.
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
- Two voices at densities α and 1−α: between them they hit every step exactly
  once, which is a tiling canon with an irrational rhythm — something `tiling`
  cannot express.
- A Sturmian word is the cutting sequence of a line through a grid. Draw the
  line, drag it, and the slope is the only parameter there is.
- Let α drift slowly, so the rhythm passes through its own convergents in
  order — locking briefly at each and slipping between. A form nobody composes.
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
- **Ten seconds is still shorter than several forms here.** `arc`'s pass is
  20.9 s; `staircase`'s cycle is 24. A sketch whose loudest moment falls
  outside the window is still invisible to the gate. Either sample a full
  form per sketch, or compute the worst case instead of waiting for it.
- Guessing at a mechanism is not measuring it. I attributed a flaky smoke run
  to Chromium throttling the in-page meter; measured directly it ticks 49.9/s
  without the anti-throttling flags and 50.0 with. The sampling gap it
  replaced was real but cost 1.6% on average, not the ~50% I first published
  from comparing single runs of generative sketches.
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
- Strike the bar twice within one contact time and see what the interference
  does; a roll at 300 Hz is not thirty strikes, it is one continuous contact.
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
- A hysteretic friction model — a real stick/slip state machine with distinct
  static and dynamic coefficients. That is what would put Schelleng's wedge
  into `bow` rather than merely onto it.
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
- Real tone holes for `overblow`: a row of them with open/closed state, so the
  fingering system *is* the instrument.
- A true conical waveguide (the spherical spreading term at the apex). The
  cheap version — flipping the far-end reflection — does not oscillate at all,
  measured; a cone is not a sign flip.
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
- Consensus **with delay**. Real players hear each other late, and past some
  coupling strength a delayed consensus system oscillates rather than
  converging — which is the flutter a large ensemble gets in a live room.
  One parameter away in `entrain`.
- Let the listening graph change while it plays: musicians look up and look
  away, so λ₂ becomes a function of time and the rate should track it.
- Edge weights as a mix decision — how loud each player is *is* how much they
  are heard, which makes λ₂ something you perform rather than configure.
- **Repulsive coupling gives two camps, not an even spread.** Predicted a
  splay, measured clustering at half a beat: "avoid whoever you can hear" is
  satisfied by anti-phase, and an even ring requires knowing how many players
  there are, which no player does. Worth a rule that does know.
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
- **`noiseBuffer()` in `@core` should take a seed.** It uses unseeded
  `Math.random()`, so every reverb in this repo is a different room on every
  page load. Invisible until something measures through one: it moved
  `inertia`'s fundamental-to-octave ratio between 1.9 and 8.2 across runs whose
  worklet state was bit-identical, which read as an intermittent +12 semitone
  tracking error and cost most of a day.
- **Physics measurements do not belong on the master bus.** Level checks do —
  that is where the ear is — but anything measuring what a sketch *is* doing
  should tap the sketch's own node, before the room.
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
- ~~Let a node reference a non-predecessor — the chain becomes a graph and
  motifs recur by reference rather than by copy.~~ → `sketches/rhyme`: a score
  with no copies at all. Every repeat is a rhyme — "this span is that span,
  transposed / inverted / backwards" — which in scale degrees is affine with
  two ±1 coefficients, so the score is a signed graph and the notes you
  actually chose are its unpinned components. Signed union-find agrees with row
  reduction over the rationals 50 of 50, 980 of 980 constraint rows hold in the
  realised score, 66 refusals all independently confirmed justified, and every
  rhyme holds in the recording. See `research/log/2026-08-27-rhyme.md`.
- Rhymes over *rhythm*: durations as ratios are affine in log time, so
  augmentation and diminution drop straight into `rhyme`'s solver — and that is
  also the rhythm half `develop` is missing.
- Draw the rhyme by hand in `rhyme`: select two spans, pick a transform, watch
  the free-note count fall. Everything downstream already re-derives.
- A rhyme with a *tolerance* — "roughly that span, up a third" — turning the
  exact solve into least squares, which is much closer to how music rhymes.
- `species`'s rules as extra rows in `rhyme`'s system: counterpoint and form
  solved together is the next altitude up from either.
- Export only the free notes as the score. Hand someone eighteen notes and a
  rhyme list and they have the whole piece — the compression claim made real.
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
- Two phantoms at once in `tartini`: the quadratic and cubic products move in
  opposite directions, so one pair of carriers could carry two melodies.
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
