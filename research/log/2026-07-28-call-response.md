# 2026-07-28 — the machine as a listener

**Sketches touched:** `sketches/call-response`
**Seeds worth keeping:** seed 5, mode `invert`, gap 1.0 — the default, and the
best of the ones tried.

## What I tried

`interaction-models.md` claimed the most under-explored cell in this repo was
"the machine as a listener" — every existing sketch either executes what you
programmed or generates from its own state, and none of them respond to what
you actually play. This is the first attempt at closing that.

The design is deliberately the simplest thing that could count as listening:
capture the notes you play into a buffer, watch for a gap, then answer with
that buffer transformed. Four transformations — echo, invert, retrograde, and
a probabilistic "develop". Two timbres so you can always tell who is playing.

## What it actually sounded like

**Echo** is uncanny for about ten seconds and then dead. Hearing your own
phrase returned exactly is startling once; after that it has nothing to add
and you stop leaving gaps for it.

**Invert** is the one that sounds like a musician. An inverted answer is
audibly *related* to what you played without being a copy — which is what a
call-and-response partner actually does. This was the clear winner and it
wasn't close.

**Retrograde** does not work by ear. On paper it's an obvious relationship; in
sound it's just a different phrase. Reversing pitch order over the original
rhythm (rather than a true time-reversal) helps a little, but the relationship
is still invisible. Worth knowing — it's a standard compositional device that
apparently needs the eye, or much more repetition, to land.

**Develop** is the most musically interesting and the least predictable. The
fragment behaviour — answering with only the tail of your phrase — is the
single best thing in the sketch. A fragment reads as a *reply*; a full-length
answer reads as a parrot.

## What surprised me

**The gap threshold is the whole instrument.** Below about half a beat it
steps on you and feels deaf. Past ~2 beats the connection to what you played
has evaporated and it may as well be a generative sketch. The window where it
feels like listening is narrow, roughly 0.75-1.5 beats. I expected the
transformation to be the important parameter and it isn't — timing of the
response matters far more than the content of it.

**Yielding matters more than answering.** "Yield when I play" cuts its
response short the moment you touch a key. Without it, two voices talk over
each other and it immediately stops being a conversation. With it, you can
interrupt it — and that one affordance does more to make it feel attentive
than any of the transformations. Being interruptible reads as listening.

**A visual bug taught me something about the idea.** The first version cleared
the phrase buffer when it answered, which also wiped your call from the
timeline at exactly the moment the reply appeared. Seeing them side by side is
most of what makes the relationship legible — separating the display history
from the capture buffer changed how well the sketch communicates far more than
it changed the code.

## Next

- [ ] Answer the *contour*, not the notes: detect whether the phrase rose or
      fell and reply with the opposite shape. Probably closer to what a human
      partner does than any interval transformation.
- [ ] Match density. Four fast notes should not get four slow ones back.
- [ ] Let it decline to answer. Right now it always replies, which makes it
      needy. A partner that sometimes just lets your phrase stand would feel
      much more considered.
- [ ] Harmonise instead of answering — play *under* a sustained note rather
      than after it. That's a different dynamic again (accompanist vs.
      interlocutor) and probably worth its own sketch.
