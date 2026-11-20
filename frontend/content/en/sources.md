---
title: "Sources"
description: "The dictionaries and language data behind Nadeshiko's word cards and sentence analysis, and their licences."
---

# Sources

**Last updated: November 18, 2026**

Nadeshiko's word cards and sentence analysis are built on open language data. This page credits it.

## Dictionary

This site uses the [JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project), [JMnedict](https://www.edrdg.org/enamdict/enamdict_doc.html) and [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) dictionary files. These files are the property of the [Electronic Dictionary Research and Development Group](https://www.edrdg.org/), and are used in conformance with the Group's [licence](https://www.edrdg.org/edrdg/licence.html).

Dictionary data shown on this site, and any data derived from it that you export (for example to Anki), is available under the [Creative Commons Attribution-ShareAlike 4.0 licence](https://creativecommons.org/licenses/by-sa/4.0/).

## Sentence analysis

Sentences are split into words with [Sudachi](https://github.com/WorksApplications/Sudachi) and its dictionary, by Works Applications, under the Apache License 2.0.

Sudachi also reads a user dictionary of JMdict words and expressions (so あけましておめでとうございます or 気がついてる stay one word), built by [Jiten](https://jiten.moe) from JMdict, under the [Creative Commons Attribution-ShareAlike 4.0 licence](https://creativecommons.org/licenses/by-sa/4.0/).

When a sentence writes a verb in kana, the word it stands for after a given noun and particle (ピアノをひいた is 弾く, not 引く) comes from Nadeshiko's own subtitles and from the noun–verb collocation table of [Jiten](https://jiten.moe), under the [Creative Commons Attribution-ShareAlike 4.0 licence](https://creativecommons.org/licenses/by-sa/4.0/).

## Word cards

Nadeshiko's word cards use, besides JMdict and JMnedict:

- **Furigana:** [JmdictFurigana](https://github.com/Doublevil/JmdictFurigana) by Doublevil, under the [Creative Commons Attribution-ShareAlike 4.0 licence](https://creativecommons.org/licenses/by-sa/4.0/).
- **Pitch accent:** [UniDic](https://clrd.ninjal.ac.jp/unidic/) by the National Institute for Japanese Language and Linguistics (NINJAL), under the modified BSD licence. Where UniDic has none, mostly compounds: [Kanjium](https://github.com/mifunetoshiro/kanjium), under the Creative Commons Attribution-ShareAlike 4.0 licence. The pitch accent notation, verb particle data, phonetics, homonyms and other additions or modifications to EDICT, KANJIDIC or KRADFILE were provided by Uros O. through his free database.
- **Kanji:** readings, meanings, stroke counts and school grades from KANJIDIC2 (above). The parts each kanji is built from come from [KRADFILE](https://www.edrdg.org/krad/kradinf.html) by Michael Raine, James Breen and the EDRDG, under the [Creative Commons Attribution-ShareAlike 4.0 licence](https://creativecommons.org/licenses/by-sa/4.0/). Stroke order comes from [KanjiVG](https://kanjivg.tagaini.net), copyright Ulrich Apel, under the [Creative Commons Attribution-ShareAlike 3.0 licence](https://creativecommons.org/licenses/by-sa/3.0/). Radical names and meanings come from [Kanji alive](https://kanjialive.com), under the [Creative Commons Attribution 4.0 licence](https://creativecommons.org/licenses/by/4.0/). Kanji Kentei (漢検) levels come from [mimneko/kanji-data](https://github.com/mimneko/kanji-data), in the public domain (CC0), after the official 漢検漢字辞典. Kanji JLPT levels are Jonathan Waller's (below), as converted by [davidluzgouveia/kanji-data](https://github.com/davidluzgouveia/kanji-data) under the MIT licence. The words listed for each kanji, and the reading each one uses, are ranked by how often they appear in Nadeshiko's own subtitles.
- **JLPT levels:** Jonathan Waller's [JLPT Resources](http://www.tanos.co.uk/jlpt/), under the Creative Commons Attribution licence, as mapped to JMdict entries by [stephenmk/yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab) under the Creative Commons Attribution-ShareAlike 4.0 licence. There are no official JLPT vocabulary lists, so these levels are estimates.
