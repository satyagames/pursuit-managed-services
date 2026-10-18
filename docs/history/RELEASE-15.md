# Release 15: alignment, the motion system and the Animations switch

Branch `pms-15`, from `pms-14` at `6aaa87e`. Not pushed.

## Part 1: alignment

The review is [ALIGNMENT-REVIEW.md](ALIGNMENT-REVIEW.md): 962 pictures at the seven sizes of `devices.spec.ts` (and the 125% laptop), measured in one pass
each and looked at. Two findings fixed, each test first (`scripts/migration-tests/alignment.spec.ts`, shown failing on the pms-14 pages):

- **A-01** (participant): the words of a picked answer moved 10.7 px sideways and no longer lined up with the others. Now 0 px.
- **A-02** (admin, Results): the "Live results" summary's focus ring was cut by 8 px. Now 0 px.

Three Lows are left, with their reasons (A-03 to A-05). The participant page's CSS is the same size; the admin page's grows by 97 B.
