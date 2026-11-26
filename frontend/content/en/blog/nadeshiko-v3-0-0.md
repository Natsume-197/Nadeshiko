---
title: "v3.0.0 - Audiobooks, our own dictionary, and a lot more"
description: "Audiobooks, a new dictionary experience, better search results, AniList and MyAnimeList, a new Requests page and Patreon integration."
date: 2026-11-26T00:00:00Z
---

# Nadeshiko v3.0.0 - Audiobooks, our own dictionary, and a lot more

This update brings improvements to nearly every part of Nadeshiko, making it easier to find sentences, explore Japanese, and get more out of the content you love. We've also added some entirely new features that we're excited for you to try.

There's quite a lot to share, so let's take a look at what's new!

## Audiobooks Support!

Nadeshiko now supports audiobooks! Discover Japanese vocabulary from novels, with sentences read in the narrator's voice and translated into English and Spanish. Search, listen, and export to Anki just like you already do.

We only feature a random selection of sentences from each book, so you can discover new vocabulary without experiencing the entire story. If you enjoy what you hear, we encourage you to get the book and support its author!

## Better search results

This is probably the change you'll notice the most, even if you don't realise it.

Previously, when searching for a word like レム, most results would come from the same anime, such as Re:Zero, making it harder to discover examples from other shows. Now, Nadeshiko shows a wider variety of results by prioritizing sentences from different titles instead of filling the page with just one. This means you'll see more diverse examples of how a word is used across different anime, shows, and other content.

We've also improved how repeated sentences are handled. Lines from anime openings, endings, and episode previews used to appear over and over across episodes. Now, these repeated lines only show up once, while common everyday expressions like はい remain unaffected.

## More Ways to Search

- **Sort by difficulty:** Find sentences that match your Japanese level by sorting results from easiest to hardest, or vice versa. Nadeshiko considers word rarity and grammar complexity to estimate how difficult each sentence is.
- **Sort by sentence count:** Organize titles by how many sentences they contain, from most to least or the other way around.
- **Search inside words:** Looking for a kanji that usually appears as part of a longer word? Just surround it with asterisks! For example, searching `*憬*` will find words like 憧憬.

## AniList/MyAnimeList Integration

You can now connect your AniList or MyAnimeList account from Settings and bring your anime watch history into Nadeshiko.

With the new "Only anime I've watched" filter, you can search for sentences from shows you've already seen. This makes examples easier to understand and remember since you're familiar with the characters and scenes, while also helping you avoid spoilers from anime you haven't watched yet!

You can also see your watch progress on anime pages, check how many titles from your list are available on Nadeshiko, and request missing anime with just one click.

## A New Dictionary Experience

