Read-EE — Oral Reading Diagnostic Tool

A browser-based screening tool for early-grade oral reading. A learner reads a passage aloud, the app transcribes it with the browser's built-in speech recognition, aligns the transcript against the reference passage word-by-word (Levenshtein alignment), and runs the resulting miscue pattern through a decision tree to name a likely reading-difficulty type — along with accuracy, reading rate (wcpm), and a color-coded running record.

How the diagnosis works:

1. Alignment — reference passage and recognized speech are tokenized into words and aligned with word-level Levenshtein (edit-distance) to find matches, substitutions, omissions, and insertions.

2. Sub-classification — each substitution is re-scored with character-level Levenshtein distance: orthographically-close words (e.g. "sleap" for "sleep") are labeled mispronunciations; otherwise substitutions. Extra words that echo a neighbor are labeled repetitions rather than plain insertions.

3. Decision tree — accuracy is banded as independent (≥97%), instructional (90–96%), or frustration (<90%), then cross-referenced with reading rate (words correct per minute) and the dominant miscue type to produce a specific difficulty type.