Until now, Nadeshiko relied on [Shirabe](https://shirabe.org/) for Japanese word lookups and sentence parsing. Shirabe played a huge role in making features like word cards, Anki mining, and custom dictionaries possible.

With 3.0.0, Nadeshiko now has its own parser and dictionary, built on JMdict, with JLPT levels, pitch accent, and word frequency based on over 1.5 million sentences from our collection.

This also brings several new features:

- **Pitch accent with audio:** See pitch patterns, listen to their pronunciation, and export recordings to Anki.
- **Kanji cards:** Explore meanings, readings, stroke order, components, and related words, with dedicated kanji pages.
- **Dictionary entries in search:** See word definitions directly above search results, including dictionary forms and alternative meanings.
- **Your own dictionaries:** Upload Yomitan dictionaries and use them across devices and in your Anki cards.

With this change, Nadeshiko no longer connects directly to Shirabe. Existing account connections have been removed, along with their stored data. If you previously linked your account, you can also revoke Nadeshiko's access in Shirabe's settings. Shirabe remains available as an optional external dictionary, which you can enable or disable in Settings.

Finally, I want to personally thank Dav, the creator of Shirabe, for the years of dedication and hard work he put into Nadeshiko. His contributions helped shape this project into what it is today, and I'm deeply grateful for everything we built together. Moving forward with our own dictionary doesn't change how much his work has meant to Nadeshiko.

## A Better Way to Request Content

"Can you add this anime?" is one of the questions we receive most often. And as Nadeshiko continues to grow, so does the number of requests for new content.

We're incredibly grateful for all the support, but adding new content takes time. Between reviewing requests, checking subtitle quality, and preparing new titles, keeping up with everything has become increasingly difficult, and some requests have unfortunately been overlooked.

That's why we're introducing a new [Requests](/requests) page, where everyone can suggest content, vote on their favorites, and help decide what gets added next!

Submitting a request is simple: just paste a link from AniList, MyAnimeList, TMDB, MyDramaList, Audible, or YouTube. If someone has already requested the same content, you can vote for it instead. You can also request more content from titles already available on Nadeshiko, such as another season of an anime.

Every vote matters! The more votes a request receives, the higher its priority. You'll also be able to track requests from Open to In Progress to Released, with notifications and emails when work begins or the content becomes available. If we can't add something, we'll explain why.

### What about Patreon requests?

Until now, our Patrons could directly request a certain number of titles depending on their tier. We know this has been an important benefit, and changing it wasn't an easy decision.

However, as Nadeshiko continues to grow, so does the number of requests we receive. Each new title requires hours of preparation, processing, and quality checks, and we've reached a point where we can no longer promise to fulfill every individual request without making Nadeshiko a full-time job.

With the new system, Patrons will receive 3, 5, or 10 monthly priority boosts, depending on their tier. Each boost is worth five votes, giving their favorite titles more weight when deciding what content to prioritize.

While boosts don't guarantee that a title will be added, they allow us to keep giving our Patrons a stronger voice while making the process fairer and more sustainable.

We know some of you became Patrons specifically to request content, and we don't take this change lightly. Rather than continue making promises we may not be able to fulfill, we want to build a system that's more transparent and sustainable for everyone.

## For developers

Good news! We've doubled the free API limit from 5,000 to 10,000 requests per month for everyone! And for those who need more, we're introducing new Patreon tiers with higher limits for more intensive usage.

Nadeshiko 3.0.0 also brings several API improvements and updated SDKs: `@nadeshiko/nadeshiko-sdk` (npm) and `nadeshiko-sdk-py` (PyPI).

If you're using an SDK older than 2.6.0, please update it to get support for the latest features from 3.0.0.

Explore all the changes in our [API documentation](https://nadeshiko.co/docs/api/index.html). Missing an endpoint? Let us know on Discord!

## Supporting Nadeshiko on Patreon

Nadeshiko has always been free, and that's not going to change. Searching sentences, listening to audio, exporting to Anki, using the dictionary, and accessing our public API will remain available to everyone.

Running Nadeshiko comes with real costs, from servers and storage to delivering millions of images and audio files. Thanks to our Patrons, we've been able to cover much of these expenses over the past few months, and we're incredibly grateful for that.

But beyond keeping the servers running, we'd also love to make working on Nadeshiko more sustainable. Our hope is that, with enough support, we can dedicate more time to developing Nadeshiko and eventually make a living from the work we put into it.

With 3.0.0, we're introducing Patreon integration, offering additional features and higher limits to those who want to support the project and help us continue improving it.

We have three membership [tiers](/supporters):

- **Seed 種 ($5/month):** 15,000 API requests per month and 3 monthly content request boosts.
- **Flower 花 ($10/month):** 30,000 API requests per month and 5 monthly boosts.
- **Nadeshiko 撫子 ($20/month):** 60,000 API requests per month and 10 monthly boosts.

All three tiers also include:

- **Custom themes:** Choose from additional themes or create your own.
- **Higher limits:** Upload up to 10 custom dictionaries instead of 3, and have up to 30 open content requests instead of 10.
- **Advanced anime list features:** Daily automatic syncing with AniList or MyAnimeList, spoiler protection for episodes you haven't watched, the ability to hide Plan to Watch titles from searches, and support for AniList custom lists as filters.

And to everyone who has supported Nadeshiko so far, thank you! Your support not only helps keep the platform running but also gives us the opportunity to keep building something we love and sharing it with everyone.

Thank you to everyone who continues to use and support Nadeshiko! A special thanks to our Patrons, whose support helps keep the project running and makes it possible for us to keep improving it for everyone. We hope you enjoy everything new in 3.0.0. Happy studying, and see you in the next update! ❤️
